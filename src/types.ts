export type Unit = 'kg' | 'L' | 'pcs';

export interface Item {
  id: string;
  name: string;
  category?: string;
  unit: Unit;
  purchasePrice: number;
  yieldPercentage: number;
  parLevel: number;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  id: string;
  categories: string[];
  currency: {
    symbol: string;
    code: string;
  };
}

export interface RecipeIngredient {
  type: 'item' | 'recipe';
  id: string; // Either itemId or recipeId
  quantity: number;
  costAtTime?: number; // Snapshot of cost (unit price for items, portion price for sub-recipes)
}

export interface Recipe {
  id: string;
  name: string;
  portionSize: number;
  totalYield?: number; // Final weight/volume after cooking
  sellingPrice: number;
  ingredients: RecipeIngredient[];
  isLocked: boolean;
  isSubRecipe: boolean;
  createdAt: string;
}

export interface Purchase {
  id: string;
  itemId: string;
  date: string;
  quantity: number;
  unitPrice: number;
  vendor?: string;
  recordedAt: string;
}

export interface StockEntry {
  id: string;
  date: string; // YYYY-MM-DD
  itemId: string;
  closingQuantity: number;
  recordedAt: string;
}

export interface SalesEntry {
  id: string;
  date: string; // YYYY-MM-DD
  recipeId: string;
  quantitySold: number;
  recordedAt: string;
}

export interface ConsumptionData {
  itemId: string;
  quantity: number;
}

export interface MarketListItem {
  itemId: string;
  itemName: string;
  unit: Unit;
  openingStock: number;
  received: number;
  consumption: number;
  closingStock: number;
  parLevel: number;
  orderQty: number;
}
