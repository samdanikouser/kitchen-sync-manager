import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Item, Purchase } from '../types';
import { Calendar, PackagePlus, Save, Trash2, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency, formatNumber } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useSettings } from '../lib/SettingsContext';

export default function Receive() {
  const { settings } = useSettings();
  const [items, setItems] = useState<Item[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    itemId: '',
    quantity: 0,
    unitPrice: 0,
    vendor: ''
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [allInventory, allPurchases] = await Promise.all([
        api.items.list(),
        api.purchases.list()
      ]);
      
      setItems(allInventory);
      const filteredPurchases = allPurchases.filter(p => p.date === date);
      setPurchases(filteredPurchases);
      
      if (allInventory.length > 0 && !formData.itemId) {
        setFormData(prev => ({ ...prev, itemId: allInventory[0].id, unitPrice: allInventory[0].purchasePrice }));
      }
    } catch (err) {
      console.error("Error fetching receive data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [date]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.itemId) return;
    try {
      await api.purchases.create({
        ...formData,
        id: crypto.randomUUID(),
        date,
      });
      setIsAdding(false);
      setFormData({ 
        itemId: items[0]?.id || '', 
        quantity: 0, 
        unitPrice: items[0]?.purchasePrice || 0, 
        vendor: '' 
      });
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
      fetchData();
    } catch (err) {
      console.error("Error creating purchase:", err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this purchase record?')) return;
    try {
      setLoading(true);
      await api.purchases.delete(id);
      await fetchData();
    } catch (err) {
      console.error("Error deleting purchase:", err);
    } finally {
      setLoading(false);
    }
  };

  const clearDay = async () => {
    if (confirm('Are you sure you want to delete all purchases for this day?')) {
      setLoading(true);
      try {
        const toDelete = purchases.filter(p => p.date === date);
        await Promise.all(toDelete.map(p => api.purchases.delete(p.id)));
        await fetchData();
        alert('Day records cleared.');
      } catch (err) {
        console.error("Error clearing day:", err);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Receive Stock</h1>
          <p className="text-zinc-500 font-medium">Log your purchases and inventory arrivals.</p>
        </div>
        <div className="flex items-center gap-4">
          <AnimatePresence>
            {showSuccess && (
              <motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="flex items-center gap-2 bg-green-50 text-green-700 px-3 py-1.5 rounded-full border border-green-200 text-xs font-bold"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Purchase recorded successfully
              </motion.div>
            )}
          </AnimatePresence>
              <button
                onClick={clearDay}
                disabled={loading}
                className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 transition-all hover:bg-red-100 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                Clear Day
              </button>
          <div className="flex items-center gap-4 bg-white p-2 rounded-lg border border-zinc-200 shadow-sm">
            <Calendar className="h-5 w-5 text-zinc-400 ml-2" />
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="border-none bg-transparent focus:ring-0 text-sm font-semibold"
            />
          </div>
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
          >
            <PackagePlus className="h-4 w-4" />
            Receive Items
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <form onSubmit={handleCreate} className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Item</label>
                  <select
                    value={formData.itemId}
                    onChange={e => {
                        const item = items.find(i => i.id === e.target.value);
                        setFormData({ ...formData, itemId: e.target.value, unitPrice: item?.purchasePrice || 0 });
                    }}
                    className="rounded-md border border-zinc-200 px-3 py-2 text-sm"
                  >
                    {items.map(item => (
                      <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Quantity</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    value={isNaN(formData.quantity) ? '' : (formData.quantity || '')}
                    onChange={e => setFormData({ ...formData, quantity: parseFloat(e.target.value) })}
                    className="rounded-md border border-zinc-200 px-3 py-2 text-sm"
                    placeholder="0.00"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Unit Price ({settings.currency.symbol})</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    value={isNaN(formData.unitPrice) ? '' : (formData.unitPrice || '')}
                    onChange={e => setFormData({ ...formData, unitPrice: parseFloat(e.target.value) })}
                    className="rounded-md border border-zinc-200 px-3 py-2 text-sm"
                    placeholder="0.00"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Vendor (Optional)</label>
                  <input
                    type="text"
                    value={formData.vendor}
                    onChange={e => setFormData({ ...formData, vendor: e.target.value })}
                    className="rounded-md border border-zinc-200 px-3 py-2 text-sm"
                    placeholder="Supplier Name"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsAdding(false)} className="text-sm font-medium text-zinc-500 px-4 py-2 hover:bg-zinc-50 rounded-md">Cancel</button>
                <button type="submit" className="flex items-center gap-2 rounded-md bg-zinc-900 px-6 py-2 text-sm font-semibold text-white hover:bg-zinc-800">
                  <Save className="h-4 w-4" />
                  Record Purchase
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-sm">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-100">
              <th className="p-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Item</th>
              <th className="p-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Quantity</th>
              <th className="p-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Unit Price</th>
              <th className="p-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Total</th>
              <th className="p-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Vendor</th>
              <th className="p-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {purchases.map(p => {
              const item = items.find(i => i.id === p.itemId);
              return (
                <tr key={p.id} className="hover:bg-zinc-50 group">
                  <td className="p-4">
                    <span className="font-semibold">{item?.name || 'Deleted Item'}</span>
                    <span className="ml-2 text-[10px] font-mono text-zinc-400">{item?.unit}</span>
                  </td>
                  <td className="p-4 font-mono text-sm">{formatNumber(p.quantity)}</td>
                  <td className="p-4 font-mono text-sm">{formatCurrency(p.unitPrice, settings.currency.code)}</td>
                  <td className="p-4 font-mono text-sm font-bold">{formatCurrency(p.quantity * p.unitPrice, settings.currency.code)}</td>
                  <td className="p-4 text-sm text-zinc-500">{p.vendor || '-'}</td>
          <td className="p-4">
            <button 
              onClick={() => handleDelete(p.id)} 
              disabled={loading}
              className="p-2 text-zinc-400 hover:text-red-500 transition-all hover:bg-red-50 rounded-lg disabled:opacity-50"
              title="Delete purchase"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </td>
                </tr>
              );
            })}
            {purchases.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="p-12 text-center text-zinc-400 italic">No items received on this date.</td>
              </tr>
            )}
            {loading && (
               <tr><td colSpan={6} className="p-8"><div className="h-6 w-6 animate-spin rounded-full border-2 border-t-zinc-900 border-zinc-200 mx-auto" /></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
