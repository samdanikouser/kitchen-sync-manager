import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from './api';
import { AppSettings } from '../types';

interface SettingsContextType {
  settings: AppSettings;
  loading: boolean;
  refreshSettings: () => Promise<void>;
}

const DEFAULT_SETTINGS: AppSettings = {
  id: 'config',
  categories: ['Vegetables', 'Dairy', 'Dry Goods', 'Meat', 'Seafood', 'Poultry'],
  currency: {
    symbol: 'R',
    code: 'ZAR'
  }
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  const fetchSettings = async () => {
    try {
      const data = await api.settings.get();
      if (data) setSettings(data);
    } catch (err) {
      // Silently fail if unauthorized (expected on initial load)
      if (!(err instanceof Error && err.message === 'Unauthorized')) {
        console.error('Failed to fetch settings:', err);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, loading, refreshSettings: fetchSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
