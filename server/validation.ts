import { z } from 'zod';

// --- Reusable schemas ---
const idSchema = z.string().min(1).max(255);
const dateSchema = z.string().min(1).max(30);

// --- Auth ---
export const loginSchema = z.object({
  username: z.string().min(1).max(255).trim(),
  password: z.string().min(1).max(255),
});

export const registerSchema = z.object({
  username: z.string().min(1).max(255).trim(),
  password: z.string().min(6).max(255),
  displayName: z.string().min(1).max(255).trim(),
});

// --- Items ---
export const createItemSchema = z.object({
  id: idSchema.optional(),
  name: z.string().min(1).max(500).trim(),
  category: z.string().max(255).optional().default(''),
  unit: z.string().min(1).max(50),
  purchasePrice: z.coerce.number().min(0).default(0),
  yieldPercentage: z.coerce.number().min(0).max(200).default(100),
  parLevel: z.coerce.number().min(0).default(0),
});

export const updateItemSchema = createItemSchema.omit({ id: true });

// --- Purchases ---
export const createPurchaseSchema = z.object({
  id: idSchema.optional(),
  itemId: idSchema,
  date: dateSchema,
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  vendor: z.string().max(500).optional().default(''),
});

// --- Stock Entries ---
export const createStockEntrySchema = z.object({
  id: idSchema.optional(),
  date: dateSchema,
  itemId: idSchema,
  closingQuantity: z.coerce.number().min(0),
});

// --- Sales Entries ---
export const createSalesEntrySchema = z.object({
  id: idSchema.optional(),
  date: dateSchema,
  recipeId: idSchema,
  quantitySold: z.coerce.number().min(0),
});

// --- Recipes ---
const recipeIngredientSchema = z.object({
  type: z.enum(['item', 'recipe']),
  id: idSchema,
  quantity: z.coerce.number().positive(),
  costAtTime: z.coerce.number().min(0).optional(),
});

export const createRecipeSchema = z.object({
  id: idSchema.optional(),
  name: z.string().min(1).max(500).trim(),
  portionSize: z.coerce.number().positive(),
  totalYield: z.coerce.number().min(0).optional().nullable(),
  sellingPrice: z.coerce.number().min(0).default(0),
  isLocked: z.boolean().default(false),
  isSubRecipe: z.boolean().default(false),
  ingredients: z.array(recipeIngredientSchema).default([]),
});

export const updateRecipeSchema = createRecipeSchema.omit({ id: true });

// --- Settings ---
export const settingsSchema = z.object({
  categories: z.array(z.string().max(255)).default([]),
  currency: z.object({
    symbol: z.string().min(1).max(10),
    code: z.string().min(2).max(10),
  }),
});

// --- User Management ---
export const createUserSchema = z.object({
  username: z.string().min(1).max(255).trim(),
  password: z.string().min(6).max(255),
  displayName: z.string().min(1).max(255).trim(),
});

export const updateUserSchema = z.object({
  username: z.string().min(1).max(255).trim(),
  password: z.string().min(6).max(255).optional(),
  displayName: z.string().min(1).max(255).trim(),
});

// --- Organization Registration ---
export const orgRegisterSchema = z.object({
  orgName: z.string().min(2).max(255).trim(),
  username: z.string().min(1).max(255).trim(),
  password: z.string().min(6).max(255),
  displayName: z.string().min(1).max(255).trim(),
});
