import mysql from 'mysql2/promise';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { AsyncLocalStorage } from 'async_hooks';

dotenv.config();

let dbType: 'mysql' | 'sqlite' = 'sqlite';
let mysqlPool: mysql.Pool | null = null;
let internalDb: any;
const transactionStorage = new AsyncLocalStorage<mysql.PoolConnection>();

const useMySQL = !!(process.env.MYSQL_URL || process.env.MYSQL_HOST);

// --- Strip RETURNING clause (not supported by MySQL, fragile in SQLite) ---
function stripReturning(sql: string): { cleaned: string; hadReturning: boolean } {
  const match = sql.match(/\s+RETURNING\s+\S+/i);
  if (match) {
    return { cleaned: sql.replace(/\s+RETURNING\s+\S+/i, ''), hadReturning: true };
  }
  return { cleaned: sql, hadReturning: false };
}

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
          keepAliveInitialDelay: 10000
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

        const txConnection = transactionStorage.getStore();

        if (txConnection) {
          const [rows] = await txConnection.execute(mysqlText, params);
          return {
            rows: Array.isArray(rows) ? rows : [],
            rowCount: (rows as any).affectedRows || (rows as any).length || 0,
            lastInsertRowid: (rows as any).insertId
          };
        }

        const [rows] = await mysqlPool!.execute(mysqlText, params);
        return {
          rows: Array.isArray(rows) ? rows : [],
          rowCount: (rows as any).affectedRows || (rows as any).length || 0,
          lastInsertRowid: (rows as any).insertId
        };
      },
      async transaction(fn: () => Promise<void>) {
        const connection = await mysqlPool!.getConnection();
        try {
          await connection.beginTransaction();
          await transactionStorage.run(connection, async () => {
            await fn();
          });
          await connection.commit();
        } catch (err) {
          await connection.rollback();
          throw err;
        } finally {
          connection.release();
        }
      }
    };
    dbType = 'mysql';
  } catch (err) {
    console.error('Failed to initialize MySQL, falling back to SQLite:', err);
    initializeSqlite();
  }
};

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
      const { cleaned, hadReturning } = stripReturning(sqliteText);
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
          lastInsertRowid: typeof result.lastInsertRowid === 'bigint'
            ? Number(result.lastInsertRowid)
            : result.lastInsertRowid
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
    }
  };
  dbType = 'sqlite';
};

// Selection logic
if (useMySQL) {
  // MySQL initialization is async — handled in initDb()
} else {
  initializeSqlite();
}

export const db = {
  query: (text: string, params?: any[]) => internalDb.query(text, params),
  transaction: (fn: () => Promise<void>) => internalDb.transaction(fn)
};

const initDb = async () => {
  if (useMySQL) {
    await initializeMySQL();
  }

  const isMySQL = dbType === 'mysql';

  // --- Schema creation ---
  const schemaStatements = [
    `CREATE TABLE IF NOT EXISTS users (
      id ${isMySQL ? 'INT AUTO_INCREMENT' : 'INTEGER'} PRIMARY KEY ${isMySQL ? '' : 'AUTOINCREMENT'},
      username VARCHAR(255) UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT,
      role VARCHAR(50) DEFAULT 'staff',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS items (
      id VARCHAR(255) PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      unit TEXT NOT NULL,
      purchase_price DOUBLE DEFAULT 0,
      yield_percentage DOUBLE DEFAULT 100,
      par_level DOUBLE DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS purchases (
      id VARCHAR(255) PRIMARY KEY,
      item_id VARCHAR(255) NOT NULL,
      date TEXT NOT NULL,
      quantity DOUBLE NOT NULL,
      unit_price DOUBLE NOT NULL,
      vendor TEXT,
      recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS stock_entries (
      id VARCHAR(255) PRIMARY KEY,
      date TEXT NOT NULL,
      item_id VARCHAR(255) NOT NULL,
      closing_quantity DOUBLE NOT NULL,
      recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS recipes (
      id VARCHAR(255) PRIMARY KEY,
      name TEXT NOT NULL,
      portion_size DOUBLE NOT NULL,
      total_yield DOUBLE,
      selling_price DOUBLE DEFAULT 0,
      is_locked ${isMySQL ? 'TINYINT(1)' : 'INTEGER'} DEFAULT 0,
      is_sub_recipe ${isMySQL ? 'TINYINT(1)' : 'INTEGER'} DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS recipe_ingredients (
      id ${isMySQL ? 'INT AUTO_INCREMENT' : 'INTEGER'} PRIMARY KEY ${isMySQL ? '' : 'AUTOINCREMENT'},
      recipe_id VARCHAR(255) NOT NULL,
      type VARCHAR(255) NOT NULL,
      target_id VARCHAR(255) NOT NULL,
      quantity DOUBLE NOT NULL,
      cost_at_time DOUBLE,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS sales_entries (
      id VARCHAR(255) PRIMARY KEY,
      date TEXT NOT NULL,
      recipe_id VARCHAR(255) NOT NULL,
      quantity_sold DOUBLE NOT NULL,
      recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      \`key\` VARCHAR(255) PRIMARY KEY,
      value TEXT NOT NULL
    )`
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
  await runMigrations(isMySQL);
};

async function runMigrations(isMySQL: boolean) {
  const migrations: Array<{ name: string; sql: string }> = [
    {
      name: 'add_role_to_users',
      sql: `ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'staff'`
    }
  ];

  for (const migration of migrations) {
    try {
      await internalDb.query(migration.sql);
      console.log(`Migration applied: ${migration.name}`);
    } catch (err: any) {
      // Column already exists — expected for idempotent migrations
      const msg = (err.message || '').toLowerCase();
      if (msg.includes('duplicate column') || msg.includes('already exists') || msg.includes('duplicate')) {
        // Migration already applied, skip silently
      } else {
        console.warn(`Migration "${migration.name}" skipped:`, err.message);
      }
    }
  }
}

export { initDb, dbType };
export default db;
