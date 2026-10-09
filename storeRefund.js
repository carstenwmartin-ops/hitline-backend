// storeRefund.js — Erstattung eines Noten-Kaufs über App Store/Google Play (RevenueCat-Ereignis CANCELLATION).
//
// Ziel: Erstattet Apple/Google einen Noten-Kauf, werden dieselben Noten wieder abgezogen (nicht unter 0), im
// Noten-Verlauf vermerkt und der Kaufeintrag als erstattet markiert. Bewusst vorsichtig:
// - nur für Noten-Produkte und nur bei cancel_reason === 'CUSTOMER_SUPPORT' (so meldet RevenueCat eine
//   Store-Erstattung; andere Gründe berühren Einmalkäufe nicht),
// - nur wenn wir diese Transaktion zuvor selbst gutgeschrieben haben (processedRevenueCatTransactions),
// - idempotent über processedRevenueCatRefunds (RevenueCat stellt mindestens einmal zu).
// Das reale Ereignisformat bei Einmalkäufen ist noch nicht an einem echten Fall gesehen — der Webhook loggt
// jedes Ereignis, damit der erste echte Fall die Annahme bestätigt oder korrigiert.

export const isCoinRefundEvent = (event, coinPackageIds) =>
  !!event
  && event.type === 'CANCELLATION'
  && event.cancel_reason === 'CUSTOMER_SUPPORT'
  && Array.isArray(coinPackageIds)
  && coinPackageIds.includes(event.product_id);

// Reine Funktion (läuft in der Firebase-Transaktion): berechnet das neue Profil.
// Rückgabe: { profile, status: 'refunded' | 'already_refunded' | 'unknown_transaction', deducted }
export const applyRefundToProfile = (profile, { transactionId, coins }) => {
  if (!profile || !transactionId) return { profile, status: 'unknown_transaction', deducted: 0 };
  const credited = profile.processedRevenueCatTransactions || {};
  const refunded = profile.processedRevenueCatRefunds || {};
  if (refunded[transactionId]) return { profile, status: 'already_refunded', deducted: 0 };
  if (!credited[transactionId]) return { profile, status: 'unknown_transaction', deducted: 0 };
  const before = profile.coins || 0;
  const after = Math.max(0, before - coins);
  return {
    profile: { ...profile, coins: after, processedRevenueCatRefunds: { ...refunded, [transactionId]: true } },
    status: 'refunded',
    deducted: before - after,
  };
};

/**
 * @param {object} deps  { adminDb, packages, logHistory(uid, amount, reason, balanceAfter) }
 * @param {object} event RevenueCat-Ereignis
 * @returns {Promise<{handled: boolean, status?: string, deducted?: number}>}
 */
export const handleCoinRefund = async ({ adminDb, packages, logHistory }, event) => {
  const ids = (packages || []).map((p) => p.id);
  if (!isCoinRefundEvent(event, ids)) return { handled: false };
  const uid = event.app_user_id;
  const transactionId = String(event.transaction_id || event.original_transaction_id || event.id || '');
  const pkg = packages.find((p) => p.id === event.product_id);
  if (!uid || !transactionId || !pkg) return { handled: true, status: 'unknown_transaction', deducted: 0 };

  let result = { status: 'unknown_transaction', deducted: 0 };
  let balanceAfter = null;
  await adminDb.ref(`users/${uid}/profile`).transaction((profile) => {
    const r = applyRefundToProfile(profile, { transactionId, coins: pkg.coins });
    result = { status: r.status, deducted: r.deducted };
    if (r.status === 'refunded') balanceAfter = r.profile.coins;
    return r.profile;
  });

  if (result.status === 'refunded') {
    try {
      await logHistory(uid, -result.deducted, `Erstattet: ${pkg.coins} 🎵`, balanceAfter);
      await adminDb.ref(`users/${uid}/purchases/${transactionId}`).update({ refundedAt: Date.now() });
    } catch (e) {
      console.warn('⚠️ Erstattung: Verlauf/Kaufeintrag konnte nicht aktualisiert werden:', e.message);
    }
  }
  return { handled: true, ...result };
};
