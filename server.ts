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
  orgRegisterSchema,
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
    if (!req.user.role) req.user.role = 'staff';
    if (!req.user.orgId) req.user.orgId = '';
    next();
  });
};

const requireAdmin = (req: any, res: any, next: any) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

/** Check org has active trial or subscription */
const requireActiveLicense = async (req: any, res: any, next: any) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(402).json({ error: 'No organization assigned', code: 'NO_ORG' });
  try {
    const r = await db.query(
      `SELECT * FROM licenses WHERE org_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`, [orgId]
    );
    const lic = r.rows[0];
    if (!lic) return res.status(402).json({ error: 'No active license', code: 'LICENSE_REQUIRED' });
    const now = new Date();
    if (lic.plan_type === 'trial' && new Date(lic.trial_end) < now)
      return res.status(402).json({ error: 'Trial expired. Subscribe for $99/month.', code: 'TRIAL_EXPIRED' });
    if (lic.plan_type === 'subscription' && new Date(lic.subscription_end) < now)
      return res.status(402).json({ error: 'Subscription expired', code: 'SUBSCRIPTION_EXPIRED' });
    req.license = lic;
    next();
  } catch (err: any) {
    errorResponse(res, 500, 'License check failed', err);
  }
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
// ORG REGISTRATION (public - creates org + admin + trial)
// ============================================================
app.post('/api/org/register', authLimiter, validate(orgRegisterSchema), async (req, res) => {
  const { orgName, username, password, displayName } = req.body;
  try {
    const orgId = randomUUID();
    const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    // Check slug uniqueness
    const slugCheck = await db.query('SELECT id FROM organizations WHERE slug = $1', [slug]);
    if (slugCheck.rows.length > 0) return res.status(400).json({ error: 'Organization name already taken' });
    await db.transaction(async () => {
      await db.query('INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)', [orgId, orgName, slug]);
      const now = new Date();
      const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      await db.query(
        'INSERT INTO licenses (id, org_id, plan_type, status, trial_start, trial_end, amount) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [randomUUID(), orgId, 'trial', 'active', now.toISOString(), trialEnd.toISOString(), 0]
      );
      const hashedPassword = await bcrypt.hash(password, 12);
      await db.query(
        'INSERT INTO users (org_id, username, password, display_name, role) VALUES ($1, $2, $3, $4, $5)',
        [orgId, username, hashedPassword, displayName, 'admin']
      );
    });
    // Auto-login
    const userResult = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = userResult.rows[0];
    const token = jwt.sign({ id: user.id, username, role: 'admin', orgId }, jwtSecret, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, secure: isProduction, sameSite: isProduction ? 'strict' : 'lax', path: '/', maxAge: 7*24*60*60*1000 });
    res.status(201).json({ id: user.id, username, displayName, role: 'admin', orgId, orgName });
  } catch (err: any) {
    const code = err.code || '';
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === '23505' || code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Username already exists' });
    }
    errorResponse(res, 500, 'Registration failed', err);
  }
});

// ============================================================
// LICENSE ROUTES
// ============================================================
app.get('/api/license', authenticateToken, async (req: any, res) => {
  try {
    const r = await db.query(
      `SELECT * FROM licenses WHERE org_id = $1 ORDER BY created_at DESC LIMIT 1`, [req.user.orgId]
    );
    const lic = r.rows[0];
    if (!lic) return res.json({ active: false, plan: null });
    const now = new Date();
    let active = lic.status === 'active';
    if (lic.plan_type === 'trial') active = active && new Date(lic.trial_end) > now;
    if (lic.plan_type === 'subscription') active = active && new Date(lic.subscription_end) > now;
    const daysLeft = lic.plan_type === 'trial'
      ? Math.max(0, Math.ceil((new Date(lic.trial_end).getTime() - now.getTime()) / 86400000))
      : lic.plan_type === 'subscription'
        ? Math.max(0, Math.ceil((new Date(lic.subscription_end).getTime() - now.getTime()) / 86400000))
        : 0;
    res.json({ active, plan: lic.plan_type, status: lic.status, daysLeft, trialEnd: lic.trial_end, subscriptionEnd: lic.subscription_end, amount: lic.amount, currency: lic.currency });
  } catch (err: any) { errorResponse(res, 500, 'Failed to fetch license', err); }
});

app.post('/api/license/subscribe', authenticateToken, requireAdmin, async (req: any, res) => {
  try {
    const orgId = req.user.orgId;
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await db.query(
      'INSERT INTO licenses (id, org_id, plan_type, status, subscription_start, subscription_end, amount, currency) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [randomUUID(), orgId, 'subscription', 'active', now.toISOString(), end.toISOString(), 99, 'USD']
    );
    res.json({ message: 'Subscription activated for 30 days', expiresAt: end.toISOString() });
  } catch (err: any) { errorResponse(res, 500, 'Subscription failed', err); }
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
      orgId: user.org_id || '',
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
      orgId: user.org_id || '',
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
      'SELECT id, username, display_name as "displayName", role, org_id as "orgId" FROM users WHERE id = $1',
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
  if (isProduction && process.env.SEED_ADMIN !== 'true') return;
  try {
    // Ensure a default org exists for seeded admin
    let orgId = 'org-default';
    const orgCheck = await db.query('SELECT id FROM organizations WHERE id = $1', [orgId]);
    if (!orgCheck.rows.length) {
      await db.query('INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)', [orgId, 'Default Organization', 'default']);
      const now = new Date(); const far = new Date('2099-12-31');
      await db.query('INSERT INTO licenses (id, org_id, plan_type, status, subscription_start, subscription_end, amount) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [randomUUID(), orgId, 'subscription', 'active', now.toISOString(), far.toISOString(), 0]);
    }
    const hashedPassword = await bcrypt.hash('admin', 12);
    const userResult = await db.query('SELECT * FROM users WHERE username = $1', ['admin']);
    if (!userResult.rows[0]) {
      await db.query('INSERT INTO users (org_id, username, password, display_name, role) VALUES ($1,$2,$3,$4,$5)',
        [orgId, 'admin', hashedPassword, 'Admin', 'admin']);
      console.log('Seeded default admin user (admin/admin). Change the password immediately!');
    } else {
      await db.query('UPDATE users SET role = $1, org_id = COALESCE(NULLIF(org_id, $3), $2) WHERE username = $3', ['admin', orgId, 'admin']);
    }
  } catch (err) { console.warn('Admin seeding skipped:', err); }
};
try { await seedAdmin(); } catch (err) { console.error('Failure during seedAdmin:', err); }

// ============================================================
// ITEMS ROUTES
// ============================================================
app.get('/api/items', authenticateToken, requireActiveLicense, async (req: any, res) => {
  try {
    const result = await db.query('SELECT * FROM items WHERE org_id = $1', [req.user.orgId]);
    res.json(result.rows.map((i: any) => ({ ...i, purchasePrice: i.purchase_price, yieldPercentage: i.yield_percentage, parLevel: i.par_level, createdAt: i.created_at, updatedAt: i.updated_at })));
  } catch (err: any) { errorResponse(res, 500, 'Failed to fetch items', err); }
});

app.post('/api/items', authenticateToken, requireActiveLicense, validate(createItemSchema), async (req: any, res) => {
  try {
    const id = ensureId(req.body);
    const { name, category, unit, purchasePrice, yieldPercentage, parLevel } = req.body;
    await db.query('INSERT INTO items (id, org_id, name, category, unit, purchase_price, yield_percentage, par_level) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, req.user.orgId, name, category, unit, purchasePrice, yieldPercentage, parLevel]);
    res.status(201).json({ id, ...req.body });
  } catch (err: any) { errorResponse(res, 500, 'Failed to create item', err); }
});

app.put('/api/items/:id', authenticateToken, requireActiveLicense, validate(updateItemSchema), async (req: any, res) => {
  try {
    const { name, category, unit, purchasePrice, yieldPercentage, parLevel } = req.body;
    await db.query('UPDATE items SET name=$1, category=$2, unit=$3, purchase_price=$4, yield_percentage=$5, par_level=$6, updated_at=CURRENT_TIMESTAMP WHERE id=$7 AND org_id=$8',
      [name, category, unit, purchasePrice, yieldPercentage, parLevel, req.params.id, req.user.orgId]);
    res.json({ id: req.params.id, ...req.body });
  } catch (err: any) { errorResponse(res, 500, 'Failed to update item', err); }
});

app.delete('/api/items/:id', authenticateToken, requireActiveLicense, async (req: any, res) => {
  try {
    await db.query('DELETE FROM items WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
    res.status(204).end();
  } catch (err: any) { errorResponse(res, 500, 'Failed to delete item', err); }
});

// PURCHASES
app.get('/api/purchases', authenticateToken, requireActiveLicense, async (req: any, res) => {
  try {
    const result = await db.query('SELECT * FROM purchases WHERE org_id = $1', [req.user.orgId]);
    res.json(result.rows.map((r: any) => ({ ...r, itemId: r.item_id, unitPrice: r.unit_price, recordedAt: r.recorded_at })));
  } catch (err: any) { errorResponse(res, 500, 'Failed to fetch purchases', err); }
});

app.post('/api/purchases', authenticateToken, requireActiveLicense, validate(createPurchaseSchema), async (req: any, res) => {
  try {
    const id = ensureId(req.body);
    const { itemId, date, quantity, unitPrice, vendor } = req.body;
    await db.query('INSERT INTO purchases (id, org_id, item_id, date, quantity, unit_price, vendor) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, req.user.orgId, itemId, date, quantity, unitPrice, vendor]);
    res.status(201).json({ id, ...req.body });
  } catch (err: any) { errorResponse(res, 500, 'Failed to create purchase', err); }
});

app.delete('/api/purchases/:id', authenticateToken, requireActiveLicense, async (req: any, res) => {
  try {
    await db.query('DELETE FROM purchases WHERE id=$1 AND org_id=$2', [req.params.id, req.user.orgId]);
    res.status(204).end();
  } catch (err: any) { errorResponse(res, 500, 'Failed to delete purchase', err); }
});

// STOCK ENTRIES
app.get('/api/stock-entries', authenticateToken, requireActiveLicense, async (req: any, res) => {
  try {
    const result = await db.query('SELECT * FROM stock_entries WHERE org_id = $1', [req.user.orgId]);
    res.json(result.rows.map((r: any) => ({ ...r, itemId: r.item_id, closingQuantity: r.closing_quantity, recordedAt: r.recorded_at })));
  } catch (err: any) { errorResponse(res, 500, 'Failed to fetch stock entries', err); }
});

app.post('/api/stock-entries', authenticateToken, requireActiveLicense, validate(createStockEntrySchema), async (req: any, res) => {
  try {
    const id = ensureId(req.body);
    const { date, itemId, closingQuantity } = req.body;
    await db.query('INSERT INTO stock_entries (id, org_id, date, item_id, closing_quantity) VALUES ($1,$2,$3,$4,$5)',
      [id, req.user.orgId, date, itemId, closingQuantity]);
    res.status(201).json({ id, ...req.body });
  } catch (err: any) { errorResponse(res, 500, 'Failed to create stock entry', err); }
});

app.delete('/api/stock-entries/:id', authenticateToken, requireActiveLicense, async (req: any, res) => {
  try {
    await db.query('DELETE FROM stock_entries WHERE id=$1 AND org_id=$2', [req.params.id, req.user.orgId]);
    res.status(204).end();
  } catch (err: any) { errorResponse(res, 500, 'Failed to delete stock entry', err); }
});

// SALES ENTRIES
app.get('/api/sales-entries', authenticateToken, requireActiveLicense, async (req: any, res) => {
  try {
    const result = await db.query('SELECT * FROM sales_entries WHERE org_id = $1', [req.user.orgId]);
    res.json(result.rows.map((r: any) => ({ ...r, recipeId: r.recipe_id, quantitySold: r.quantity_sold, recordedAt: r.recorded_at })));
  } catch (err: any) { errorResponse(res, 500, 'Failed to fetch sales entries', err); }
});

app.post('/api/sales-entries', authenticateToken, requireActiveLicense, validate(createSalesEntrySchema), async (req: any, res) => {
  try {
    const id = ensureId(req.body);
    const { date, recipeId, quantitySold } = req.body;
    await db.query('INSERT INTO sales_entries (id, org_id, date, recipe_id, quantity_sold) VALUES ($1,$2,$3,$4,$5)',
      [id, req.user.orgId, date, recipeId, quantitySold]);
    res.status(201).json({ id, ...req.body });
  } catch (err: any) { errorResponse(res, 500, 'Failed to create sales entry', err); }
});

app.delete('/api/sales-entries/:id', authenticateToken, requireActiveLicense, async (req: any, res) => {
  try {
    await db.query('DELETE FROM sales_entries WHERE id=$1 AND org_id=$2', [req.params.id, req.user.orgId]);
    res.status(204).end();
  } catch (err: any) { errorResponse(res, 500, 'Failed to delete sales entry', err); }
});

// ============================================================
// RECIPES ROUTES
// ============================================================
app.get('/api/recipes', authenticateToken, requireActiveLicense, async (req: any, res) => {
  try {
    const result = await db.query('SELECT * FROM recipes WHERE org_id = $1', [req.user.orgId]);
    const fullRecipes = await Promise.all(result.rows.map(async (r: any) => {
      const ir = await db.query('SELECT * FROM recipe_ingredients WHERE recipe_id = $1', [r.id]);
      return { ...r, portionSize: r.portion_size, totalYield: r.total_yield, sellingPrice: r.selling_price, isLocked: !!r.is_locked, isSubRecipe: !!r.is_sub_recipe, createdAt: r.created_at,
        ingredients: ir.rows.map((i: any) => ({ type: i.type, id: i.target_id, quantity: i.quantity, costAtTime: i.cost_at_time })) };
    }));
    res.json(fullRecipes);
  } catch (err: any) { errorResponse(res, 500, 'Failed to fetch recipes', err); }
});

app.post('/api/recipes', authenticateToken, requireActiveLicense, validate(createRecipeSchema), async (req: any, res) => {
  try {
    const id = ensureId(req.body);
    const { name, portionSize, totalYield, sellingPrice, isLocked, isSubRecipe, ingredients } = req.body;

    await db.transaction(async () => {
      await db.query(
        'INSERT INTO recipes (id, org_id, name, portion_size, total_yield, selling_price, is_locked, is_sub_recipe) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [id, req.user.orgId, name, portionSize, totalYield, sellingPrice, isLocked ? 1 : 0, isSubRecipe ? 1 : 0]
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

app.put('/api/recipes/:id', authenticateToken, requireActiveLicense, validate(updateRecipeSchema), async (req: any, res) => {
  try {
    const { name, portionSize, totalYield, sellingPrice, isLocked, isSubRecipe, ingredients } = req.body;
    const id = req.params.id;
    await db.transaction(async () => {
      await db.query(
        'UPDATE recipes SET name=$1, portion_size=$2, total_yield=$3, selling_price=$4, is_locked=$5, is_sub_recipe=$6 WHERE id=$7 AND org_id=$8',
        [name, portionSize, totalYield, sellingPrice, isLocked ? 1 : 0, isSubRecipe ? 1 : 0, id, req.user.orgId]
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

app.delete('/api/recipes/:id', authenticateToken, requireActiveLicense, async (req: any, res) => {
  try {
    await db.transaction(async () => {
      await db.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [req.params.id]);
      await db.query('DELETE FROM recipes WHERE id = $1 AND org_id = $2', [req.params.id, req.user.orgId]);
    });
    res.status(204).end();
  } catch (err: any) { errorResponse(res, 500, 'Failed to delete recipe', err); }
});

// SETTINGS (per org)
app.get('/api/settings', authenticateToken, async (req: any, res) => {
  try {
    const result = await db.query('SELECT value FROM settings WHERE org_id = $1 AND setting_key = $2', [req.user.orgId, 'config']);
    const row = result.rows[0];
    if (row) { res.json(JSON.parse(row.value)); }
    else { res.json({ categories: ['Vegetables','Dairy','Dry Goods','Meat','Seafood','Poultry'], currency: { symbol: 'R', code: 'ZAR' } }); }
  } catch (err: any) { errorResponse(res, 500, 'Failed to fetch settings', err); }
});

app.post('/api/settings', authenticateToken, requireAdmin, validate(settingsSchema), async (req: any, res) => {
  try {
    await db.transaction(async () => {
      await db.query('DELETE FROM settings WHERE org_id = $1 AND setting_key = $2', [req.user.orgId, 'config']);
      await db.query('INSERT INTO settings (org_id, setting_key, value) VALUES ($1, $2, $3)', [req.user.orgId, 'config', JSON.stringify(req.body)]);
    });
    res.json(req.body);
  } catch (err: any) { errorResponse(res, 500, 'Failed to save settings', err); }
});

// USER MANAGEMENT (admin, scoped to org)
app.get('/api/users', authenticateToken, requireAdmin, async (req: any, res) => {
  try {
    const result = await db.query('SELECT id, username, display_name as "displayName", role FROM users WHERE org_id = $1', [req.user.orgId]);
    res.json(result.rows);
  } catch (err: any) { errorResponse(res, 500, 'Failed to fetch users', err); }
});

app.post('/api/users', authenticateToken, requireAdmin, validate(createUserSchema), async (req: any, res) => {
  const { username, password, displayName } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    const result = await db.query(
      'INSERT INTO users (org_id, username, password, display_name, role) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [req.user.orgId, username, hashedPassword, displayName, 'staff']
    );
    const id = result.rows[0]?.id || result.lastInsertRowid;
    res.status(201).json({ id, username, displayName, role: 'staff' });
  } catch (err: any) {
    const code = err.code || '';
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === '23505' || code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Username already exists' });
    errorResponse(res, 500, 'Failed to create user', err);
  }
});

app.put('/api/users/:id', authenticateToken, requireAdmin, validate(updateUserSchema), async (req: any, res) => {
  const { username, password, displayName } = req.body;
  try {
    if (password) {
      const h = await bcrypt.hash(password, 12);
      await db.query('UPDATE users SET username=$1, password=$2, display_name=$3 WHERE id=$4 AND org_id=$5', [username, h, displayName, req.params.id, req.user.orgId]);
    } else {
      await db.query('UPDATE users SET username=$1, display_name=$2 WHERE id=$3 AND org_id=$4', [username, displayName, req.params.id, req.user.orgId]);
    }
    res.json({ id: req.params.id, username, displayName });
  } catch (err: any) { errorResponse(res, 500, 'Failed to update user', err); }
});

app.delete('/api/users/:id', authenticateToken, requireAdmin, async (req: any, res) => {
  try {
    if (req.params.id === req.user.id.toString()) return res.status(400).json({ error: 'You cannot delete yourself' });
    await db.query('DELETE FROM users WHERE id=$1 AND org_id=$2', [req.params.id, req.user.orgId]);
    res.status(204).end();
  } catch (err: any) { errorResponse(res, 500, 'Failed to delete user', err); }
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
