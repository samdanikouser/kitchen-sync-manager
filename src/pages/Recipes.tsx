import { useState, useEffect, type FormEvent } from 'react';
import { api } from '../lib/api';
import { Item, Recipe, RecipeIngredient, Purchase } from '../types';
import { Plus, Trash2, CookingPot, Layers, Save, TrendingUp, Info, Edit2 } from 'lucide-react';
import { cn, formatNumber, formatCurrency } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useSettings } from '../lib/SettingsContext';

export default function Recipes() {
  const { settings } = useSettings();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Form State
  const [recipeName, setRecipeName] = useState('');
  const [portionSize, setPortionSize] = useState(1);
  const [totalYield, setTotalYield] = useState(1);
  const [sellingPrice, setSellingPrice] = useState(0);
  const [isSubRecipe, setIsSubRecipe] = useState(false);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [itemsData, recipesData, purchasesData] = await Promise.all([
        api.items.list(),
        api.recipes.list(),
        api.purchases.list()
      ]);
      
      setItems(itemsData);
      setRecipes(recipesData);
      setPurchases(purchasesData);
    } catch (err) {
      console.error("Error fetching recipe data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const getAverageCost = (itemId: string) => {
    const itemPurchases = purchases.filter(p => p.itemId === itemId);
    if (itemPurchases.length === 0) {
        const item = items.find(i => i.id === itemId);
        return item ? item.purchasePrice : 0;
    }

    const totalQty = itemPurchases.reduce((sum, p) => sum + p.quantity, 0);
    const totalCost = itemPurchases.reduce((sum, p) => sum + (p.quantity * p.unitPrice), 0);
    
    return totalQty > 0 ? totalCost / totalQty : 0;
  };

  const getSubRecipeCost = (id: string, visited = new Set()): number => {
    if (visited.has(id)) return 0; // Prevent infinite recursion
    visited.add(id);

    const recipe = recipes.find(r => r.id === id);
    if (!recipe) return 0;

    let total = 0;
    recipe.ingredients.forEach(ing => {
      if (ing.type === 'item') {
        const item = items.find(it => it.id === ing.id);
        if (item) {
          // Use stored cost if available, otherwise fallback to current average
          const basePrice = (ing.costAtTime !== undefined && ing.costAtTime !== null) ? ing.costAtTime : getAverageCost(item.id);
          const costAfterYield = basePrice / (item.yieldPercentage / 100);
          total += costAfterYield * ing.quantity;
        }
      } else {
        // For sub-recipes, costAtTime stores the portion cost
        const subCost = (ing.costAtTime !== undefined && ing.costAtTime !== null) ? ing.costAtTime : getSubRecipeCost(ing.id, visited);
        total += subCost * ing.quantity;
      }
    });
    return recipe.portionSize > 0 ? total / recipe.portionSize : 0;
  };

  const calculateTotalCost = (ings: RecipeIngredient[]) => {
    let total = 0;
    ings.forEach(ing => {
      if (ing.type === 'item') {
        const item = items.find(it => it.id === ing.id);
        if (item) {
          const basePrice = (ing.costAtTime !== undefined && ing.costAtTime !== null) ? ing.costAtTime : getAverageCost(item.id);
          const costAfterYield = basePrice / (item.yieldPercentage / 100);
          total += costAfterYield * ing.quantity;
        }
      } else {
        const subCost = (ing.costAtTime !== undefined && ing.costAtTime !== null) ? ing.costAtTime : getSubRecipeCost(ing.id);
        total += subCost * ing.quantity;
      }
    });
    return total;
  };

  const handleRefreshCosts = () => {
    const refreshed = ingredients.map(ing => ({
      ...ing,
      costAtTime: ing.type === 'item' ? getAverageCost(ing.id) : getSubRecipeCost(ing.id)
    }));
    setIngredients(refreshed);
    alert('All ingredient costs refreshed to current market rates.');
  };

  const handleAddIngredient = (type: 'item' | 'recipe') => {
    if (type === 'item' && items.length > 0) {
      setIngredients([...ingredients, { type: 'item', id: items[0].id, quantity: 0, costAtTime: getAverageCost(items[0].id) }]);
    } else if (type === 'recipe' && recipes.length > 0) {
      setIngredients([...ingredients, { type: 'recipe', id: recipes[0].id, quantity: 0, costAtTime: getSubRecipeCost(recipes[0].id) }]);
    }
  };

  const removeIngredient = (index: number) => {
    setIngredients(ingredients.filter((_, i) => i !== index));
  };

  const updateIngredient = (index: number, field: keyof RecipeIngredient, value: any) => {
    const newIngs = [...ingredients];
    const ing = { ...newIngs[index], [field]: value } as RecipeIngredient;
    
    // Auto-update price snapshot if item/recipe changes during editing
    if (field === 'id') {
        if (ing.type === 'item') {
            ing.costAtTime = getAverageCost(value as string);
        } else {
            ing.costAtTime = getSubRecipeCost(value as string);
        }
    }
    
    newIngs[index] = ing;
    setIngredients(newIngs);
  };

  const handleSaveRecipe = async (e: FormEvent) => {
    e.preventDefault();
    if (ingredients.length === 0) {
      alert('Add at least one ingredient');
      return;
    }
    try {
      // Snapshot current prices before saving
      const snapshottedIngredients = ingredients.map(ing => ({
          ...ing,
          costAtTime: ing.type === 'item' ? getAverageCost(ing.id) : getSubRecipeCost(ing.id)
      }));

      const data: Recipe = {
        id: editingId || crypto.randomUUID(),
        name: recipeName,
        portionSize,
        totalYield,
        sellingPrice,
        isSubRecipe,
        ingredients: snapshottedIngredients,
        isLocked: false,
        createdAt: new Date().toISOString(),
      };

      if (editingId) {
        await api.recipes.update(editingId, data);
        setEditingId(null);
      } else {
        await api.recipes.create(data);
      }

      setIsAdding(false);
      setRecipeName('');
      setPortionSize(1);
      setTotalYield(1);
      setSellingPrice(0);
      setIsSubRecipe(false);
      setIngredients([]);
      fetchAll();
    } catch (err) {
      console.error("Error saving recipe:", err);
    }
  };

  const handleEditRecipe = (recipe: Recipe) => {
    setRecipeName(recipe.name);
    setPortionSize(recipe.portionSize);
    setTotalYield(recipe.totalYield || 1);
    setSellingPrice(recipe.sellingPrice || 0);
    setIsSubRecipe(recipe.isSubRecipe || false);
    setIngredients(recipe.ingredients);
    setEditingId(recipe.id);
    setIsAdding(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteRecipe = async (id: string) => {
    if (!confirm('Delete this recipe?')) return;
    try {
      await api.recipes.delete(id);
      fetchAll();
    } catch (err) {
      console.error("Error deleting recipe:", err);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Recipe Management</h1>
          <p className="text-zinc-500 font-medium">Map menu items, calculate costs, and manage sub-recipes.</p>
        </div>
        <button
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-800"
        >
          <Plus className="h-4 w-4" />
          Create Recipe
        </button>
      </div>

      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
          >
            <form onSubmit={handleSaveRecipe} className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xl space-y-6">
              <h2 className="text-xl font-bold">{editingId ? 'Edit Recipe' : 'Create Recipe'}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Dish Name</label>
                  <input
                    required
                    value={recipeName}
                    onChange={e => setRecipeName(e.target.value)}
                    className="rounded-md border border-zinc-200 px-3 py-2 text-sm focus:ring-2 focus:ring-zinc-900"
                    placeholder="e.g. Classic Beef Burger"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Portion Size</label>
                  <input
                    required
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={isNaN(portionSize) ? '' : portionSize}
                    onChange={e => setPortionSize(parseFloat(e.target.value))}
                    className="rounded-md border border-zinc-200 px-3 py-2 text-sm focus:ring-2 focus:ring-zinc-900"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Final Yield (kg/L)</label>
                  <input
                    required
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={isNaN(totalYield) ? '' : totalYield}
                    onChange={e => setTotalYield(parseFloat(e.target.value))}
                    className="rounded-md border border-zinc-200 px-3 py-2 text-sm focus:ring-2 focus:ring-zinc-900"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Selling Price ({settings.currency.symbol})</label>
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={isNaN(sellingPrice) ? '' : sellingPrice}
                    onChange={e => setSellingPrice(parseFloat(e.target.value))}
                    className="rounded-md border border-zinc-200 px-3 py-2 text-sm focus:ring-2 focus:ring-zinc-900"
                  />
                </div>
                <div className="flex items-center gap-3 pt-6">
                    <input 
                        type="checkbox" 
                        checked={isSubRecipe} 
                        onChange={e => setIsSubRecipe(e.target.checked)}
                        className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                    />
                    <label className="text-sm font-medium text-zinc-700">Can be used as Sub-Recipe</label>
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t border-zinc-100">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Ingredients & Components</h3>
                    {ingredients.length > 0 && (
                      <button
                        type="button"
                        onClick={handleRefreshCosts}
                        className="text-[10px] font-bold text-blue-600 hover:text-blue-700 uppercase tracking-tight flex items-center gap-1"
                      >
                        <TrendingUp className="h-3 w-3" />
                        Refresh all to current market
                      </button>
                    )}
                  </div>
                  <div className="flex gap-4">
                    <button
                        type="button"
                        onClick={() => handleAddIngredient('item')}
                        className="text-xs font-bold text-zinc-700 hover:text-zinc-900 bg-zinc-50 px-3 py-1 rounded-full border border-zinc-200"
                    >
                        + Add Raw Material
                    </button>
                    <button
                        type="button"
                        onClick={() => handleAddIngredient('recipe')}
                        className="text-xs font-bold text-zinc-700 hover:text-zinc-900 bg-zinc-50 px-3 py-1 rounded-full border border-zinc-200"
                    >
                        + Add Sub-Recipe
                    </button>
                  </div>
                </div>
                
                {ingredients.map((ing, idx) => (
                  <div key={idx} className="flex gap-4 items-center">
                    <div className="text-[10px] font-bold text-zinc-400 uppercase w-12">{ing.type}</div>
                    <select
                      value={ing.id}
                      onChange={e => updateIngredient(idx, 'id', e.target.value)}
                      className="flex-1 rounded-md border border-zinc-200 px-3 py-2 text-sm"
                    >
                      {ing.type === 'item' ? (
                        items.map(item => (
                            <option key={item.id} value={item.id}>
                                {item.name} ({formatCurrency(getAverageCost(item.id) / (item.yieldPercentage / 100), settings.currency.code)}/{item.unit} - AVG)
                            </option>
                        ))
                      ) : (
                        recipes.filter(r => r.isSubRecipe).map(r => (
                            <option key={r.id} value={r.id}>
                                {r.name} ({formatCurrency(getSubRecipeCost(r.id), settings.currency.code)}/portion)
                            </option>
                        ))
                      )}
                    </select>
                    <div className="flex items-center gap-2">
                        <div className="bg-zinc-50 px-3 py-2 rounded-md border border-zinc-200 min-w-[100px] text-right">
                           <p className="text-[8px] font-bold text-zinc-400 uppercase leading-none mb-1">Line Cost</p>
                           <p className="text-sm font-mono font-bold">
                             {formatCurrency(
                               (() => {
                                 const base = ing.costAtTime || 0;
                                 if (ing.type === 'item') {
                                   const it = items.find(i => i.id === ing.id);
                                   const yieldMult = (it?.yieldPercentage || 100) / 100;
                                   return (base / yieldMult) * (ing.quantity || 0);
                                 }
                                 return base * (ing.quantity || 0);
                               })(), 
                               settings.currency.code
                             )}
                           </p>
                        </div>
                        <input
                        required
                        type="number"
                        step="0.001"
                        min="0"
                        value={isNaN(ing.quantity) ? '' : (ing.quantity || '')}
                        onChange={e => updateIngredient(idx, 'quantity', parseFloat(e.target.value))}
                        className="w-24 rounded-md border border-zinc-200 px-3 py-2 text-sm text-right"
                        placeholder="Qty"
                        />
                        <span className="text-xs font-medium text-zinc-400 w-12">
                            {ing.type === 'item' ? items.find(i => i.id === ing.id)?.unit : 'portions'}
                        </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeIngredient(idx)}
                      className="rounded-md p-2 text-zinc-400 hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between pt-6 border-t border-zinc-100">
                <div className="flex gap-8">
                    <div>
                        <p className="text-[10px] font-bold text-zinc-400 uppercase">Estimated Batch Cost</p>
                        <p className="text-xl font-bold font-mono">{formatCurrency(calculateTotalCost(ingredients), settings.currency.code)}</p>
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-zinc-400 uppercase">Cost Per Portion</p>
                        <p className="text-xl font-bold font-mono">{formatCurrency(calculateTotalCost(ingredients) / portionSize, settings.currency.code)}</p>
                    </div>
                </div>
                <div className="flex gap-3">
                    <button
                    type="button"
                    onClick={() => {
                        setIsAdding(false);
                        setEditingId(null);
                        setRecipeName('');
                        setPortionSize(1);
                        setTotalYield(1);
                        setSellingPrice(0);
                        setIsSubRecipe(false);
                        setIngredients([]);
                    }}
                    className="rounded-md px-4 py-2 text-sm font-medium text-zinc-500 hover:bg-zinc-50"
                    >
                    Cancel
                    </button>
                    <button
                    type="submit"
                    className="flex items-center gap-2 rounded-md bg-zinc-900 px-8 py-2 text-sm font-bold text-white hover:bg-zinc-800 shadow-xl shadow-zinc-200"
                    >
                    <Save className="h-4 w-4" />
                    {editingId ? 'Update Recipe' : 'Save Recipe'}
                    </button>
                </div>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {recipes.map(recipe => {
            const costPerPortion = getSubRecipeCost(recipe.id);
            const foodCostPerc = recipe.sellingPrice > 0 ? (costPerPortion / recipe.sellingPrice) * 100 : 0;
            
            return (
                <motion.div
                    layout
                    key={recipe.id}
                    className="group relative rounded-xl border border-zinc-200 bg-white p-6 shadow-sm hover:shadow-md transition-all"
                >
                    <div className="flex justify-between items-start mb-6">
                        <div className="flex gap-4">
                            <div className={cn("p-3 rounded-xl", recipe.isSubRecipe ? "bg-purple-50 text-purple-600" : "bg-blue-50 text-blue-600")}>
                                {recipe.isSubRecipe ? <Layers className="h-6 w-6" /> : <CookingPot className="h-6 w-6" />}
                            </div>
                            <div>
                                <h2 className="text-xl font-extrabold text-zinc-900">{recipe.name}</h2>
                                <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
                                    {recipe.portionSize} Portions • {recipe.totalYield} Yield
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleEditRecipe(recipe)}
                                className="rounded-md p-2 text-zinc-200 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
                            >
                                <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                                onClick={() => handleDeleteRecipe(recipe.id)}
                                className="rounded-md p-2 text-zinc-200 hover:text-red-600 hover:bg-red-50 transition-all"
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4 mb-6">
                        <div className="bg-zinc-50 rounded-lg p-3">
                            <p className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Selling</p>
                            <p className="text-sm font-black font-mono">{formatCurrency(recipe.sellingPrice, settings.currency.code)}</p>
                        </div>
                        <div className="bg-zinc-50 rounded-lg p-3">
                            <p className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Cost/Portion</p>
                            <p className="text-sm font-black font-mono">{formatCurrency(costPerPortion, settings.currency.code)}</p>
                        </div>
                        <div className="bg-zinc-50 rounded-lg p-3">
                            <p className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Food Cost %</p>
                            <p className={cn("text-sm font-black font-mono", foodCostPerc > 35 ? "text-red-500" : "text-green-600")}>
                                {Math.round(foodCostPerc)}%
                            </p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <p className="text-[10px] font-bold text-zinc-400 uppercase flex items-center gap-2">
                           Composition
                        </p>
                        {recipe.ingredients.map((ing, i) => {
                            const detail = ing.type === 'item' ? items.find(it => it.id === ing.id) : recipes.find(r => r.id === ing.id);
                            const lockedValue = (ing.costAtTime !== undefined && ing.costAtTime !== null) ? ing.costAtTime : null;
                            const currentPrice = ing.type === 'item' ? getAverageCost(ing.id) : getSubRecipeCost(ing.id);
                            const isDifferent = lockedValue !== null && Math.abs(lockedValue - currentPrice) > 0.01;
                            
                            const basePrice = lockedValue ?? currentPrice;
                            const yieldMult = ing.type === 'item' ? ((detail as Item)?.yieldPercentage || 100) / 100 : 1;
                            const ingCost = (basePrice / yieldMult) * ing.quantity;

                            return (
                                <div key={i} className="flex justify-between items-center text-xs py-1 border-b border-dotted border-zinc-100 last:border-0 text-zinc-600">
                                    <span className="truncate max-w-[200px] flex items-center gap-1">
                                        {ing.type === 'recipe' && <span className="mr-1 text-[8px] border border-purple-200 text-purple-600 px-1 rounded uppercase font-bold">Sub</span>}
                                        {detail?.name}
                                        {lockedValue !== null && (
                                          <span className={cn(
                                            "text-[8px] px-1 rounded font-bold uppercase",
                                            isDifferent ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-400"
                                          )}>
                                            {isDifferent ? 'Stale' : 'Locked'}
                                          </span>
                                        )}
                                    </span>
                                    <div className="flex gap-4 font-mono font-medium">
                                        <span>{ing.quantity} {ing.type === 'item' ? (detail as Item)?.unit : 'port'}</span>
                                        <span className="w-16 text-right text-zinc-900">{formatCurrency(ingCost, settings.currency.code)}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </motion.div>
            );
        })}
      </div>
    </div>
  );
}

