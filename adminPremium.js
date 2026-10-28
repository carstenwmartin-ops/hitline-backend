// Auswertung von Premium-Abos und Käufen für das Admin-Dashboard (reine Funktionen, ohne Firebase-Zugriff).
// Quellen je Konto: users/{uid}/profile/premiumSubscription und users/{uid}/purchases/{id}.
// Die Ausgabe enthält nur Zähler und Summen, keine Konto-IDs, Namen oder E-Mail-Adressen.
//
// Abgrenzung Test/Echtbetrieb: Sandbox-Käufe (environment SANDBOX), Käufe vor dem Start der jeweiligen Plattform sowie widerrufene
// und erstattete Käufe zählen nicht in Umsatz und Käufen. Stripe-Testzahlungen sind im Kaufeintrag nicht erkennbar (kein Live-Kennzeichen).
import { LAUNCH_DATES, PLATFORMS, lastDays, earliestLaunch, pct } from './adminStats.js';

const DAY_MS = 86400000;
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

// Verkaufskanal eines Kaufs bzw. Abos: web (Stripe), ios (App Store), android (Play Store)
export const channelOf = (provider, store) => {
  if (provider === 'stripe') return 'web';
  if (store === 'APP_STORE') return 'ios';
  if (store === 'PLAY_STORE') return 'android';
  return null;
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// Zählt ein Kauf als echter Umsatz? Gemeinsame Regel für die Premium-Seite und die Sicht "Heute".
// Rückgabe: { channel } oder { excluded: 'sandbox' | 'unknownChannel' | 'beforeLaunch' | 'withdrawn' | 'refunded' }
export const classifyPurchase = (p, launch = LAUNCH_DATES) => {
  if (p.environment === 'SANDBOX') return { excluded: 'sandbox' };
  const channel = channelOf(p.provider, p.store);
  if (!channel) return { excluded: 'unknownChannel' };
  if (num(p.createdAt) < Date.parse(`${launch[channel]}T00:00:00Z`)) return { excluded: 'beforeLaunch' };
  if (p.withdrawnAt) return { excluded: 'withdrawn' };
  if (p.refundedAt) return { excluded: 'refunded' };
  return { channel };
};

const emptyByChannel = () => Object.fromEntries(PLATFORMS.map((p) => [p, 0]));

// Tarif eines Abos: 'yearly' | 'monthly' | 'unknown'
export const planOfSubscription = (sub, { isYearlyProduct, stripeYearlyPriceId } = {}) => {
  if (sub.plan === 'yearly' || sub.plan === 'monthly') return sub.plan;
  if (sub.provider === 'stripe') {
    if (!stripeYearlyPriceId || !sub.priceId) return 'unknown';
    return sub.priceId === stripeYearlyPriceId ? 'yearly' : 'monthly';
  }
  if (sub.priceId && isYearlyProduct) return isYearlyProduct(sub.priceId) ? 'yearly' : 'monthly';
  return 'unknown';
};

// users: { uid: { profile: { premiumSubscription, appleMusicComplimentary }, purchases: { id: record } } }
export const buildPremiumStats = (users, {
  days = 'start', now = new Date(), launch = LAUNCH_DATES, isYearlyProduct, stripeYearlyPriceId,
} = {}) => {
  const nowMs = now.getTime();
  const sinceStart = days === 'start';
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const first = earliestLaunch(launch);
  const n = sinceStart ? Math.max(1, Math.min(366, Math.floor((todayMs - Date.parse(`${first}T00:00:00Z`)) / DAY_MS) + 1)) : days;
  const keys = lastDays(n, now);
  const keySet = new Set(keys);

  const accounts = Object.values(users || {}).filter((u) => u && typeof u === 'object');
  const subs = { active: 0, expiring: 0, billingIssue: 0, canceled: 0, complimentary: 0, byChannel: emptyByChannel(), byPlan: { monthly: 0, yearly: 0, unknown: 0 }, sandboxIgnored: 0 };
  const excluded = { sandbox: 0, beforeLaunch: 0, withdrawn: 0, refunded: 0, unknownChannel: 0 };
  const purchases = {
    count: 0, buyers: new Set(),
    byKind: { coins: 0, premium: 0 },
    byChannel: emptyByChannel(),
    revenue: {}, // Währung → Cent (brutto)
    revenueByChannel: {}, // Kanal → { Währung → Cent }
    coinsSold: 0,
    packages: {},
  };
  const seriesMap = Object.fromEntries(keys.map((k) => [k, { date: k, purchases: 0, revenue: {} }]));
  const addRevenue = (obj, cur, cents) => { obj[cur] = (obj[cur] || 0) + cents; };

  accounts.forEach((acc, idx) => {
    const profile = acc.profile || {};
    const sub = profile.premiumSubscription;
    if (profile.appleMusicComplimentary) subs.complimentary += 1;
    if (sub && typeof sub === 'object') {
      if (sub.environment === 'SANDBOX') subs.sandboxIgnored += 1;
      else {
        const channel = channelOf(sub.provider, sub.store);
        const live = sub.status === 'active' && (!sub.currentPeriodEnd || sub.currentPeriodEnd > nowMs);
        if (live) {
          subs.active += 1;
          if (sub.willRenew === false) subs.expiring += 1;
          if (sub.billingIssue) subs.billingIssue += 1;
          if (channel) subs.byChannel[channel] += 1;
          subs.byPlan[planOfSubscription(sub, { isYearlyProduct, stripeYearlyPriceId })] += 1;
        } else if (sub.status === 'canceled') subs.canceled += 1;
      }
    }

    for (const p of Object.values(acc.purchases || {})) {
      if (!p || typeof p !== 'object') continue;
      const verdict = classifyPurchase(p, launch);
      if (verdict.excluded) { excluded[verdict.excluded] += 1; continue; }
      const channel = verdict.channel;
      const day = dayKey(num(p.createdAt));
      if (!keySet.has(day)) continue;
      const cents = p.amount === null || p.amount === undefined ? 0 : num(p.amount);
      const cur = String(p.currency || 'eur').toLowerCase();
      purchases.count += 1;
      purchases.buyers.add(idx);
      purchases.byKind[p.kind === 'premium' ? 'premium' : 'coins'] += 1;
      purchases.byChannel[channel] += 1;
      addRevenue(purchases.revenue, cur, cents);
      purchases.revenueByChannel[channel] = purchases.revenueByChannel[channel] || {};
      addRevenue(purchases.revenueByChannel[channel], cur, cents);
      seriesMap[day].purchases += 1;
      addRevenue(seriesMap[day].revenue, cur, cents);
      if (p.kind !== 'premium') {
        purchases.coinsSold += num(p.coins);
        const label = p.packageId || (p.coins ? `${p.coins} Noten` : 'unbekannt');
        purchases.packages[label] = (purchases.packages[label] || 0) + 1;
      }
    }
  });

  const buyers = purchases.buyers.size;
  return {
    range: { days: n, mode: sinceStart ? 'start' : 'days', from: keys[0], to: keys[keys.length - 1], timezone: 'UTC' },
    launch: { ...launch },
    accounts: { total: accounts.length, premiumActive: subs.active, premiumPct: pct(subs.active, accounts.length), buyersInRange: buyers, buyersPct: pct(buyers, accounts.length) },
    subscriptions: subs,
    purchases: {
      count: purchases.count, buyers, byKind: purchases.byKind, byChannel: purchases.byChannel,
      revenue: purchases.revenue, revenueByChannel: purchases.revenueByChannel, coinsSold: purchases.coinsSold, packages: purchases.packages,
    },
    series: keys.map((k) => seriesMap[k]),
    excluded,
  };
};
