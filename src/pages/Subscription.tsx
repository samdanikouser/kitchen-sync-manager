import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { motion } from 'framer-motion';
import { CreditCard, CheckCircle, AlertTriangle, Clock, Shield, Zap, Users, Loader2 } from 'lucide-react';

interface LicenseInfo {
  active: boolean;
  plan: string | null;
  status: string;
  daysLeft: number;
  trialEnd?: string;
  subscriptionEnd?: string;
  amount?: number;
  currency?: string;
}

export default function Subscription() {
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchLicense();
  }, []);

  const fetchLicense = async () => {
    try {
      const data = await api.license.get();
      setLicense(data);
    } catch (err) {
      console.error('Failed to fetch license:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async () => {
    setSubscribing(true);
    setMessage(null);
    try {
      const result = await api.license.subscribe();
      setMessage(result.message);
      await fetchLicense();
    } catch (err: any) {
      setMessage(err.message || 'Subscription failed');
    } finally {
      setSubscribing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-900" />
      </div>
    );
  }

  const isTrialExpired = license?.plan === 'trial' && !license?.active;
  const isSubExpired = license?.plan === 'subscription' && !license?.active;
  const isActive = license?.active;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Subscription</h1>
        <p className="mt-1 text-sm text-zinc-500">Manage your plan and billing</p>
      </div>

      {/* Current Plan Status */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`rounded-2xl border p-6 shadow-sm ${
          isActive
            ? 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50'
            : 'border-red-200 bg-gradient-to-br from-red-50 to-orange-50'
        }`}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              {isActive ? (
                <CheckCircle className="h-5 w-5 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-red-600" />
              )}
              <h2 className="text-lg font-semibold text-zinc-900">
                {license?.plan === 'trial' ? 'Free Trial' : 'Monthly Subscription'}
              </h2>
            </div>
            <p className={`mt-1 text-sm ${isActive ? 'text-emerald-700' : 'text-red-700'}`}>
              {isActive
                ? `Active — ${license?.daysLeft} day${license?.daysLeft !== 1 ? 's' : ''} remaining`
                : isTrialExpired
                  ? 'Your free trial has expired'
                  : 'Your subscription has expired'}
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-white/60 px-3 py-1 text-xs font-medium">
            <Clock className="h-3 w-3" />
            {license?.plan === 'trial'
              ? `Ends ${license?.trialEnd ? new Date(license.trialEnd).toLocaleDateString() : 'N/A'}`
              : `Renews ${license?.subscriptionEnd ? new Date(license.subscriptionEnd).toLocaleDateString() : 'N/A'}`}
          </div>
        </div>
      </motion.div>

      {/* Pricing Card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm"
      >
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 rounded-full bg-zinc-900 p-3">
            <CreditCard className="h-6 w-6 text-white" />
          </div>
          <h3 className="text-xl font-bold text-zinc-900">KitchenSync Pro</h3>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-4xl font-bold text-zinc-900">$99</span>
            <span className="text-sm text-zinc-500">/month</span>
          </div>
          <p className="mt-2 text-sm text-zinc-500">Everything you need to run your kitchen</p>

          <div className="my-6 w-full border-t border-zinc-100" />

          <ul className="w-full space-y-3 text-left text-sm">
            {[
              { icon: Zap, text: 'Unlimited items, recipes, and transactions' },
              { icon: Users, text: 'Multi-user access with role-based permissions' },
              { icon: Shield, text: 'Complete data isolation per organization' },
              { icon: CreditCard, text: 'Full reporting and analytics dashboard' },
            ].map((feature, i) => (
              <li key={i} className="flex items-center gap-3">
                <feature.icon className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                <span className="text-zinc-700">{feature.text}</span>
              </li>
            ))}
          </ul>

          <div className="mt-6 w-full">
            {message && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={`mb-4 rounded-lg px-4 py-2 text-sm ${
                  message.includes('fail') || message.includes('error')
                    ? 'bg-red-50 text-red-700'
                    : 'bg-emerald-50 text-emerald-700'
                }`}
              >
                {message}
              </motion.p>
            )}

            <button
              onClick={handleSubscribe}
              disabled={subscribing}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 py-3 text-sm font-semibold text-white transition-all hover:bg-zinc-800 disabled:opacity-70"
            >
              {subscribing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isActive && license?.plan === 'subscription' ? (
                'Extend Subscription (+30 days)'
              ) : (
                'Subscribe Now — $99/month'
              )}
            </button>

            <p className="mt-3 text-xs text-zinc-400 text-center">
              Subscription activates immediately for 30 days.
              {license?.plan === 'subscription' && isActive && ' Additional time is added to your current plan.'}
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
