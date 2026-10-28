// premiumProducts.js — Erkennung der Hitlines-Premium-Abo-Produkte (reine Funktionen, ohne Firebase/Express).
//
// Bei Google Play hängt RevenueCat an die Abo-ID den Basistarif an: "<abo-id>:<basistarif>", z. B.
// "hitlines_premium_monthly:monatlich". Bei Apple steht nur die Abo-ID ("hitlines_premium_monthly").
// Ein exakter Vergleich mit der Abo-ID erkannte deshalb Android-Abos nicht: der Webhook antwortete 200, schrieb aber
// weder premiumSubscription noch die Monatsnoten. Hier wird immer nur der Teil vor dem ":" verglichen.

// Muss 1:1 mit den productId-Werten in src/data/premiumSubscription.js (Frontend) und den Store-Produkten übereinstimmen.
export const PREMIUM_SUBSCRIPTION_PRODUCT_IDS = ['hitlines_premium_monthly', 'hitlines_premium_yearly'];

// "hitlines_premium_monthly:monatlich" → "hitlines_premium_monthly"
export const baseProductId = (productId) => String(productId ?? '').split(':')[0];

export const isPremiumSubscriptionProduct = (productId) => PREMIUM_SUBSCRIPTION_PRODUCT_IDS.includes(baseProductId(productId));

// Jahresabo erkennen (Abo-ID enthält "yearly"; der Basistarif-Name spielt keine Rolle)
export const isYearlyPremium = (productId) => baseProductId(productId) === 'hitlines_premium_yearly';

// Aus der RevenueCat-REST-Antwort (subscriber.subscriptions, Schlüssel = Produktkennung mit oder ohne Basistarif)
// das aktive Premium-Abo mit dem spätesten Ablauf wählen. Gibt { pid, sub, exp } oder null zurück.
export const findActivePremiumSubscription = (subs, now = Date.now()) => {
  let best = null;
  for (const [key, sub] of Object.entries(subs || {})) {
    if (!isPremiumSubscriptionProduct(key)) continue;
    const exp = sub ? Date.parse(sub.expires_date) : NaN;
    if (!Number.isNaN(exp) && exp > now && (!best || exp > best.exp)) best = { pid: baseProductId(key), sub, exp };
  }
  return best;
};
