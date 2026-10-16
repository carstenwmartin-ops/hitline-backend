// testAccountCleanup.js — Auswahl von Testkonten zum Aufräumen mit Stichtag (Admin, zweistufig: Vorschau → bestätigen).
//
// Warum nicht über die Tester-Markierung (testChannel): Sie wird über die E-Mail gesetzt und erreicht anonyme Gast-Konten
// nicht; die Sammel-Löschung "alle Markierten" würde außerdem spätere echte Nutzer erfassen. Hier gilt stattdessen:
// Ein Konto ist nur dann Kandidat, wenn es VOR dem Stichtag (Release-Tag) angelegt wurde, es nicht der Admin ist, es KEINEN
// echten Kauf hat (RevenueCat PRODUCTION, Stripe-Zahlung ab Stichtag, Abo mit environment PRODUCTION) und es eine Gast-,
// Tester- (oder auf Wunsch Apple-Prüfer-)Kennung trägt. Gewöhnliche Konten mit E-Mail/Anmeldung bleiben immer unberührt.
// Wer nach dem Stichtag noch aktiv war, wird nur auf ausdrücklichen Wunsch (includeActive) einbezogen.

// 15.10.2026, 00:00 Uhr deutscher Zeit (Release der iOS-App)
export const DEFAULT_CUTOFF_MS = Date.parse('2026-10-15T00:00:00+02:00');

export const summarizePurchases = (purchases, cutoffMs) => {
  const s = { sandbox: 0, production: 0, stripeTest: 0, stripeLive: 0, other: 0 };
  for (const p of Object.values(purchases || {})) {
    if (!p) continue;
    if (p.provider === 'revenuecat') { if (p.environment === 'PRODUCTION') s.production += 1; else s.sandbox += 1; }
    else if (p.provider === 'stripe') { if ((p.createdAt || 0) >= cutoffMs) s.stripeLive += 1; else s.stripeTest += 1; }
    else s.other += 1;
  }
  return s;
};

const ms = (v) => { const n = Date.parse(v || ''); return Number.isFinite(n) ? n : 0; };

/**
 * @param {object} i { authUser:{uid,email,providerData,metadata}, userData: users/{uid}|null, cutoffMs, adminEmail, adminUid,
 *                     includeActive?, includeAppleRelay? }
 * @returns {object} Zeile für die Vorschau inkl. candidate (bool) und protectedReasons
 */
export const classifyAccount = ({ authUser, userData, cutoffMs, adminEmail, adminUid, includeActive = false, includeAppleRelay = false }) => {
  const profile = userData?.profile || {};
  const providers = (authUser.providerData || []).map((p) => p.providerId);
  const email = authUser.email || null;
  let category = 'regular';
  if (profile.testChannel) category = 'tester';
  else if (providers.length === 0) category = 'anonymous';
  else if (providers.includes('apple.com') && /@privaterelay\.appleid\.com$/i.test(email || '')) category = 'apple-relay';

  const createdAt = ms(authUser.metadata?.creationTime);
  const lastActiveAt = Math.max(ms(authUser.metadata?.lastSignInTime), ms(authUser.metadata?.lastRefreshTime));
  const purchases = summarizePurchases(userData?.purchases, cutoffMs);

  const protectedReasons = [];
  if ((adminEmail && email === adminEmail) || (adminUid && authUser.uid === adminUid)) protectedReasons.push('admin');
  if (createdAt >= cutoffMs) protectedReasons.push('created_after_cutoff');
  if (purchases.production > 0) protectedReasons.push('production_purchase');
  if (purchases.stripeLive > 0) protectedReasons.push('live_stripe_purchase');
  if (profile.premiumSubscription?.environment === 'PRODUCTION') protectedReasons.push('production_subscription');
  if (category === 'regular') protectedReasons.push('regular_account');
  if (category === 'apple-relay' && !includeAppleRelay) protectedReasons.push('apple_reviewer_kept');

  const activeAfterCutoff = lastActiveAt >= cutoffMs;
  const candidate = protectedReasons.length === 0 && (includeActive || !activeAfterCutoff);
  return {
    uid: authUser.uid, category, email, createdAt, lastActiveAt,
    coins: profile.coins ?? null, purchases,
    protectedReasons, activeAfterCutoff, candidate,
  };
};
