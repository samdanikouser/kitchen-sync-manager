import { useState, useEffect, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Item, Unit, Purchase } from '../types';
import { Plus, Trash2, Package, Search, CheckSquare, Square, AlertTriangle, Edit2, TrendingUp, Tags } from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useSettings } from '../lib/SettingsContext';

export default function Items() {
  const { settings } = useSettings();
  const [items, setItems] = useState<Item[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [showBulkParModal, setShowBulkParModal] = useState(false);
  const [bulkParValue, setBulkParValue] = useState('');
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    unit: 'kg' as Unit,
    purchasePrice: 0,
    yieldPercentage: 100,
    parLevel: 0,
  });

  const fetchItems = async () => {
    setLoading(true);
    try {
      const [fetchedItems, fetchedPurchases] = await Promise.all([
        api.items.list(),
        api.purchases.list()
      ]);

      setItems(fetchedItems);
      setPurchases(fetchedPurchases);
    } catch (err) {
      console.error("Error fetching items:", err);
    } finally {
      setLoading(false);
    }
  };

  const getAverageCost = (itemId: string) => {
    const itemPurchases = purchases.filter(p => p.itemId === itemId);
    if (itemPurchases.length === 0) return null;

    const totalQty = itemPurchases.reduce((sum, p) => sum + p.quantity, 0);
    const totalCost = itemPurchases.reduce((sum, p) => sum + (p.quantity * p.unitPrice), 0);
    
    return totalQty > 0 ? totalCost / totalQty : null;
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const filteredItems = items.filter(item => 
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (item.category && item.category.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleToggleSelectAll = () => {
    if (selectedIds.size === filteredItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map(i => i.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.size) return;
    setLoading(true);
    try {
      await Promise.all(Array.from(selectedIds).map((id: string) => api.items.delete(id)));
      setSelectedIds(new Set());
      setShowBulkDeleteConfirm(false);
      await fetchItems();
      alert('Selected items deleted successfully.');
    } catch (err) {
      console.error("Error deleting items:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkParUpdate = async () => {
    const par = parseFloat(bulkParValue);
    if (isNaN(par)) return alert('Please enter a valid number.');

    setBulkUpdating(true);
    try {
      await Promise.all(Array.from(selectedIds).map((id: string) => 
        api.items.update(id, { parLevel: par })
      ));
      setSelectedIds(new Set());
      setShowBulkParModal(false);
      setBulkParValue('');
      await fetchItems();
      alert(`Par levels updated for ${selectedIds.size} items.`);
    } catch (err) {
      console.error("Error updating par levels:", err);
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    
    // Duplicate check
    const isDuplicate = items.some(item => 
      item.name.toLowerCase() === formData.name.toLowerCase() && 
      item.id !== editingId
    );

    if (isDuplicate) {
      alert('An item with this name already exists. Please use a unique name.');
      return;
    }

    if (formData.yieldPercentage < 0 || formData.yieldPercentage > 100) {
      alert('Yield percentage must be between 0 and 100.');
      return;
    }

    try {
      if (editingId) {
        setLoading(true);
        await api.items.update(editingId, { ...formData });
        setEditingId(null);
      } else {
        setLoading(true);
        const newItem: Item = {
          ...formData,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await api.items.create(newItem);
      }

      setIsAdding(false);
      setFormData({ name: '', category: '', unit: 'kg', purchasePrice: 0, yieldPercentage: 100, parLevel: 0 });
      await fetchItems();
      alert(editingId ? 'Item updated successfully.' : 'Item created successfully.');
    } catch (err) {
      console.error("Error saving item:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (item: Item) => {
    setFormData({
      name: item.name,
      category: item.category || '',
      unit: item.unit,
      purchasePrice: item.purchasePrice,
      yieldPercentage: item.yieldPercentage,
      parLevel: item.parLevel
    });
    setEditingId(item.id);
    setIsAdding(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string) => {
    setLoading(true);
    try {
      await api.items.delete(id);
      setItemToDelete(null);
      await fetchItems();
    } catch (err) {
      console.error("Error deleting item:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Item Master</h1>
          <p className="text-zinc-500 font-medium tracking-tight">Manage your raw materials and ingredients.</p>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Search items..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-900 bg-white"
            />
          </div>
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-zinc-800 shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Add Item
          </button>
        </div>
      </div>

      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-900 bg-zinc-900 p-4 text-white shadow-lg"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-xs font-bold font-mono">
                {selectedIds.size}
              </div>
              <span className="text-sm font-semibold">Items selected</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowBulkParModal(true)}
                disabled={bulkUpdating}
                className="flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-wider hover:bg-white/20 transition-colors"
              >
                Update Par Level
              </button>
              <button
                onClick={() => setShowBulkDeleteConfirm(true)}
                className="flex items-center gap-2 rounded-lg bg-red-500/20 px-4 py-2 text-xs font-bold uppercase tracking-wider text-red-100 hover:bg-red-500/40 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Selected
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="flex items-center gap-2 rounded-lg bg-white/5 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white/60 hover:bg-white/10 hover:text-white"
              >
                Clear
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <form onSubmit={handleCreate} className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm space-y-4">
              <h2 className="text-lg font-semibold">{editingId ? 'Edit Raw Material' : 'New Raw Material'}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Item Name</label>
                  <input
                    required
                    type="text"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className="rounded-md border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                    placeholder="e.g. Flour"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Category</label>
                    <Link to="/settings" className="text-[10px] font-bold text-zinc-900 opacity-50 hover:opacity-100 hover:underline">Manage</Link>
                  </div>
                  <select
                    value={formData.category}
                    onChange={e => setFormData({ ...formData, category: e.target.value })}
                    className="rounded-md border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  >
                    <option value="">Uncategorized</option>
                    {settings.categories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Unit</label>
                  <select
                    value={formData.unit}
                    onChange={e => setFormData({ ...formData, unit: e.target.value as Unit })}
                    className="rounded-md border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  >
                    <option value="kg">kg (Weight)</option>
                    <option value="L">L (Liquid)</option>
                    <option value="pcs">pcs (Count)</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Purchase Price ({settings.currency.symbol})</label>
                  <div className="relative">
                    <input
                      required
                      type="number"
                      step="0.01"
                      min="0"
                      value={isNaN(formData.purchasePrice) ? '' : (formData.purchasePrice || '')}
                      onChange={e => setFormData({ ...formData, purchasePrice: parseFloat(e.target.value) })}
                      className={cn(
                        "w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2",
                        formData.purchasePrice > 10000 
                          ? "border-orange-300 ring-orange-100 focus:ring-orange-500" 
                          : "border-zinc-200 focus:ring-zinc-900"
                      )}
                      placeholder="0.00"
                    />
                    {formData.purchasePrice > 10000 && (
                      <div className="absolute top-full left-0 mt-1 flex items-center gap-1 text-[10px] text-orange-600 font-bold">
                        <AlertTriangle className="h-3 w-3" /> High Price Alert
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Yield (%)</label>
                  <div className="relative">
                    <input
                      required
                      type="number"
                      min="1"
                      max="100"
                      value={isNaN(formData.yieldPercentage) ? '' : formData.yieldPercentage}
                      onChange={e => setFormData({ ...formData, yieldPercentage: parseFloat(e.target.value) })}
                      className={cn(
                        "w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2",
                        formData.yieldPercentage < 1 || formData.yieldPercentage > 100 
                          ? "border-red-300 ring-red-100 text-red-600 focus:ring-red-500" 
                          : "border-zinc-200 focus:ring-zinc-900"
                      )}
                    />
                    {(formData.yieldPercentage < 50 && formData.yieldPercentage > 0) && (
                      <div className="absolute top-full left-0 mt-1 flex items-center gap-1 text-[10px] text-orange-600 font-bold">
                        <AlertTriangle className="h-3 w-3" /> Low Yield Warning
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Par Level</label>
                  <input
                    required
                    type="number"
                    min="0"
                    value={isNaN(formData.parLevel) ? '' : formData.parLevel}
                    onChange={e => setFormData({ ...formData, parLevel: parseFloat(e.target.value) })}
                    className="rounded-md border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  />
                </div>
                <div className="flex flex-col gap-1.5 justify-end pb-1">
                  <div className="rounded-md bg-zinc-50 p-2 border border-zinc-100">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase leading-none mb-1">Cost After Yield</p>
                    <p className="text-sm font-black font-mono text-zinc-900">
                      {formatCurrency(formData.purchasePrice / (Math.max(1, formData.yieldPercentage) / 100), settings.currency.code)}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsAdding(false);
                    setEditingId(null);
                    setFormData({ name: '', unit: 'kg', purchasePrice: 0, yieldPercentage: 100, parLevel: 0 });
                  }}
                  className="rounded-md px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  {editingId ? 'Update Item' : 'Save Item'}
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-bottom border-zinc-200 bg-zinc-50">
              <th className="p-4 w-12">
                <button 
                  onClick={handleToggleSelectAll}
                  className="rounded hover:bg-zinc-200 p-1 transition-colors"
                >
                  {selectedIds.size === filteredItems.length && filteredItems.length > 0 ? (
                    <CheckSquare className="h-4 w-4 text-zinc-900" />
                  ) : (
                    <Square className="h-4 w-4 text-zinc-400" />
                  )}
                </button>
              </th>
              <th className="p-4 text-xs font-bold uppercase tracking-wider text-zinc-500">Item</th>
              <th className="p-4 text-xs font-bold uppercase tracking-wider text-zinc-500">Category</th>
              <th className="p-4 text-xs font-bold uppercase tracking-wider text-zinc-500">Unit</th>
              <th className="p-4 text-xs font-bold uppercase tracking-wider text-zinc-500">Latest List Price</th>
              <th className="p-4 text-xs font-bold uppercase tracking-wider text-zinc-500">Weighted Avg Cost</th>
              <th className="p-4 text-xs font-bold uppercase tracking-wider text-zinc-500">Yield</th>
              <th className="p-4 text-xs font-bold uppercase tracking-wider text-zinc-500">Actual Cost (Avg)</th>
              <th className="p-4 text-xs font-bold uppercase tracking-wider text-zinc-500 text-right">Par Level</th>
              <th className="p-4 text-xs font-bold uppercase tracking-wider text-zinc-500"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {filteredItems.length === 0 && !loading ? (
              <tr>
                <td colSpan={8} className="p-12 text-center text-zinc-500">
                  <div className="flex flex-col items-center gap-3">
                    <Package className="h-10 w-10 opacity-10" />
                    <span className="text-sm font-medium">
                      {searchQuery ? `No results for "${searchQuery}"` : "No items recorded yet."}
                    </span>
                    {searchQuery && (
                        <button onClick={() => setSearchQuery('')} className="text-xs font-bold text-zinc-900 underline">Clear search</button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              filteredItems.map(item => (
                <tr key={item.id} className={cn(
                    "hover:bg-zinc-50 transition-colors group",
                    selectedIds.has(item.id) ? "bg-zinc-50" : ""
                )}>
                  <td className="p-4">
                    <button 
                      onClick={() => handleToggleSelect(item.id)}
                      className="rounded hover:bg-zinc-200 p-1 transition-colors"
                    >
                      {selectedIds.has(item.id) ? (
                        <CheckSquare className="h-4 w-4 text-zinc-900" />
                      ) : (
                        <Square className="h-4 w-4 text-zinc-300" />
                      )}
                    </button>
                  </td>
                  <td className="p-4">
                    <span className="font-bold text-zinc-900">{item.name}</span>
                  </td>
                  <td className="p-4">
                    {item.category ? (
                      <span className="px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 text-[10px] font-bold uppercase tracking-tighter">
                        {item.category}
                      </span>
                    ) : (
                      <span className="text-zinc-300 text-[10px] italic">None</span>
                    )}
                  </td>
                  <td className="p-4 text-zinc-400 font-mono text-[10px] uppercase">{item.unit}</td>
                  <td className="p-4 font-mono text-sm">{formatCurrency(item.purchasePrice, settings.currency.code)}</td>
                  <td className="p-4 font-mono text-sm font-semibold text-blue-600">
                    {getAverageCost(item.id) !== null ? formatCurrency(getAverageCost(item.id)!, settings.currency.code) : '-'}
                  </td>
                  <td className="p-4 font-mono text-sm">
                    {item.yieldPercentage}%
                  </td>
                  <td className="p-4 font-mono text-sm font-black">
                    {formatCurrency((getAverageCost(item.id) || item.purchasePrice) / (item.yieldPercentage / 100), settings.currency.code)}
                  </td>
                  <td className="p-4 font-mono text-sm text-right font-bold">{item.parLevel}</td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                          onClick={() => handleEdit(item)}
                          className="rounded-md p-1.5 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
                      >
                          <Edit2 className="h-4 w-4" />
                      </button>
                      <button 
                          onClick={() => setItemToDelete(item.id)}
                          className="rounded-md p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                          <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
            {loading && (
               <tr>
                <td colSpan={8} className="p-12 text-center text-zinc-500">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-900 mx-auto" />
                  <p className="mt-2 text-xs font-bold uppercase tracking-widest">Loading Catalog</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* Custom Confirmation Modals */}
      <AnimatePresence>
        {(itemToDelete || showBulkDeleteConfirm || showBulkParModal) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setItemToDelete(null);
                setShowBulkDeleteConfirm(false);
                setShowBulkParModal(false);
              }}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-2xl"
            >
              {itemToDelete && (
                <div className="space-y-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
                    <Trash2 className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-zinc-900">Delete Item</h3>
                    <p className="text-sm text-zinc-500">Are you sure you want to delete this item? This action cannot be undone.</p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setItemToDelete(null)}
                      className="flex-1 rounded-md bg-zinc-100 px-4 py-2 text-sm font-bold text-zinc-600 hover:bg-zinc-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleDelete(itemToDelete)}
                      className="flex-1 rounded-md bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}

              {showBulkDeleteConfirm && (
                <div className="space-y-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
                    <Trash2 className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-zinc-900">Bulk Delete</h3>
                    <p className="text-sm text-zinc-500">Are you sure you want to delete {selectedIds.size} items? This action cannot be undone.</p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowBulkDeleteConfirm(false)}
                      className="flex-1 rounded-md bg-zinc-100 px-4 py-2 text-sm font-bold text-zinc-600 hover:bg-zinc-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleBulkDelete}
                      className="flex-1 rounded-md bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 transition-colors"
                    >
                      Delete {selectedIds.size}
                    </button>
                  </div>
                </div>
              )}

              {showBulkParModal && (
                <div className="space-y-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-900">
                    <TrendingUp className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-zinc-900">Bulk Par Update</h3>
                    <p className="text-sm text-zinc-500">Enter new Par Level for {selectedIds.size} selected items.</p>
                  </div>
                  <input
                    type="number"
                    value={bulkParValue}
                    onChange={e => setBulkParValue(e.target.value)}
                    placeholder="Enter par level..."
                    className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                    autoFocus
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowBulkParModal(false)}
                      className="flex-1 rounded-md bg-zinc-100 px-4 py-2 text-sm font-bold text-zinc-600 hover:bg-zinc-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleBulkParUpdate}
                      disabled={!bulkParValue}
                      className="flex-1 rounded-md bg-zinc-900 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
                    >
                      Update
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
