// storeRefund.js — Erstattung eines Noten-Kaufs über App Store/Google Play (RevenueCat-Ereignis CANCELLATION).
//
// Ziel: Erstattet Apple/Google einen Noten-Kauf, werden dieselben Noten wieder abgezogen (nicht unter 0), im
// Noten-Verlauf vermerkt und der Kaufeintrag als erstattet markiert. Bewusst vorsichtig:
// - nur für Noten-Produkte und nur bei cancel_reason === 'CUSTOMER_SUPPORT' (so meldet RevenueCat eine
//   Store-Erstattung; andere Gründe berühren Einmalkäufe nicht),
// - nur wenn wir diese Transaktion zuvor selbst gutgeschrieben haben (processedRevenueCatTransactions),
// - idempotent über processedRevenueCatRefunds (RevenueCat stellt mindestens einmal zu).
// RevenueCat dokumentiert CANCELLATION für "erstattete Einmalkäufe", den cancel_reason für Einmalkäufe nennt die Doku nicht
// ausdrücklich (CUSTOMER_SUPPORT ist die wahrscheinliche Annahme). Der Webhook loggt jedes Ereignis, damit der erste echte
// Fall die Annahme bestätigt oder korrigiert. REFUND_REVERSED (nur App Store) wird bewusst noch nicht behandelt.

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

// Mögliche Konto-IDs, unter denen RevenueCat den Kauf führt: zuletzt gesehene, ursprüngliche und alle früheren IDs.
// (Bei Gast-Käufen, die später in ein Konto übernommen wurden, steht der Kauf unter der Gast-ID.)
export const refundCandidateUids = (event) => {
  const list = [event?.app_user_id, event?.original_app_user_id, ...(Array.isArray(event?.aliases) ? event.aliases : [])];
  return [...new Set(list.filter((u) => typeof u === 'string' && u && !u.startsWith('$RCAnonymousID')))];
};

/**
 * @param {object} deps  { adminDb, packages, logHistory(uid, amount, reason, balanceAfter) }
 * @param {object} event RevenueCat-Ereignis
 * @returns {Promise<{handled: boolean, status?: string, deducted?: number, targetDeducted?: number}>}
 */
export const handleCoinRefund = async ({ adminDb, packages, logHistory }, event) => {
  const ids = (packages || []).map((p) => p.id);
  if (!isCoinRefundEvent(event, ids)) return { handled: false };
  const transactionId = String(event.transaction_id || event.original_transaction_id || event.id || '');
  const pkg = packages.find((p) => p.id === event.product_id);
  const candidates = refundCandidateUids(event);
  if (!candidates.length || !transactionId || !pkg) return { handled: true, status: 'unknown_transaction', deducted: 0 };

  // Das Konto suchen, dem wir diese Transaktion gutgeschrieben haben (meist app_user_id, bei Gast-Käufen die Gast-ID)
  let result = { status: 'unknown_transaction', deducted: 0 };
  let balanceAfter = null;
  let uid = null;
  for (const cand of candidates) {
    let r2 = { status: 'unknown_transaction', deducted: 0 };
    let bal = null;
    await adminDb.ref(`users/${cand}/profile`).transaction((profile) => {
      const r = applyRefundToProfile(profile, { transactionId, coins: pkg.coins });
      r2 = { status: r.status, deducted: r.deducted };
      if (r.status === 'refunded') bal = r.profile.coins;
      return r.profile;
    });
    if (r2.status !== 'unknown_transaction') { result = r2; balanceAfter = bal; uid = cand; break; }
  }
  if (result.status !== 'refunded') return { handled: true, ...result };

  const now = Date.now();
  let targetDeducted = 0;
  try {
    await logHistory(uid, -result.deducted, `Erstattet: ${pkg.coins} 🎵`, balanceAfter);
    const purchaseRef = adminDb.ref(`users/${uid}/purchases/${transactionId}`);
    const purchase = (await purchaseRef.once('value')).val();
    await purchaseRef.update({ refundedAt: now });

    // Gast-Kauf, der in ein Konto übernommen wurde: die Noten liegen jetzt dort — den Rest dort abziehen (nie unter 0)
    const target = purchase && purchase.transferredTo;
    const remainder = pkg.coins - result.deducted;
    if (target && remainder > 0) {
      let targetBalance = null;
      await adminDb.ref(`users/${target}/profile`).transaction((profile) => {
        if (!profile) return profile;
        const before = profile.coins || 0;
        const after = Math.max(0, before - remainder);
        targetDeducted = before - after;
        targetBalance = after;
        return { ...profile, coins: after };
      });
      if (targetDeducted > 0) await logHistory(target, -targetDeducted, `Erstattet: ${pkg.coins} 🎵`, targetBalance);
    }
    // Kopie des Kaufs im Zielkonto (Kaufverlauf) ebenfalls als erstattet markieren, nur wenn sie existiert
    if (target) {
      const copyRef = adminDb.ref(`users/${target}/purchases/${transactionId}`);
      if ((await copyRef.once('value')).val()) await copyRef.update({ refundedAt: now });
    }
  } catch (e) {
    console.warn('⚠️ Erstattung: Verlauf/Kaufeintrag konnte nicht aktualisiert werden:', e.message);
  }
  return { handled: true, ...result, targetDeducted };
};
