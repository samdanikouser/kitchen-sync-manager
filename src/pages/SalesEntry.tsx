import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Recipe, SalesEntry } from '../types';
import { Calendar, BarChart3, Save, Search, Trash2, PlusCircle } from 'lucide-react';
import { format } from 'date-fns';

export default function SalesEntryPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [sales, setSales] = useState<SalesEntry[]>([]);
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Buffer
  const [soldAmounts, setSoldAmounts] = useState<Record<string, number>>({});

  const fetchData = async (selectedDate: string) => {
    setLoading(true);
    try {
      const [fetchedRecipes, allSales] = await Promise.all([
        api.recipes.list(),
        api.sales.list()
      ]);
      setRecipes(fetchedRecipes);

      const fetchedSales = allSales.filter(s => s.date === selectedDate);
      setSales(fetchedSales);

      const initialSold: Record<string, number> = {};
      fetchedRecipes.forEach(recipe => {
        const sale = fetchedSales.find(s => s.recipeId === recipe.id);
        initialSold[recipe.id] = sale ? sale.quantitySold : 0;
      });
      setSoldAmounts(initialSold);
    } catch (err) {
      console.error("Error fetching sales data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(date);
  }, [date]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const allSales = await api.sales.list();
      const existingSales = allSales.filter(s => s.date === date);
      
      await Promise.all(existingSales.map(s => api.sales.delete(s.id)));

      await Promise.all(recipes.map(recipe => {
        const sold = soldAmounts[recipe.id];
        if (typeof sold === 'number' && sold > 0) {
          return api.sales.create({
            id: crypto.randomUUID(),
            date,
            recipeId: recipe.id,
            quantitySold: sold,
          });
        }
        return Promise.resolve();
      }));

      await fetchData(date);
      alert('Sales recorded successfully.');
    } catch (err) {
      console.error("Error saving sales:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleIndividualDelete = async (saleId: string) => {
    if (!confirm('Delete this sales record?')) return;
    setSaving(true);
    try {
      await api.sales.delete(saleId);
      await fetchData(date);
    } catch (err) {
      console.error("Error deleting sales record:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Daily Sales Entry</h1>
          <p className="text-zinc-500">Log quantities of menu items sold to calculate ingredient consumption.</p>
        </div>
        <div className="flex items-center gap-4 bg-white p-2 rounded-lg border border-zinc-200 shadow-sm">
          <Calendar className="h-5 w-5 text-zinc-400 ml-2" />
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="border-none bg-transparent focus:ring-0 text-sm font-semibold"
          />
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-sm">
        <div className="p-4 border-b border-zinc-100 flex justify-between items-center bg-zinc-50 shadow-inner">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-zinc-500" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-500">Sales Record</h2>
          </div>
          <div className="flex gap-2">
            {sales.length > 0 && (
              <button
                onClick={async () => {
                  if (confirm('Are you sure you want to delete all sales recorded for this day? This cannot be undone.')) {
                    setSaving(true);
                    try {
                      const allSales = await api.sales.list();
                      const existingSales = allSales.filter(s => s.date === date);
                      await Promise.all(existingSales.map(s => api.sales.delete(s.id)));
                      await fetchData(date);
                      alert('Sales records cleared.');
                    } catch (err) {
                      console.error("Error clearing sales:", err);
                    } finally {
                      setSaving(false);
                    }
                  }
                }}
                disabled={saving || loading}
                className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 transition-all hover:bg-red-100 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                Clear Day
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="flex items-center gap-2 rounded-lg bg-zinc-900 px-6 py-2 text-sm font-semibold text-white transition-all hover:bg-zinc-800 disabled:opacity-50"
            >
              {saving ? 'Recording...' : (
                <>
                  <PlusCircle className="h-4 w-4" />
                  Submit Sales
                </>
              )}
            </button>
          </div>
        </div>

        <div className="divide-y divide-zinc-100">
          {recipes.map(recipe => {
            const sale = sales.find(s => s.recipeId === recipe.id);
            return (
              <div key={recipe.id} className="grid grid-cols-1 md:grid-cols-2 p-4 items-center hover:bg-zinc-50 transition-colors">
                <div>
                  <h3 className="font-bold text-zinc-900">{recipe.name}</h3>
                  <p className="text-xs text-zinc-500">Standard portion size: {recipe.portionSize}</p>
                </div>
                <div className="flex items-center gap-4 mt-3 md:mt-0 justify-end">
                  {sale && (
                    <button 
                      onClick={() => handleIndividualDelete(sale.id)}
                      disabled={saving || loading}
                      className="p-2 text-zinc-400 hover:text-red-500 transition-colors disabled:opacity-50"
                      title="Delete this record"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <div className="flex items-center gap-3">
                      <label className="text-xs font-semibold text-zinc-400 uppercase">Quantity Sold</label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={soldAmounts[recipe.id] === 0 && !sale ? '' : (soldAmounts[recipe.id] || '')}
                        onChange={e => setSoldAmounts({ ...soldAmounts, [recipe.id]: parseFloat(e.target.value) || 0 })}
                        className="w-24 rounded-md border border-zinc-200 px-3 py-2 text-center font-mono text-sm focus:ring-2 focus:ring-zinc-900"
                        placeholder="0"
                      />
                  </div>
                </div>
              </div>
            );
          })}
          {recipes.length === 0 && !loading && (
            <div className="p-12 text-center text-zinc-500 italic">
              Create recipes in Recipe Module first.
            </div>
          )}
          {loading && (
             <div className="p-12 text-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-900 mx-auto" />
             </div>
          )}
        </div>
      </div>

      <div className="bg-zinc-900 text-white rounded-xl p-6 relative overflow-hidden shadow-xl">
        <BarChart3 className="absolute -bottom-6 -right-6 h-32 w-32 text-white/5 rotate-12" />
        <h4 className="text-sm font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
            <Search className="h-4 w-4" />
            Accuracy Tip
        </h4>
        <p className="text-sm text-zinc-400 max-w-xl leading-relaxed">
            Ensure sales data matches your POS reports exactly. Automated inventory deduction 
            is only as accurate as the sales numbers provided here.
        </p>
      </div>
    </div>
  );
}
