import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { ZodError, type ZodSchema } from 'zod';
import { db, initDb, dbType } from './server/db.ts';
import {
  loginSchema, registerSchema,
  createItemSchema, updateItemSchema,
  createPurchaseSchema,
  createStockEntrySchema,
  createSalesEntrySchema,
  createRecipeSchema, updateRecipeSchema,
  settingsSchema,
  createUserSchema, updateUserSchema,
} from './server/validation.ts';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================
// CONFIGURATION VALIDATION
// ============================================================
const isVercel = !!process.env.VERCEL;
const isProduction = process.env.NODE_ENV === 'production' || isVercel;

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && isProduction) {
  console.error('FATAL: JWT_SECRET environment variable is required in production.');
  process.exit(1);
}
if (!JWT_SECRET) {
  console.warn('⚠ WARNING: JWT_SECRET not set. Using development-only fallback. Do NOT deploy like this.');
}
const jwtSecret = JWT_SECRET || 'dev-only-fallback-DO-NOT-USE-IN-PRODUCTION';

// ============================================================
// DATABASE INITIALIZATION
// ============================================================
try {
  await initDb();
} catch (err) {
  console.error('Critical failure during initDb:', err);
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// ============================================================
// GLOBAL MIDDLEWARE
// ============================================================
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Trust first proxy in production (Cloud Run, nginx, etc.)
if (isProduction) {
  app.set('trust proxy', 1);
}

// --- Rate Limiting ---
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 attempts per window
  message: { error: 'Too many authentication attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,      // 1 minute
  max: 200,                  // 200 requests per minute
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', apiLimiter);

// ============================================================
// HELPER UTILITIES
// ============================================================

/** Return a safe error response — strips internals in production */
function errorResponse(res: any, statusCode: number, message: string, err?: any) {
  if (!isProduction && err) {
    return res.status(statusCode).json({ error: message, details: err.message });
  }
  return res.status(statusCode).json({ error: message });
}

/** Express middleware factory for Zod validation */
function validate(schema: ZodSchema) {
  return (req: any, res: any, next: any) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: err.issues.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      next(err);
    }
  };
}

/** Generate an ID if the client didn't provide one */
function ensureId(body: any): string {
  if (!body.id) {
    body.id = randomUUID();
  }
  return body.id;
}

// ============================================================
// AUTH MIDDLEWARE
// ============================================================
const authenticateToken = (req: any, res: any, next: any) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  jwt.verify(token, jwtSecret, (err: any, decoded: any) => {
    if (err) return res.status(403).json({ error: 'Forbidden' });
    req.user = decoded;
    // Default role for tokens issued before RBAC migration
    if (!req.user.role) req.user.role = 'staff';
    next();
  });
};

/** Restrict route to admin users only */
const requireAdmin = (req: any, res: any, next: any) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// ============================================================
// HEALTH / READINESS ENDPOINT (unauthenticated, for load balancers)
// ============================================================
app.get('/api/health', async (_req, res) => {
  try {
    await db.query('SELECT 1 as ok');
    res.json({ status: 'healthy', database: dbType });
  } catch (err: any) {
    res.status(503).json({ status: 'unhealthy', database: dbType });
  }
});

// Debug endpoint — protected, admin only
app.get('/api/debug', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const result = await db.query('SELECT 1 as connected');
    res.json({
      status: 'ok',
      database: dbType,
      connected: result.rows.length > 0,
      env: {
        isProduction,
        isVercel,
      }
    });
  } catch (err: any) {
    errorResponse(res, 500, 'Debug check failed', err);
  }
});

// ============================================================
// AUTH ROUTES
// ============================================================
app.post('/api/auth/register', authLimiter, validate(registerSchema), async (req, res) => {
  const { username, password, displayName } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    const result = await db.query(
      'INSERT INTO users (username, password, display_name, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [username, hashedPassword, displayName, 'staff']
    );
    const id = result.rows[0]?.id || result.lastInsertRowid;
    console.log(`User registered: ${username} (id: ${id})`);
    res.status(201).json({ id, username, displayName });
  } catch (err: any) {
    const code = err.code || '';
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === '23505' || code === 'ER_DUP_ENTRY' || code === '1062' || code === '1169') {
      return res.status(400).json({ error: 'Username already exists' });
    }
    errorResponse(res, 500, 'Registration failed', err);
  }
});

app.post('/api/auth/login', authLimiter, validate(loginSchema), async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];

    if (!user) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    const passwordsMatch = await bcrypt.compare(password, user.password);
    if (!passwordsMatch) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    const tokenPayload = {
      id: user.id,
      username: user.username,
      role: user.role || 'staff',
    };
    const token = jwt.sign(tokenPayload, jwtSecret, { expiresIn: '7d' });

    res.cookie('token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role || 'staff',
    });
  } catch (err: any) {
    errorResponse(res, 500, 'Login failed', err);
  }
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    path: '/',
  });
  res.json({ message: 'Logged out' });
});

app.get('/api/auth/me', authenticateToken, async (req: any, res) => {
  try {
    const result = await db.query(
      'SELECT id, username, display_name as "displayName", role FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to fetch user', err);
  }
});

// ============================================================
// SEED DEFAULT ADMIN (dev or first-run)
// ============================================================
const seedAdmin = async () => {
  // In production, only seed if explicitly enabled via SEED_ADMIN=true
  if (isProduction && process.env.SEED_ADMIN !== 'true') {
    return;
  }

  try {
    const hashedPassword = await bcrypt.hash('admin', 12);
    const userResult = await db.query('SELECT * FROM users WHERE username = $1', ['admin']);
    const adminExists = userResult.rows[0];
    if (!adminExists) {
      await db.query(
        'INSERT INTO users (username, password, display_name, role) VALUES ($1, $2, $3, $4)',
        ['admin', hashedPassword, 'Admin', 'admin']
      );
      console.log('Seeded default admin user (admin/admin). Change the password immediately!');
    } else {
      // Ensure existing admin has admin role
      await db.query('UPDATE users SET role = $1 WHERE username = $2', ['admin', 'admin']);
    }
  } catch (err) {
    console.warn('Admin seeding skipped:', err);
  }
};

try {
  await seedAdmin();
} catch (err) {
  console.error('Failure during seedAdmin:', err);
}

// ============================================================
// ITEMS ROUTES
// ============================================================
app.get('/api/items', authenticateToken, async (_req, res) => {
  try {
    const result = await db.query('SELECT * FROM items');
    res.json(result.rows.map((i: any) => ({
      ...i,
      purchasePrice: i.purchase_price,
      yieldPercentage: i.yield_percentage,
      parLevel: i.par_level,
      createdAt: i.created_at,
      updatedAt: i.updated_at,
    })));
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to fetch items', err);
  }
});

app.post('/api/items', authenticateToken, validate(createItemSchema), async (req, res) => {
  try {
    const id = ensureId(req.body);
    const { name, category, unit, purchasePrice, yieldPercentage, parLevel } = req.body;
    await db.query(
      'INSERT INTO items (id, name, category, unit, purchase_price, yield_percentage, par_level) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, name, category, unit, purchasePrice, yieldPercentage, parLevel]
    );
    res.status(201).json({ id, ...req.body });
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to create item', err);
  }
});

app.put('/api/items/:id', authenticateToken, validate(updateItemSchema), async (req, res) => {
  try {
    const { name, category, unit, purchasePrice, yieldPercentage, parLevel } = req.body;
    await db.query(
      'UPDATE items SET name = $1, category = $2, unit = $3, purchase_price = $4, yield_percentage = $5, par_level = $6, updated_at = CURRENT_TIMESTAMP WHERE id = $7',
      [name, category, unit, purchasePrice, yieldPercentage, parLevel, req.params.id]
    );
    res.json({ id: req.params.id, ...req.body });
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to update item', err);
  }
});

app.delete('/api/items/:id', authenticateToken, async (req, res) => {
  try {
    await db.query('DELETE FROM items WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to delete item', err);
  }
});

// ============================================================
// PURCHASES ROUTES
// ============================================================
app.get('/api/purchases', authenticateToken, async (_req, res) => {
  try {
    const result = await db.query('SELECT * FROM purchases');
    res.json(result.rows.map((r: any) => ({
      ...r,
      itemId: r.item_id,
      unitPrice: r.unit_price,
      recordedAt: r.recorded_at,
    })));
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to fetch purchases', err);
  }
});

app.post('/api/purchases', authenticateToken, validate(createPurchaseSchema), async (req, res) => {
  try {
    const id = ensureId(req.body);
    const { itemId, date, quantity, unitPrice, vendor } = req.body;
    await db.query(
      'INSERT INTO purchases (id, item_id, date, quantity, unit_price, vendor) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, itemId, date, quantity, unitPrice, vendor]
    );
    res.status(201).json({ id, ...req.body });
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to create purchase', err);
  }
});

app.delete('/api/purchases/:id', authenticateToken, async (req, res) => {
  try {
    await db.query('DELETE FROM purchases WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to delete purchase', err);
  }
});

// ============================================================
// STOCK ENTRIES ROUTES
// ============================================================
app.get('/api/stock-entries', authenticateToken, async (_req, res) => {
  try {
    const result = await db.query('SELECT * FROM stock_entries');
    res.json(result.rows.map((r: any) => ({
      ...r,
      itemId: r.item_id,
      closingQuantity: r.closing_quantity,
      recordedAt: r.recorded_at,
    })));
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to fetch stock entries', err);
  }
});

app.post('/api/stock-entries', authenticateToken, validate(createStockEntrySchema), async (req, res) => {
  try {
    const id = ensureId(req.body);
    const { date, itemId, closingQuantity } = req.body;
    await db.query(
      'INSERT INTO stock_entries (id, date, item_id, closing_quantity) VALUES ($1, $2, $3, $4)',
      [id, date, itemId, closingQuantity]
    );
    res.status(201).json({ id, ...req.body });
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to create stock entry', err);
  }
});

app.delete('/api/stock-entries/:id', authenticateToken, async (req, res) => {
  try {
    await db.query('DELETE FROM stock_entries WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to delete stock entry', err);
  }
});

// ============================================================
// SALES ENTRIES ROUTES
// ============================================================
app.get('/api/sales-entries', authenticateToken, async (_req, res) => {
  try {
    const result = await db.query('SELECT * FROM sales_entries');
    res.json(result.rows.map((r: any) => ({
      ...r,
      recipeId: r.recipe_id,
      quantitySold: r.quantity_sold,
      recordedAt: r.recorded_at,
    })));
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to fetch sales entries', err);
  }
});

app.post('/api/sales-entries', authenticateToken, validate(createSalesEntrySchema), async (req, res) => {
  try {
    const id = ensureId(req.body);
    const { date, recipeId, quantitySold } = req.body;
    await db.query(
      'INSERT INTO sales_entries (id, date, recipe_id, quantity_sold) VALUES ($1, $2, $3, $4)',
      [id, date, recipeId, quantitySold]
    );
    res.status(201).json({ id, ...req.body });
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to create sales entry', err);
  }
});

app.delete('/api/sales-entries/:id', authenticateToken, async (req, res) => {
  try {
    await db.query('DELETE FROM sales_entries WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to delete sales entry', err);
  }
});

// ============================================================
// RECIPES ROUTES
// ============================================================
app.get('/api/recipes', authenticateToken, async (_req, res) => {
  try {
    const result = await db.query('SELECT * FROM recipes');
    const recipes = result.rows;
    const fullRecipes = await Promise.all(recipes.map(async (r: any) => {
      const ingredientsResult = await db.query(
        'SELECT * FROM recipe_ingredients WHERE recipe_id = $1',
        [r.id]
      );
      return {
        ...r,
        portionSize: r.portion_size,
        totalYield: r.total_yield,
        sellingPrice: r.selling_price,
        isLocked: !!r.is_locked,
        isSubRecipe: !!r.is_sub_recipe,
        createdAt: r.created_at,
        ingredients: ingredientsResult.rows.map((i: any) => ({
          type: i.type,
          id: i.target_id,
          quantity: i.quantity,
          costAtTime: i.cost_at_time,
        })),
      };
    }));
    res.json(fullRecipes);
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to fetch recipes', err);
  }
});

app.post('/api/recipes', authenticateToken, validate(createRecipeSchema), async (req, res) => {
  try {
    const id = ensureId(req.body);
    const { name, portionSize, totalYield, sellingPrice, isLocked, isSubRecipe, ingredients } = req.body;

    await db.transaction(async () => {
      await db.query(
        'INSERT INTO recipes (id, name, portion_size, total_yield, selling_price, is_locked, is_sub_recipe) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, name, portionSize, totalYield, sellingPrice, isLocked ? 1 : 0, isSubRecipe ? 1 : 0]
      );

      for (const ing of ingredients) {
        await db.query(
          'INSERT INTO recipe_ingredients (recipe_id, type, target_id, quantity, cost_at_time) VALUES ($1, $2, $3, $4, $5)',
          [id, ing.type, ing.id, ing.quantity, ing.costAtTime]
        );
      }
    });

    res.status(201).json({ id, ...req.body });
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to create recipe', err);
  }
});

app.put('/api/recipes/:id', authenticateToken, validate(updateRecipeSchema), async (req, res) => {
  try {
    const { name, portionSize, totalYield, sellingPrice, isLocked, isSubRecipe, ingredients } = req.body;
    const id = req.params.id;

    await db.transaction(async () => {
      await db.query(
        'UPDATE recipes SET name = $1, portion_size = $2, total_yield = $3, selling_price = $4, is_locked = $5, is_sub_recipe = $6 WHERE id = $7',
        [name, portionSize, totalYield, sellingPrice, isLocked ? 1 : 0, isSubRecipe ? 1 : 0, id]
      );

      await db.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [id]);
      for (const ing of ingredients) {
        await db.query(
          'INSERT INTO recipe_ingredients (recipe_id, type, target_id, quantity, cost_at_time) VALUES ($1, $2, $3, $4, $5)',
          [id, ing.type, ing.id, ing.quantity, ing.costAtTime]
        );
      }
    });

    res.json({ id, ...req.body });
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to update recipe', err);
  }
});

app.delete('/api/recipes/:id', authenticateToken, async (req, res) => {
  try {
    await db.transaction(async () => {
      await db.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [req.params.id]);
      await db.query('DELETE FROM recipes WHERE id = $1', [req.params.id]);
    });
    res.status(204).end();
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to delete recipe', err);
  }
});

// ============================================================
// SETTINGS ROUTES (admin only for writes)
// ============================================================
app.get('/api/settings', authenticateToken, async (_req, res) => {
  try {
    const result = await db.query('SELECT value FROM settings WHERE "key" = $1', ['config']);
    const row = result.rows[0];
    if (row) {
      res.json(JSON.parse(row.value));
    } else {
      res.json({
        categories: ['Vegetables', 'Dairy', 'Dry Goods', 'Meat', 'Seafood', 'Poultry'],
        currency: { symbol: 'R', code: 'ZAR' },
      });
    }
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to fetch settings', err);
  }
});

app.post('/api/settings', authenticateToken, requireAdmin, validate(settingsSchema), async (req, res) => {
  try {
    await db.transaction(async () => {
      await db.query('DELETE FROM settings WHERE "key" = $1', ['config']);
      await db.query('INSERT INTO settings ("key", value) VALUES ($1, $2)', ['config', JSON.stringify(req.body)]);
    });
    res.json(req.body);
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to save settings', err);
  }
});

// ============================================================
// USER MANAGEMENT ROUTES (admin only)
// ============================================================
app.get('/api/users', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const result = await db.query('SELECT id, username, display_name as "displayName", role FROM users');
    res.json(result.rows);
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to fetch users', err);
  }
});

app.post('/api/users', authenticateToken, requireAdmin, validate(createUserSchema), async (req, res) => {
  const { username, password, displayName } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    const result = await db.query(
      'INSERT INTO users (username, password, display_name, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [username, hashedPassword, displayName, 'staff']
    );
    const id = result.rows[0]?.id || result.lastInsertRowid;
    res.status(201).json({ id, username, displayName, role: 'staff' });
  } catch (err: any) {
    const code = err.code || '';
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === '23505' || code === 'ER_DUP_ENTRY' || code === '1062' || code === '1169') {
      return res.status(400).json({ error: 'Username already exists' });
    }
    errorResponse(res, 500, 'Failed to create user', err);
  }
});

app.put('/api/users/:id', authenticateToken, requireAdmin, validate(updateUserSchema), async (req, res) => {
  const { username, password, displayName } = req.body;
  try {
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 12);
      await db.query(
        'UPDATE users SET username = $1, password = $2, display_name = $3 WHERE id = $4',
        [username, hashedPassword, displayName, req.params.id]
      );
    } else {
      await db.query(
        'UPDATE users SET username = $1, display_name = $2 WHERE id = $3',
        [username, displayName, req.params.id]
      );
    }
    res.json({ id: req.params.id, username, displayName });
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to update user', err);
  }
});

app.delete('/api/users/:id', authenticateToken, requireAdmin, async (req: any, res) => {
  try {
    if (req.params.id === req.user.id.toString()) {
      return res.status(400).json({ error: 'You cannot delete yourself' });
    }
    await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err: any) {
    errorResponse(res, 500, 'Failed to delete user', err);
  }
});

// ============================================================
// VITE DEV / STATIC PRODUCTION SERVING
// ============================================================
if (!isProduction) {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  const distPath = path.join(process.cwd(), 'dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    console.warn('Production build directory "dist" not found. Run `npm run build` first.');
    app.get('*', (_req, res) => {
      res.status(404).send('Static assets not found. Please build the application.');
    });
  }
}

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('Unhandled server error:', err);
  errorResponse(res, 500, 'Internal server error', err);
});

// ============================================================
// START SERVER
// ============================================================
if (!isVercel) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT} [${isProduction ? 'production' : 'development'}]`);
  });
}

export default app;
