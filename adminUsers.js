// Auswertung der Konten (Firebase Auth) für das Admin-Dashboard (reine Funktionen, ohne Firebase-Zugriff).
// Eingabe: Liste { createdAt, lastSignInAt, providers } je Konto (Millisekunden). Die Ausgabe enthält nur Zähler.
//
// Abgrenzung Test/Echtbetrieb: Konten, die vor dem frühesten Plattformstart angelegt wurden, waren Testkonten und zählen
// nicht in "Konten seit Start". Gäste (ohne Konto) kommen hier nicht vor.
import { LAUNCH_DATES, lastDays, earliestLaunch, pct } from './adminStats.js';

const DAY_MS = 86400000;
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export const PROVIDER_LABELS = { 'google.com': 'google', 'apple.com': 'apple', password: 'email' };

// "Anmeldeweg" eines Kontos: erster bekannter Anbieter, sonst "other"
export const providerOf = (providers) => {
  for (const id of providers || []) if (PROVIDER_LABELS[id]) return PROVIDER_LABELS[id];
  return 'other';
};

export const buildUserStats = (users, { days = 'start', now = new Date(), launch = LAUNCH_DATES } = {}) => {
  const list = (users || []).filter((u) => u && num(u.createdAt) > 0);
  const nowMs = now.getTime();
  const firstDay = earliestLaunch(launch);
  const firstMs = Date.parse(`${firstDay}T00:00:00Z`);
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sinceStart = days === 'start';
  const n = sinceStart ? Math.max(1, Math.min(366, Math.floor((todayMs - firstMs) / DAY_MS) + 1)) : days;
  const keys = lastDays(n, now);
  const perDay = Object.fromEntries(keys.map((k) => [k, 0]));

  const real = list.filter((u) => u.createdAt >= firstMs);
  const providers = { google: 0, apple: 0, email: 0, other: 0 };
  let newInRange = 0;
  for (const u of real) {
    providers[providerOf(u.providers)] += 1;
    const k = dayKey(u.createdAt);
    if (k in perDay) { perDay[k] += 1; newInRange += 1; }
  }
  const activeWithin = (d) => real.filter((u) => num(u.lastSignInAt) >= nowMs - d * DAY_MS).length;

  return {
    range: { days: n, mode: sinceStart ? 'start' : 'days', from: keys[0], to: keys[keys.length - 1], timezone: 'UTC' },
    launchFrom: firstDay,
    totals: {
      accountsAll: list.length,
      accountsSinceStart: real.length,
      testAccountsBefore: list.length - real.length,
      newInRange,
      active1d: activeWithin(1), active7d: activeWithin(7), active30d: activeWithin(30),
      active7dPct: pct(activeWithin(7), real.length), active30dPct: pct(activeWithin(30), real.length),
    },
    series: keys.map((k) => ({ date: k, newAccounts: perDay[k] })),
    providers,
  };
};
