import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { AppSettings } from '../types';
import { useSettings } from '../lib/SettingsContext';
import { Settings as SettingsIcon, Save, Plus, Trash2, Globe, List, Edit2, X } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

export default function Settings() {
  const { settings: globalSettings, refreshSettings, loading } = useSettings();
  const [settings, setSettings] = useState<AppSettings>(globalSettings);
  const [newCategory, setNewCategory] = useState('');
  const [editingCategory, setEditingCategory] = useState<{ original: string; current: string } | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    setSettings(globalSettings);
  }, [globalSettings]);

  const handleSave = async () => {
    setSaving(true);
    setSaveSuccess(false);
    try {
      await api.settings.update(settings);
      await refreshSettings();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Error saving settings:", err);
    } finally {
      setSaving(false);
    }
  };

  const addCategory = async () => {
    if (!newCategory.trim()) return;
    if (settings.categories.includes(newCategory.trim())) {
      return;
    }
    const nextSettings = {
      ...settings,
      categories: [...settings.categories, newCategory.trim()]
    };
    setSettings(nextSettings);
    setNewCategory('');
    try {
      await api.settings.update(nextSettings);
      await refreshSettings();
    } catch (err) {
      console.error("Error auto-saving category:", err);
    }
  };

  const saveEditedCategory = async () => {
    if (!editingCategory) return;
    if (!editingCategory.current.trim()) return;
    
    const nextCategories = settings.categories.map(c => 
      c === editingCategory.original ? editingCategory.current.trim() : c
    );

    const nextSettings = {
      ...settings,
      categories: nextCategories
    };

    setSettings(nextSettings);
    setEditingCategory(null);
    try {
      await api.settings.update(nextSettings);
      await refreshSettings();
    } catch (err) {
      console.error("Error auto-saving category edit:", err);
    }
  };

  const removeCategory = async (cat: string) => {
    const nextSettings = {
      ...settings,
      categories: settings.categories.filter(c => c !== cat)
    };
    setSettings(nextSettings);
    setDeletingCategory(null);
    try {
      await api.settings.update(nextSettings);
      await refreshSettings();
    } catch (err) {
      console.error("Error auto-saving category deletion:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-900" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">System Settings</h1>
          <p className="text-zinc-500 font-medium">Configure item categories, users, and localization.</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={cn(
            "flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-bold text-white transition-all shadow-lg shadow-zinc-200 disabled:opacity-50",
            saveSuccess ? "bg-green-600 shadow-green-100 scale-[1.02]" : "bg-zinc-900 hover:bg-zinc-800"
          )}
        >
          {saveSuccess ? <Plus className="h-4 w-4 rotate-45" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save Settings'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Localization Settings */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Globe className="h-5 w-5 text-zinc-400" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-500">Localization</h2>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm space-y-6">
            <div className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Currency Symbol</label>
                <input 
                  type="text" 
                  value={settings.currency.symbol}
                  onChange={e => setSettings({
                    ...settings,
                    currency: { ...settings.currency, symbol: e.target.value }
                  })}
                  className="rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:ring-2 focus:ring-zinc-900 outline-none"
                  placeholder="e.g. $, R, €"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Currency Code</label>
                <input 
                  type="text" 
                  value={settings.currency.code}
                  onChange={e => setSettings({
                    ...settings,
                    currency: { ...settings.currency, code: e.target.value }
                  })}
                  className="rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:ring-2 focus:ring-zinc-900 outline-none"
                  placeholder="e.g. USD, ZAR, EUR"
                />
              </div>
              <p className="text-[10px] text-zinc-400 font-medium">
                Note: Currency symbols are used in UI display. Code is used for international formatting standards.
              </p>
            </div>
          </div>
        </section>

        {/* Categories Settings */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <List className="h-5 w-5 text-zinc-400" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-500">Item Categories</h2>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm space-y-4">
            <div className="flex gap-2">
              <input 
                type="text" 
                value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCategory()}
                placeholder="New Category..."
                className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:ring-2 focus:ring-zinc-900 outline-none"
              />
              <button 
                onClick={addCategory}
                className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white transition-colors"
                title="Add Category"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
              {settings.categories.map(cat => (
                <div key={cat} className="flex items-center justify-between p-3 rounded-lg bg-zinc-50 border border-zinc-100 group">
                  {editingCategory?.original === cat ? (
                    <div className="flex flex-1 gap-2">
                      <input 
                        autoFocus
                        type="text"
                        value={editingCategory.current}
                        onChange={e => setEditingCategory({ ...editingCategory, current: e.target.value })}
                        onKeyDown={e => e.key === 'Enter' && saveEditedCategory()}
                        onBlur={saveEditedCategory}
                        className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-zinc-900"
                      />
                    </div>
                  ) : (
                    <span className="text-sm font-medium text-zinc-700">{cat}</span>
                  )}
                  
                  <div className="flex gap-1">
                    {editingCategory?.original === cat ? (
                      <div className="flex gap-1">
                        <button 
                          onClick={saveEditedCategory}
                          className="p-1 text-green-600 hover:text-green-700"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => setEditingCategory(null)}
                          className="p-1 text-zinc-400 hover:text-zinc-600"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : deletingCategory === cat ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest animate-pulse">Confirm?</span>
                        <button 
                          onClick={() => removeCategory(cat)}
                          className="px-2 py-1 rounded bg-red-500 text-white text-[10px] font-bold"
                        >
                          Delete
                        </button>
                        <button 
                          onClick={() => setDeletingCategory(null)}
                          className="p-1 text-zinc-400 hover:text-zinc-600"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <button 
                          onClick={() => setEditingCategory({ original: cat, current: cat })}
                          className="p-1 text-zinc-400 hover:text-zinc-600 transition-colors"
                          title="Edit Category"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => setDeletingCategory(cat)}
                          className="p-1 text-zinc-400 hover:text-red-500 transition-colors"
                          title="Delete Category"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {settings.categories.length === 0 && (
                <p className="text-xs text-center text-zinc-400 py-4 italic">No categories defined.</p>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* User Management Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <SettingsIcon className="h-5 w-5 text-zinc-400" />
          <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-500">System Users</h2>
        </div>
        <UserManagement />
      </section>
    </div>
  );
}

function UserManagement() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    displayName: ''
  });

  const fetchUsers = async () => {
    try {
      const data = await api.users.list();
      setUsers(data);
    } catch (err) {
      console.error("Error fetching users:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingUser) {
        await api.users.update(editingUser.id, formData);
      } else {
        if (!formData.password) return;
        await api.users.create(formData);
      }
      setIsAdding(false);
      setEditingUser(null);
      setFormData({ username: '', password: '', displayName: '' });
      fetchUsers();
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleEdit = (user: any) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      password: '', // Don't show old password
      displayName: user.displayName || ''
    });
    setIsAdding(true);
    setDeletingUser(null);
  };

  const handleDelete = async (id: string) => {
    try {
      await api.users.delete(id);
      setDeletingUser(null);
      fetchUsers();
    } catch (err: any) {
      console.error(err);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden text-sm">
      <div className="p-4 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/50">
        <span className="font-bold text-zinc-600">Access Management</span>
        <button 
          onClick={() => {
            setIsAdding(!isAdding);
            setEditingUser(null);
            setDeletingUser(null);
            setFormData({ username: '', password: '', displayName: '' });
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 text-white font-bold text-xs"
        >
          {isAdding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {isAdding ? 'Cancel' : 'Add User'}
        </button>
      </div>

      {isAdding && (
        <form onSubmit={handleSubmit} className="p-4 border-b border-zinc-100 bg-zinc-50/30 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Username</label>
              <input 
                required
                type="text"
                value={formData.username}
                onChange={e => setFormData({ ...formData, username: e.target.value })}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none focus:ring-2 focus:ring-zinc-900"
                placeholder="johndoe"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                {editingUser ? 'New Password (Optional)' : 'Password'}
              </label>
              <input 
                required={!editingUser}
                type="password"
                value={formData.password}
                onChange={e => setFormData({ ...formData, password: e.target.value })}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none focus:ring-2 focus:ring-zinc-900"
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Display Name</label>
              <input 
                required
                type="text"
                value={formData.displayName}
                onChange={e => setFormData({ ...formData, displayName: e.target.value })}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none focus:ring-2 focus:ring-zinc-900"
                placeholder="John Doe"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button 
              type="submit"
              className="bg-zinc-900 text-white px-4 py-2 rounded-lg font-bold"
            >
              {editingUser ? 'Update User' : 'Create User'}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left bg-zinc-50 text-[10px] uppercase font-bold text-zinc-500 tracking-widest">
              <th className="px-6 py-3">Display Name</th>
              <th className="px-6 py-3">Username</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {users.map(user => (
              <tr key={user.id} className="hover:bg-zinc-50/50">
                <td className="px-6 py-4 font-bold text-zinc-700">{user.displayName}</td>
                <td className="px-6 py-4 text-zinc-500 font-mono text-[10px]">{user.username}</td>
                <td className="px-6 py-4 text-right">
                  {deletingUser === user.id ? (
                    <div className="flex items-center justify-end gap-2">
                       <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest animate-pulse">Delete?</span>
                       <button 
                        onClick={() => handleDelete(user.id)}
                        className="px-2 py-1 rounded bg-red-600 text-white text-[10px] font-bold"
                      >
                        Yes, Delete
                      </button>
                      <button 
                        onClick={() => setDeletingUser(null)}
                        className="p-1 text-zinc-400 hover:text-zinc-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="space-x-2">
                      <button 
                        onClick={() => handleEdit(user)}
                        className="p-1.5 text-zinc-400 hover:text-zinc-600 transition-colors"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button 
                        onClick={() => setDeletingUser(user.id)}
                        className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
