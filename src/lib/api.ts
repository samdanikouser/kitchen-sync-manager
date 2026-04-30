import { Item, Recipe, StockEntry, SalesEntry, Purchase, AppSettings } from '../types';

async function request(url: string, options: RequestInit = {}) {
  const res = await fetch(url, {
    ...options,
    credentials: 'include', // Ensure cookies are sent
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (res.status === 401) {
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || 'Request failed');
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  auth: {
    me: () => request('/api/auth/me'),
    login: (credentials: any) => request('/api/auth/login', { method: 'POST', body: JSON.stringify(credentials) }),
    register: (userData: any) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(userData) }),
    logout: () => request('/api/auth/logout', { method: 'POST' }),
  },
  items: {
    list: (): Promise<Item[]> => request('/api/items'),
    create: (item: Item) => request('/api/items', { method: 'POST', body: JSON.stringify(item) }),
    update: (id: string, item: Partial<Item>) => request(`/api/items/${id}`, { method: 'PUT', body: JSON.stringify(item) }),
    delete: (id: string) => request(`/api/items/${id}`, { method: 'DELETE' }),
  },
  recipes: {
    list: (): Promise<Recipe[]> => request('/api/recipes'),
    create: (recipe: Recipe) => request('/api/recipes', { method: 'POST', body: JSON.stringify(recipe) }),
    update: (id: string, recipe: Partial<Recipe>) => request(`/api/recipes/${id}`, { method: 'PUT', body: JSON.stringify(recipe) }),
    delete: (id: string) => request(`/api/recipes/${id}`, { method: 'DELETE' }),
  },
  stock: {
    list: (): Promise<StockEntry[]> => request('/api/stock-entries'),
    create: (entry: Omit<StockEntry, 'recordedAt'>) => request('/api/stock-entries', { method: 'POST', body: JSON.stringify(entry) }),
    delete: (id: string) => request(`/api/stock-entries/${id}`, { method: 'DELETE' }),
  },
  sales: {
    list: (): Promise<SalesEntry[]> => request('/api/sales-entries'),
    create: (entry: Omit<SalesEntry, 'recordedAt'>) => request('/api/sales-entries', { method: 'POST', body: JSON.stringify(entry) }),
    delete: (id: string) => request(`/api/sales-entries/${id}`, { method: 'DELETE' }),
  },
  purchases: {
    list: (): Promise<Purchase[]> => request('/api/purchases'),
    create: (purchase: Omit<Purchase, 'recordedAt'>) => request('/api/purchases', { method: 'POST', body: JSON.stringify(purchase) }),
    delete: (id: string) => request(`/api/purchases/${id}`, { method: 'DELETE' }),
  },
  settings: {
    get: (): Promise<AppSettings> => request('/api/settings'),
    update: (settings: AppSettings) => request('/api/settings', { method: 'POST', body: JSON.stringify(settings) }),
  },
  users: {
    list: (): Promise<any[]> => request('/api/users'),
    create: (user: any) => request('/api/users', { method: 'POST', body: JSON.stringify(user) }),
    update: (id: string, user: any) => request(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(user) }),
    delete: (id: string) => request(`/api/users/${id}`, { method: 'DELETE' }),
  },
};
