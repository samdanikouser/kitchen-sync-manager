import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Item, Recipe, StockEntry, SalesEntry, MarketListItem, Purchase } from '../types';
import { ShoppingBag, TrendingDown, Package, AlertCircle, CheckCircle2, DollarSign, PieChart, Info, Calendar, TrendingUp } from 'lucide-react';
import { format, startOfWeek, startOfMonth, endOfDay } from 'date-fns';
import { cn, formatNumber, formatCurrency } from '../lib/utils';
import { motion } from 'motion/react';
import { useSettings } from '../lib/SettingsContext';

type FilterPeriod = 'today' | 'week' | 'month';

export default function Dashboard() {
  const { settings } = useSettings();
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [period, setPeriod] = useState<FilterPeriod>('today');
  const [loading, setLoading] = useState(true);
  const [marketList, setMarketList] = useState<MarketListItem[]>([]);
  const [financials, setFinancials] = useState({
    totalSales: 0,
    consumptionCost: 0,
    foodCostPerc: 0
  });

  const calculateRecursiveUsage = (
    recipe: Recipe, 
    qtySold: number, 
    allRecipes: Recipe[], 
    usageMap: Record<string, number>
  ) => {
    recipe.ingredients.forEach(ing => {
      const actualQty = (ing.quantity / recipe.portionSize) * qtySold;
      if (ing.type === 'item') {
        usageMap[ing.id] = (usageMap[ing.id] || 0) + actualQty;
      } else {
        const subRecipe = allRecipes.find(r => r.id === ing.id);
        if (subRecipe) {
          calculateRecursiveUsage(subRecipe, actualQty, allRecipes, usageMap);
        }
      }
    });
  };

  const calculateMetrics = async (selectedDate: string, selectedPeriod: FilterPeriod) => {
    setLoading(true);
    try {
      const start = selectedPeriod === 'week' ? format(startOfWeek(new Date(selectedDate)), 'yyyy-MM-dd') : format(startOfMonth(new Date(selectedDate)), 'yyyy-MM-dd');

      const [iData, rData, sData, saData, pData] = await Promise.all([
        api.items.list(),
        api.recipes.list(),
        api.stock.list(),
        api.sales.list(),
        api.purchases.list()
      ]);

      const items = iData;
      const recipes = rData;
      
      const salesEntries = selectedPeriod === 'today' 
        ? saData.filter(s => s.date === selectedDate)
        : saData.filter(s => s.date >= start && s.date <= selectedDate);
        
      const stockEntries = sData.filter(e => e.date === selectedDate);
      
      const purchaseEntries = selectedPeriod === 'today'
        ? pData.filter(p => p.date === selectedDate)
        : pData.filter(p => p.date >= start && p.date <= selectedDate);

      // 1. Calculate Consumption & Sales Value
      const usageMap: Record<string, number> = {};
      let totalSales = 0;
      
      salesEntries.forEach(sale => {
        const recipe = recipes.find(r => r.id === sale.recipeId);
        if (recipe) {
          totalSales += (recipe.sellingPrice || 0) * sale.quantitySold;
          calculateRecursiveUsage(recipe, sale.quantitySold, recipes, usageMap);
        }
      });

      // 2. Consumption Cost
      let consumptionCost = 0;
      Object.entries(usageMap).forEach(([itemId, qty]) => {
        const item = items.find(i => i.id === itemId);
        if (item) {
          const actualCost = item.purchasePrice / (item.yieldPercentage / 100);
          consumptionCost += actualCost * qty;
        }
      });

      // 3. Build Market List (using Received Stock)
      const list: MarketListItem[] = items.map(item => {
        const entry = stockEntries.find(e => e.itemId === item.id);
        const openingStock = entry ? entry.closingQuantity : 0;
        
        const received = purchaseEntries
            .filter(p => p.itemId === item.id)
            .reduce((acc, curr) => acc + curr.quantity, 0);

        const totalCons = usageMap[item.id] || 0;
        const closingStock = Math.max(0, openingStock + received - totalCons);
        const orderQty = Math.max(0, item.parLevel - closingStock);

        return {
          itemId: item.id,
          itemName: item.name,
          unit: item.unit,
          openingStock,
          received,
          consumption: totalCons,
          closingStock,
          parLevel: item.parLevel,
          orderQty
        };
      });

      setMarketList(list);
      setFinancials({
        totalSales,
        consumptionCost,
        foodCostPerc: totalSales > 0 ? (consumptionCost / totalSales) * 100 : 0
      });
    } catch (err) {
      if (!(err instanceof Error && err.message === 'Unauthorized')) {
        console.error("Dashboard error:", err);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    calculateMetrics(date, period);
  }, [date, period]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h1 className="text-3xl font-black tracking-tighter text-zinc-900 font-['Courier_New']">KITCHEN ANALYTICS</h1>
          <p className="text-zinc-500 font-medium italic">Real-time inventory health and food cost tracking.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-white rounded-lg border border-zinc-200 p-1 shadow-sm">
            {(['today', 'week', 'month'] as FilterPeriod[]).map((p) => (
                <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={cn(
                        "px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded-md transition-all",
                        period === p ? "bg-zinc-900 text-white shadow-md" : "text-zinc-400 hover:text-zinc-600"
                    )}
                >
                    {p}
                </button>
            ))}
          </div>
          <div className="flex items-center gap-2 bg-white p-2 rounded-lg border border-zinc-200 shadow-sm">
            <Calendar className="h-4 w-4 text-zinc-400" />
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="border-none bg-transparent focus:ring-0 text-xs font-bold uppercase tracking-widest outline-none"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="rounded-2xl bg-white border border-zinc-200 p-6 shadow-sm overflow-hidden relative">
            <DollarSign className="absolute -right-4 -bottom-4 h-24 w-24 text-zinc-50 opacity-10" />
            <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-zinc-900 text-white rounded-lg">
                    <TrendingUp className="h-5 w-5" />
                </div>
                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Total Sales</span>
            </div>
            <div className="text-3xl font-black tracking-tighter">{formatCurrency(financials.totalSales, settings.currency.code)}</div>
            <p className="text-xs text-zinc-500 mt-2 font-medium">Revenue during {period}</p>
        </div>

        <div className="rounded-2xl bg-white border border-zinc-200 p-6 shadow-sm overflow-hidden relative">
            <Package className="absolute -right-4 -bottom-4 h-24 w-24 text-red-50 opacity-5" />
            <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-red-50 text-red-600 rounded-lg">
                    <TrendingDown className="h-5 w-5" />
                </div>
                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Consumption</span>
            </div>
            <div className="text-3xl font-black tracking-tighter">{formatCurrency(financials.consumptionCost, settings.currency.code)}</div>
            <p className="text-xs text-zinc-500 mt-2 font-medium">Cost of goods sold</p>
        </div>

        <div className="rounded-2xl bg-white border border-zinc-200 p-6 shadow-sm overflow-hidden relative">
            <PieChart className="absolute -right-4 -bottom-4 h-24 w-24 text-zinc-50 opacity-10" />
            <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                    <PieChart className="h-5 w-5" />
                </div>
                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Food Cost %</span>
            </div>
            <div className={cn("text-3xl font-black tracking-tighter", financials.foodCostPerc > 35 ? "text-red-500" : "text-zinc-900")}>
                {Math.round(financials.foodCostPerc)}%
            </div>
            <p className="text-xs text-zinc-500 mt-2 font-medium">Target: &lt; 35%</p>
        </div>
      </div>

      <div className="p-8 border border-zinc-200 rounded-2xl bg-white text-center">
        <Info className="h-8 w-8 text-zinc-200 mx-auto mb-2" />
        <p className="text-sm font-medium text-zinc-500 italic">
          Financial metrics are aggregated based on the selected period. 
          Use the <span className="font-bold">Market List</span> tab for purchasing suggestions.
        </p>
      </div>
    </div>
  );
}

