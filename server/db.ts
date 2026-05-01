import mysql from 'mysql2/promise';
import pg from 'pg';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { AsyncLocalStorage } from 'async_hooks';

dotenv.config();

let dbType: 'postgres' | 'mysql' | 'sqlite' = 'sqlite';
let mysqlPool: mysql.Pool | null = null;
let pgPool: pg.Pool | null = null;
let internalDb: any;
const transactionStorage = new AsyncLocalStorage<mysql.PoolConnection | pg.PoolClient>();

// --- Detection priority: PostgreSQL > MySQL > SQLite ---
const usePostgres = !!(process.env.DATABASE_URL || process.env.PG_HOST);
const useMySQL = !usePostgres && !!(process.env.MYSQL_URL || process.env.MYSQL_HOST);

// --- Strip RETURNING clause for MySQL/SQLite (PostgreSQL supports it natively) ---
function stripReturning(sql: string): { cleaned: string; hadReturning: boolean } {
  const match = sql.match(/\s+RETURNING\s+\S+/i);
  if (match) {
    return { cleaned: sql.replace(/\s+RETURNING\s+\S+/i, ''), hadReturning: true };
  }
  return { cleaned: sql, hadReturning: false };
}

// ============================================================
// POSTGRESQL INITIALIZER
// ============================================================
const initializePostgres = async () => {
  console.log('Initializing PostgreSQL...');
  try {
    const poolConfig: pg.PoolConfig = process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
      : {
          host: process.env.PG_HOST,
          port: parseInt(process.env.PG_PORT || '5432'),
          user: process.env.PG_USER,
          password: process.env.PG_PASSWORD,
          database: process.env.PG_DATABASE,
          max: 10,
        };

    pgPool = new pg.Pool(poolConfig);

    // Test connection
    const client = await pgPool.connect();
    console.log('Successfully connected to PostgreSQL database.');
    client.release();

    internalDb = {
      query: async (text: string, params?: any[]) => {
        // PostgreSQL natively supports $1, $2... syntax — no conversion needed
        const txClient = transactionStorage.getStore() as pg.PoolClient | undefined;
        const client = txClient || pgPool!;
        const result = await client.query(text, params);
        return {
          rows: result.rows,
          rowCount: result.rowCount || 0,
          lastInsertRowid: result.rows[0]?.id ?? null,
        };
      },
      async transaction(fn: () => Promise<void>) {
        const client = await pgPool!.connect();
        try {
          await client.query('BEGIN');
          await transactionStorage.run(client as any, async () => {
            await fn();
          });
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      },
    };
    dbType = 'postgres';
  } catch (err) {
    console.error('Failed to initialize PostgreSQL, falling back to SQLite:', err);
    initializeSqlite();
  }
};

// ============================================================
// MYSQL INITIALIZER
// ============================================================
const initializeMySQL = async () => {
  console.log('Initializing MySQL...');
  try {
    const config: mysql.PoolOptions = process.env.MYSQL_URL
      ? { uri: process.env.MYSQL_URL }
      : {
          host: process.env.MYSQL_HOST,
          port: parseInt(process.env.MYSQL_PORT || '3306'),
          user: process.env.MYSQL_USER,
          password: process.env.MYSQL_PASSWORD,
          database: process.env.MYSQL_DATABASE,
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
          enableKeepAlive: true,
          keepAliveInitialDelay: 10000,
        };

    mysqlPool = mysql.createPool(config);

    // Test connection
    const connection = await mysqlPool.getConnection();
    console.log('Successfully connected to MySQL database.');
    connection.release();

    internalDb = {
      query: async (text: string, params?: any[]) => {
        // Convert $N placeholders to ? for MySQL
        let mysqlText = text.replace(/\$(\d+)/g, '?');
        // Strip RETURNING clause (not supported in MySQL)
        const { cleaned } = stripReturning(mysqlText);
        mysqlText = cleaned;

        const txConnection = transactionStorage.getStore() as mysql.PoolConnection | undefined;

        if (txConnection) {
          const [rows] = await txConnection.execute(mysqlText, params);
          return {
            rows: Array.isArray(rows) ? rows : [],
            rowCount: (rows as any).affectedRows || (rows as any).length || 0,
            lastInsertRowid: (rows as any).insertId,
          };
        }

        const [rows] = await mysqlPool!.execute(mysqlText, params);
        return {
          rows: Array.isArray(rows) ? rows : [],
          rowCount: (rows as any).affectedRows || (rows as any).length || 0,
          lastInsertRowid: (rows as any).insertId,
        };
      },
      async transaction(fn: () => Promise<void>) {
        const connection = await mysqlPool!.getConnection();
        try {
          await connection.beginTransaction();
          await transactionStorage.run(connection as any, async () => {
            await fn();
          });
          await connection.commit();
        } catch (err) {
          await connection.rollback();
          throw err;
        } finally {
          connection.release();
        }
      },
    };
    dbType = 'mysql';
  } catch (err) {
    console.error('Failed to initialize MySQL, falling back to SQLite:', err);
    initializeSqlite();
  }
};

// ============================================================
// SQLITE INITIALIZER
// ============================================================
const initializeSqlite = () => {
  console.log('Initializing SQLite...');
  let dataDir = path.join(process.cwd(), 'data');

  if (process.env.VERCEL) {
    dataDir = '/tmp';
    console.warn('WARNING: Running SQLite on Vercel (/tmp). Data is ephemeral and will be lost on cold starts.');
  } else {
    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
    } catch (err) {
      console.warn('Current directory "data" is not writable, falling back to /tmp');
      dataDir = '/tmp';
    }
  }

  const dbPath = path.join(dataDir, 'kitchen.db');
  console.log(`Using SQLite database file: ${dbPath}`);
  const sqlite = new Database(dbPath);

  // Enable foreign key enforcement for SQLite
  sqlite.pragma('foreign_keys = ON');
  // Enable WAL mode for better concurrent read performance
  sqlite.pragma('journal_mode = WAL');

  internalDb = {
    query: async (text: string, params?: any[]) => {
      // Convert $N placeholders to ? for SQLite
      let sqliteText = text.replace(/\$(\d+)/g, '?');
      // Strip RETURNING clause and handle via lastInsertRowid
      const { cleaned } = stripReturning(sqliteText);
      sqliteText = cleaned;

      const lowerText = sqliteText.trim().toLowerCase();
      if (lowerText.startsWith('select')) {
        const rows = sqlite.prepare(sqliteText).all(...(params || []));
        return { rows };
      } else {
        const result = sqlite.prepare(sqliteText).run(...(params || []));
        return {
          rows: [],
          rowCount: result.changes,
          lastInsertRowid:
            typeof result.lastInsertRowid === 'bigint'
              ? Number(result.lastInsertRowid)
              : result.lastInsertRowid,
        };
      }
    },
    async transaction(fn: () => Promise<void>) {
      sqlite.prepare('BEGIN').run();
      try {
        await fn();
        sqlite.prepare('COMMIT').run();
      } catch (err) {
        sqlite.prepare('ROLLBACK').run();
        throw err;
      }
    },
  };
  dbType = 'sqlite';
};

// --- Eager initialization for SQLite (sync) ---
if (!usePostgres && !useMySQL) {
  initializeSqlite();
}

export const db = {
  query: (text: string, params?: any[]) => internalDb.query(text, params),
  transaction: (fn: () => Promise<void>) => internalDb.transaction(fn),
};

// ============================================================
// SCHEMA INITIALIZATION
// ============================================================
const initDb = async () => {
  // Async DB initialization
  if (usePostgres) {
    await initializePostgres();
  } else if (useMySQL) {
    await initializeMySQL();
  }

  const isPG = dbType === 'postgres';
  const isMySQL = dbType === 'mysql';

  // --- Schema creation ---
  // PostgreSQL uses SERIAL, MySQL uses INT AUTO_INCREMENT, SQLite uses INTEGER AUTOINCREMENT
  const autoId = isPG
    ? 'SERIAL PRIMARY KEY'
    : isMySQL
      ? 'INT AUTO_INCREMENT PRIMARY KEY'
      : 'INTEGER PRIMARY KEY AUTOINCREMENT';

  const boolType = isMySQL ? 'TINYINT(1)' : isPG ? 'SMALLINT' : 'INTEGER';
  const doubleType = isPG ? 'DOUBLE PRECISION' : 'DOUBLE';

  const schemaStatements = [
    // --- Multi-tenant: organizations ---
    `CREATE TABLE IF NOT EXISTS organizations (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // --- Licensing / Subscriptions ---
    `CREATE TABLE IF NOT EXISTS licenses (
      id VARCHAR(255) PRIMARY KEY,
      org_id VARCHAR(255) NOT NULL,
      plan_type VARCHAR(50) NOT NULL DEFAULT 'trial',
      status VARCHAR(50) NOT NULL DEFAULT 'active',
      trial_start TIMESTAMP,
      trial_end TIMESTAMP,
      subscription_start TIMESTAMP,
      subscription_end TIMESTAMP,
      amount ${doubleType} DEFAULT 99,
      currency VARCHAR(10) DEFAULT 'USD',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id ${autoId},
      org_id VARCHAR(255),
      username VARCHAR(255) UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT,
      role VARCHAR(50) DEFAULT 'staff',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS items (
      id VARCHAR(255) PRIMARY KEY,
      org_id VARCHAR(255) NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      category TEXT,
      unit TEXT NOT NULL,
      purchase_price ${doubleType} DEFAULT 0,
      yield_percentage ${doubleType} DEFAULT 100,
      par_level ${doubleType} DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS purchases (
      id VARCHAR(255) PRIMARY KEY,
      org_id VARCHAR(255) NOT NULL DEFAULT '',
      item_id VARCHAR(255) NOT NULL,
      date TEXT NOT NULL,
      quantity ${doubleType} NOT NULL,
      unit_price ${doubleType} NOT NULL,
      vendor TEXT,
      recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS stock_entries (
      id VARCHAR(255) PRIMARY KEY,
      org_id VARCHAR(255) NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      item_id VARCHAR(255) NOT NULL,
      closing_quantity ${doubleType} NOT NULL,
      recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS recipes (
      id VARCHAR(255) PRIMARY KEY,
      org_id VARCHAR(255) NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      portion_size ${doubleType} NOT NULL,
      total_yield ${doubleType},
      selling_price ${doubleType} DEFAULT 0,
      is_locked ${boolType} DEFAULT 0,
      is_sub_recipe ${boolType} DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS recipe_ingredients (
      id ${autoId},
      recipe_id VARCHAR(255) NOT NULL,
      type VARCHAR(255) NOT NULL,
      target_id VARCHAR(255) NOT NULL,
      quantity ${doubleType} NOT NULL,
      cost_at_time ${doubleType},
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS sales_entries (
      id VARCHAR(255) PRIMARY KEY,
      org_id VARCHAR(255) NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      recipe_id VARCHAR(255) NOT NULL,
      quantity_sold ${doubleType} NOT NULL,
      recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      org_id VARCHAR(255) NOT NULL DEFAULT '',
      setting_key VARCHAR(255) NOT NULL DEFAULT 'config',
      value TEXT NOT NULL,
      PRIMARY KEY (org_id, setting_key)
    )`,
  ];

  try {
    for (const statement of schemaStatements) {
      await internalDb.query(statement);
    }
    console.log(`${dbType.toUpperCase()} database schema initialized.`);
  } catch (err) {
    console.error('Database schema initialization failure:', err);
    throw err;
  }

  // --- Migrations for existing databases ---
  await runMigrations();
};

async function tryMigration(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`Migration applied: ${name}`);
  } catch (err: any) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('duplicate column') || msg.includes('already exists') || msg.includes('duplicate')) {
      // Already applied
    } else {
      console.warn(`Migration "${name}" skipped:`, err.message);
    }
  }
}

async function runMigrations() {
  // --- Add columns to existing tables ---
  const addColumnMigrations = [
    { name: 'add_role_to_users', sql: `ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'staff'` },
    { name: 'add_org_id_to_users', sql: `ALTER TABLE users ADD COLUMN org_id VARCHAR(255) DEFAULT ''` },
    { name: 'add_org_id_to_items', sql: `ALTER TABLE items ADD COLUMN org_id VARCHAR(255) DEFAULT ''` },
    { name: 'add_org_id_to_purchases', sql: `ALTER TABLE purchases ADD COLUMN org_id VARCHAR(255) DEFAULT ''` },
    { name: 'add_org_id_to_stock_entries', sql: `ALTER TABLE stock_entries ADD COLUMN org_id VARCHAR(255) DEFAULT ''` },
    { name: 'add_org_id_to_sales_entries', sql: `ALTER TABLE sales_entries ADD COLUMN org_id VARCHAR(255) DEFAULT ''` },
    { name: 'add_org_id_to_recipes', sql: `ALTER TABLE recipes ADD COLUMN org_id VARCHAR(255) DEFAULT ''` },
  ];

  for (const m of addColumnMigrations) {
    await tryMigration(m.name, () => internalDb.query(m.sql));
  }

  // --- Migrate old settings table (key PK) to new (org_id + setting_key PK) ---
  await tryMigration('migrate_settings_table', async () => {
    // Check if old-style settings table exists (has "key" column but not "setting_key")
    try {
      await internalDb.query('SELECT setting_key FROM settings LIMIT 1');
      return; // Already migrated
    } catch (_e) {
      // Old schema — needs migration
    }

    // Save existing settings
    let existingRows: any[] = [];
    try {
      const result = await internalDb.query('SELECT * FROM settings');
      existingRows = result.rows || [];
    } catch (_e) {}

    // Rename old table, create new, copy data
    try { await internalDb.query('DROP TABLE IF EXISTS settings_backup'); } catch (_e) {}
    try { await internalDb.query('ALTER TABLE settings RENAME TO settings_backup'); } catch (_e) {}

    await internalDb.query(`CREATE TABLE IF NOT EXISTS settings (
      org_id VARCHAR(255) NOT NULL DEFAULT '',
      setting_key VARCHAR(255) NOT NULL DEFAULT 'config',
      value TEXT NOT NULL,
      PRIMARY KEY (org_id, setting_key)
    )`);

    // Restore existing settings under empty org (will be updated by default-org migration)
    for (const row of existingRows) {
      const key = row.key || row.KEY || 'config';
      try {
        await internalDb.query(
          'INSERT INTO settings (org_id, setting_key, value) VALUES ($1, $2, $3)',
          ['', key, row.value]
        );
      } catch (_e) {}
    }

    try { await internalDb.query('DROP TABLE IF EXISTS settings_backup'); } catch (_e) {}
    console.log('Migrated settings table to multi-tenant schema.');
  });

  // --- Create default org for existing data ---
  await tryMigration('create_default_org', async () => {
    const orgCheck = await internalDb.query('SELECT id FROM organizations LIMIT 1');
    if (orgCheck.rows && orgCheck.rows.length > 0) return; // Orgs already exist

    // Check if there are any existing users without an org
    const userCheck = await internalDb.query("SELECT id FROM users WHERE org_id IS NULL OR org_id = '' LIMIT 1");
    if (!userCheck.rows || userCheck.rows.length === 0) return; // No orphan users

    const defaultOrgId = 'org-default';
    await internalDb.query(
      'INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)',
      [defaultOrgId, 'Default Organization', 'default']
    );

    // Create a perpetual license for the default org
    const now = new Date().toISOString();
    const far = new Date('2099-12-31').toISOString();
    await internalDb.query(
      'INSERT INTO licenses (id, org_id, plan_type, status, subscription_start, subscription_end, amount) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      ['lic-default', defaultOrgId, 'subscription', 'active', now, far, 0]
    );

    // Assign all existing data to the default org
    const tables = ['users', 'items', 'purchases', 'stock_entries', 'sales_entries', 'recipes'];
    for (const table of tables) {
      try {
        await internalDb.query(`UPDATE ${table} SET org_id = $1 WHERE org_id IS NULL OR org_id = ''`, [defaultOrgId]);
      } catch (_e) {}
    }

    // Update settings
    try {
      await internalDb.query(`UPDATE settings SET org_id = $1 WHERE org_id = ''`, [defaultOrgId]);
    } catch (_e) {}

    console.log('Created default organization and assigned existing data.');
  });
}

export { initDb, dbType };
export default db;
