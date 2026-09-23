// premiumNotes.js — reine Hilfsfunktionen für die monatliche Notengutschrift für Hitlines-Premium-Abos
// (siehe PREMIUM-ERWEITERUNG.md im Web-App-Repo). Bewusst ohne Firebase/Express, damit testbar.

export const PREMIUM_MONTHLY_NOTES = 10;

// Monatsschlüssel "YYYY-MM" in der Zeitzone Europe/Berlin — Grundlage der Idempotenz: je Monat höchstens
// eine Gutschrift, egal wie oft oder von welchem Gerät der Abruf kommt.
export const berlinMonthKey = (ms = Date.now()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date(ms));
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  return `${year}-${month}`;
};

// Berechtigt sind nur zahlende Abos (Stripe im Web, RevenueCat in den Apps) mit Status "active".
// Nicht berechtigt: Familien-Befreiung (kein Abo-Objekt, eigenes Flag), gekündigte/abgelaufene Abos.
// currentPeriodEnd (ms) muss, falls vorhanden, in der Zukunft liegen; fehlt es, gilt "active" allein.
export const isEligibleForMonthlyNotes = (subscription, now = Date.now()) => {
  if (!subscription || typeof subscription !== 'object') return false;
  if (subscription.status !== 'active') return false;
  if (subscription.provider !== 'stripe' && subscription.provider !== 'revenuecat') return false;
  const end = subscription.currentPeriodEnd;
  if (typeof end === 'number' && Number.isFinite(end) && end <= now) return false;
  return true;
};
