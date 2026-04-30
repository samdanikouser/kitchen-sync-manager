import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Item, Recipe, StockEntry, SalesEntry, MarketListItem, Purchase } from '../types';
import { ShoppingBag, Package, AlertCircle, CheckCircle2, Info, Calendar } from 'lucide-react';
import { format, startOfWeek, startOfMonth } from 'date-fns';
import { cn, formatNumber } from '../lib/utils';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { FileText, Download } from 'lucide-react';

export default function MarketList() {
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [loading, setLoading] = useState(true);
  const [marketList, setMarketList] = useState<MarketListItem[]>([]);

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

  const calculateMetrics = async (selectedDate: string) => {
    setLoading(true);
    setMarketList([]); 
    try {
      const targetDataDate = format(new Date(new Date(selectedDate).setDate(new Date(selectedDate).getDate() - 1)), 'yyyy-MM-dd');
      
      const [items, recipes, allStock, allSales, allPurchases] = await Promise.all([
        api.items.list(),
        api.recipes.list(),
        api.stock.list(),
        api.sales.list(),
        api.purchases.list()
      ]);

      const stockEntries = allStock.filter(e => e.date === targetDataDate);
      const salesEntries = allSales.filter(e => e.date === targetDataDate);
      const purchaseEntries = allPurchases.filter(e => e.date === targetDataDate);

      const usageMap: Record<string, number> = {};
      salesEntries.forEach(sale => {
        const recipe = recipes.find(r => r.id === sale.recipeId);
        if (recipe) {
          calculateRecursiveUsage(recipe, sale.quantitySold, recipes, usageMap);
        }
      });

      const list: MarketListItem[] = items.map(item => {
        const stockRecord = stockEntries.find(e => e.itemId === item.id);
        const baseStock = stockRecord ? stockRecord.closingQuantity : 0;
        const received = purchaseEntries.filter(p => p.itemId === item.id).reduce((acc, c) => acc + c.quantity, 0);
        const consumed = usageMap[item.id] || 0;
        
        // Final stock at end of the previous day
        const closingSOH = Math.max(0, baseStock + received - consumed);
        const orderQty = Math.max(0, item.parLevel - closingSOH);

        return {
          itemId: item.id,
          itemName: item.name,
          unit: item.unit,
          openingStock: baseStock,
          received,
          consumption: consumed,
          closingStock: closingSOH,
          parLevel: item.parLevel,
          orderQty
        };
      });

      setMarketList(list);
    } catch (err) {
      console.error("Error calculating market list:", err);
    } finally {
      setLoading(false);
    }
  };

  const exportToExcel = () => {
    const workbook = XLSX.utils.book_new();
    const sheetData = marketList.map(item => ({
      'Ingredient': item.itemName,
      'Unit': item.unit,
      'Base Stock': item.openingStock,
      'Received': item.received,
      'Sales Usage': item.consumption,
      'Closing SOH': item.closingStock,
      'Par Level': item.parLevel,
      'Requirement': item.orderQty > 0 ? `BUY ${item.orderQty}` : 'Maintain'
    }));
    
    const worksheet = XLSX.utils.json_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Market List');
    XLSX.writeFile(workbook, `Market_List_${date}.xlsx`);
  };

  const exportToPDF = () => {
    const doc = new jsPDF();
    
    doc.setFontSize(20);
    doc.text('MARKET LIST / PURCHASE REQUIREMENTS', 14, 22);
    doc.setFontSize(10);
    doc.text(`Date: ${date}`, 14, 30);
    doc.text(`Requirements calculated based on performance of: ${format(new Date(new Date(date).setDate(new Date(date).getDate() - 1)), 'yyyy-MM-dd')}`, 14, 35);

    const tableBody = marketList.map(item => [
      item.itemName,
      item.unit,
      formatNumber(item.openingStock),
      formatNumber(item.received),
      formatNumber(item.consumption),
      formatNumber(item.closingStock),
      item.orderQty > 0 ? `BUY ${formatNumber(item.orderQty)}` : 'Maintain'
    ]);

    autoTable(doc, {
      startY: 45,
      head: [['Ingredient', 'Unit', 'Base', 'Rx', 'Usage', 'SOH', 'Action']],
      body: tableBody,
    });

    doc.save(`Market_List_${date}.pdf`);
  };

  useEffect(() => {
    calculateMetrics(date);
  }, [date]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h1 className="text-3xl font-black tracking-tighter text-zinc-900 uppercase">Market List</h1>
          <p className="text-zinc-500 font-medium">Daily purchase suggestions based on Stock on Hand and Sales.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-white p-2 rounded-lg border border-zinc-200 shadow-sm">
              <Calendar className="h-4 w-4 text-zinc-400" />
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="border-none bg-transparent focus:ring-0 text-xs font-bold uppercase tracking-widest outline-none"
              />
          </div>
          
          <button
            onClick={exportToExcel}
            disabled={marketList.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-zinc-200 rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-zinc-50 transition-colors disabled:opacity-50"
          >
            <Download className="h-3 w-3" />
            Excel
          </button>
          
          <button
            onClick={exportToPDF}
            disabled={marketList.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-zinc-800 transition-colors shadow-lg shadow-zinc-200 disabled:opacity-50"
          >
            <FileText className="h-3 w-3" />
            PDF
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
        <div className="bg-zinc-50 px-6 py-4 border-b border-zinc-200">
            <h2 className="text-sm font-black uppercase tracking-widest text-zinc-900 flex items-center gap-2">
                <ShoppingBag className="h-4 w-4" />
                Purchasing Requirements
            </h2>
        </div>
        <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="bg-zinc-50/50">
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-400">Ingredient</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-400">Base Stock</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-400 text-center">Received</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-400 text-center">Sales Usage</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-400">Closing SOH</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-400">Order Suggestion</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                    {marketList.map(item => (
                        <tr key={item.itemId} className={cn("hover:bg-zinc-50 transition-colors", item.orderQty > 0 ? "bg-red-50/10" : "")}>
                            <td className="px-6 py-4">
                                <span className="font-bold text-zinc-900">{item.itemName}</span>
                                <span className="ml-2 text-[10px] font-mono text-zinc-400 uppercase">{item.unit}</span>
                            </td>
                            <td className="px-6 py-4 font-mono text-sm text-zinc-600">{formatNumber(item.openingStock)}</td>
                            <td className="px-6 py-4 text-center font-mono text-sm text-green-600 font-bold">
                                {item.received > 0 ? `+${formatNumber(item.received)}` : '-'}
                            </td>
                            <td className="px-6 py-4 text-center">
                                <span className={cn(
                                    "px-2 py-0.5 rounded-full text-[10px] font-bold font-mono",
                                    item.consumption > 0 ? "bg-orange-50 text-orange-700" : "bg-zinc-50 text-zinc-400"
                                )}>
                                    {formatNumber(item.consumption)}
                                </span>
                            </td>
                            <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                    <span className="font-mono text-sm font-black">{formatNumber(item.closingStock)}</span>
                                    {item.closingStock < item.parLevel ? (
                                        <AlertCircle className="h-4 w-4 text-red-500" />
                                    ) : (
                                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                                    )}
                                </div>
                            </td>
                            <td className="px-6 py-4">
                                {item.orderQty > 0 ? (
                                    <span className="inline-flex items-center rounded-md bg-zinc-900 px-3 py-1 text-xs font-black text-white shadow-lg shadow-zinc-200">
                                       BUY {formatNumber(item.orderQty)} {item.unit}
                                    </span>
                                ) : (
                                    <span className="text-xs font-bold text-zinc-300 uppercase tracking-widest italic">Maintain</span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
        {loading && <div className="p-20 text-center">Loading Market List...</div>}
        {!loading && marketList.length === 0 && (
            <div className="p-20 text-center text-zinc-500">
                <Info className="h-12 w-12 mx-auto text-zinc-200 mb-4" />
                <p className="font-bold uppercase tracking-widest text-xs">No active cycle data</p>
            </div>
        )}
      </div>
    </div>
  );
}
