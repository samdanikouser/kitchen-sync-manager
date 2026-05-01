import { useState, useEffect, type FormEvent } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { api } from './lib/api';
import { useSettings } from './lib/SettingsContext';
import { 
  Package, 
  BookText, 
  FileInput, 
  BarChart3, 
  Menu, 
  X, 
  ChefHat,
  LogOut,
  User as UserIcon,
  Mail,
  Lock,
  ShoppingBag,
  LayoutDashboard,
  FileText,
  Settings as SettingsIcon,
  Loader2,
  Monitor,
  CreditCard
} from 'lucide-react';
import { cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';

// Pages
import Dashboard from './pages/Dashboard';
import Items from './pages/Items';
import Recipes from './pages/Recipes';
import StockEntry from './pages/StockEntry';
import SalesEntry from './pages/SalesEntry';
import Receive from './pages/Receive';
import MarketList from './pages/MarketList';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Subscription from './pages/Subscription';
import { SettingsProvider } from './lib/SettingsContext';

const SIDEBAR_ITEMS = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'Market List', path: '/market-list', icon: ShoppingBag },
  { name: 'Stock Entry', path: '/stock', icon: ShoppingBag },
  { name: 'Receive Stock', path: '/receive', icon: ShoppingBag },
  { name: 'Sales Entry', path: '/sales', icon: BarChart3 },
  { name: 'Recipe Master', path: '/recipes', icon: BookText },
  { name: 'Item Master', path: '/items', icon: Package },
  { name: 'Reports', path: '/reports', icon: FileText },
  { name: 'Subscription', path: '/subscription', icon: CreditCard },
  { name: 'Settings', path: '/settings', icon: SettingsIcon },
];

interface AppUser {
  id: string | number;
  username: string;
  displayName?: string;
}

function Navbar({ user, onLogout, onInstall }: { user: AppUser | null, onLogout: () => void, onInstall?: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();

  return (
    <nav className="sticky top-0 z-40 border-b border-zinc-200 bg-white/80 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 justify-between items-center">
          <div className="flex items-center gap-2">
            <ChefHat className="h-8 w-8 text-zinc-900" />
            <span className="text-xl font-bold tracking-tight text-zinc-900 font-[Verdana]">KitchenSync</span>
          </div>

          <div className="hidden md:flex items-center gap-6">
            {onInstall && (
              <button
                onClick={onInstall}
                className="flex items-center gap-2 rounded-full bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white transition-all hover:bg-blue-700 shadow-lg shadow-blue-100"
              >
                <Monitor className="h-3 w-3" />
                Install App
              </button>
            )}
            {user && SIDEBAR_ITEMS.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "text-sm font-medium transition-colors hover:text-zinc-900",
                  location.pathname === item.path ? "text-zinc-900 underline underline-offset-4" : "text-zinc-500"
                )}
              >
                {item.name}
              </Link>
            ))}
            {user && (
              <div className="flex items-center gap-3 pl-4 border-l border-zinc-200">
                <span className="text-sm font-medium text-zinc-600 truncate max-w-[120px]">
                  {user.displayName || user.username}
                </span>
                <button 
                  onClick={onLogout}
                  className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>

          <div className="flex md:hidden items-center gap-2">
             {user && (
                <button 
                  onClick={() => setIsOpen(!isOpen)}
                  className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 focus:outline-none"
                >
                  {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
                </button>
             )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden border-b border-zinc-100 bg-white"
          >
            <div className="space-y-1 px-4 py-3">
              {onInstall && (
                <button
                  onClick={() => {
                    onInstall();
                    setIsOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-base font-medium bg-blue-600 text-white mb-4"
                >
                  <Monitor className="h-5 w-5" />
                  Install Desktop App
                </button>
              )}
              {SIDEBAR_ITEMS.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-base font-medium",
                    location.pathname === item.path 
                      ? "bg-zinc-100 text-zinc-900" 
                      : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  {item.name}
                </Link>
              ))}
              {user && (
                <button
                  onClick={() => {
                    onLogout();
                    setIsOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-base font-medium text-red-600 hover:bg-red-50"
                >
                  <LogOut className="h-5 w-5" />
                  Sign Out
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

function Login({ onLogin }: { onLogin: (user: AppUser) => void }) {
  const { refreshSettings } = useSettings();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (tab === 'register') {
        if (!orgName || !username || !password || !name) { setError('Please fill in all fields.'); setLoading(false); return; }
        const user = await api.org.register({ orgName, username, password, displayName: name });
        onLogin(user);
        refreshSettings();
      } else {
        if (!username || !password) { setError('Please fill in all fields.'); setLoading(false); return; }
        const user = await api.auth.login({ username, password });
        onLogin(user);
        refreshSettings();
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred.');
    } finally { setLoading(false); }
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Pricing Banner */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-5 text-center shadow-sm"
        >
          <div className="mb-2 text-2xl">🎉</div>
          <p className="text-sm font-semibold text-emerald-800">Free for 7 days — no credit card required!</p>
          <p className="mt-1 text-xs text-emerald-600">Then just <span className="font-bold text-emerald-900">$99/month</span> for unlimited access.</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl shadow-zinc-100"
        >
          <div className="flex flex-col items-center text-center">
            <div className="mb-6 rounded-full bg-zinc-900 p-4 text-white">
              <ChefHat className="h-10 w-10" />
            </div>

            {/* Tabs */}
            <div className="mb-6 flex w-full rounded-lg bg-zinc-100 p-1">
              <button
                onClick={() => { setTab('login'); setError(null); }}
                className={cn("flex-1 rounded-md py-2 text-sm font-medium transition-all",
                  tab === 'login' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700")}
              >Sign In</button>
              <button
                onClick={() => { setTab('register'); setError(null); }}
                className={cn("flex-1 rounded-md py-2 text-sm font-medium transition-all",
                  tab === 'register' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700")}
              >Register Organization</button>
            </div>

            <h1 className="mb-2 text-2xl font-bold tracking-tight text-zinc-900">
              {tab === 'register' ? 'Create Your Organization' : 'Welcome Back'}
            </h1>
            <p className="mb-6 text-sm text-zinc-500">
              {tab === 'register'
                ? 'Start your 7-day free trial. Set up your kitchen in minutes.'
                : 'Sign in to manage your kitchen inventory.'}
            </p>

            <form onSubmit={handleSubmit} className="w-full space-y-4">
              {tab === 'register' && (
                <>
                  <div className="relative">
                    <ShoppingBag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <input type="text" placeholder="Organization Name" value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2.5 pl-10 pr-4 text-sm outline-none transition-all focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900" />
                  </div>
                  <div className="relative">
                    <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <input type="text" placeholder="Your Full Name" value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2.5 pl-10 pr-4 text-sm outline-none transition-all focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900" />
                  </div>
                </>
              )}
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                <input type="text" placeholder="Username" value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2.5 pl-10 pr-4 text-sm outline-none transition-all focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900" />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                <input type="password" placeholder="Password" value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2.5 pl-10 pr-4 text-sm outline-none transition-all focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900" />
              </div>

              {error && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                  className="text-xs text-red-500 text-left px-1">{error}</motion.div>
              )}

              <button type="submit" disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 py-3 text-sm font-semibold text-white transition-all hover:bg-zinc-800 disabled:opacity-70 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> :
                  tab === 'register' ? 'Start Free Trial' : 'Sign In'}
              </button>
            </form>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [installPrompt, setInstallPrompt] = useState<any>(null);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!installPrompt) return;
    
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    
    if (outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  useEffect(() => {
    const handleUnauthorized = (event: PromiseRejectionEvent) => {
      if (event.reason && event.reason.message === 'Unauthorized') {
        setUser(null);
      }
    };
    window.addEventListener('unhandledrejection', handleUnauthorized);
    return () => window.removeEventListener('unhandledrejection', handleUnauthorized);
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const u = await api.auth.me();
        setUser(u);
      } catch (err) {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, []);

  const handleLogout = async () => {
    try {
      await api.auth.logout();
      setUser(null);
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-900" />
      </div>
    );
  }

  return (
    <SettingsProvider>
      <Router>
        <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900 selection:bg-zinc-900 selection:text-white">
          <Navbar 
            user={user} 
            onLogout={handleLogout} 
            onInstall={installPrompt ? handleInstallClick : undefined} 
          />
          <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            {!user ? (
              <Login onLogin={(u) => setUser(u)} />
            ) : (
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/market-list" element={<MarketList />} />
                <Route path="/items" element={<Items />} />
                <Route path="/recipes" element={<Recipes />} />
                <Route path="/stock" element={<StockEntry />} />
                <Route path="/sales" element={<SalesEntry />} />
                <Route path="/receive" element={<Receive />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/subscription" element={<Subscription />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            )}
          </main>
        </div>
      </Router>
    </SettingsProvider>
  );
}

