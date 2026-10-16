// stripeRefund.js — Erstattung eines Web-Kaufs von Noten (Stripe-Ereignis charge.refunded).
//
// Ziel: Wird eine Zahlung im Stripe-Dashboard (ganz oder teilweise) erstattet, ziehen wir die entsprechenden Noten wieder ab
// (nie unter 0), vermerken es im Noten-Verlauf und markieren den Kaufeintrag als erstattet.
// - Der Kauf wird über die payment_intent der Zahlung gefunden (Checkout-Session mit unseren Metadaten uid/coins).
// - Nur Noten-Käufe (Session-Modus "payment"). Abo-Zahlungen werden ignoriert: Der Wertersatz beim Widerruf läuft von Hand
//   (siehe withdrawal.js), das Abo selbst endet über die Abo-Ereignisse.
// - Idempotent und für Teilerstattungen geeignet: Am Kaufeintrag steht `refundedCoins` (schon abgezogene Noten); ein
//   erneut zugestelltes oder weiteres Ereignis zieht nur die Differenz ab.

// Reine Funktion: wie viele Noten sind nach der (Teil-)Erstattung insgesamt abzuziehen, und wie viele davon noch neu?
export const planStripeRefund = ({ coins, amount, amountRefunded, alreadyRefundedCoins = 0 }) => {
  if (!(coins > 0) || !(amount > 0) || !(amountRefunded > 0)) return { targetTotal: alreadyRefundedCoins, delta: 0, full: false };
  const full = amountRefunded >= amount;
  const targetTotal = full ? coins : Math.min(coins, Math.floor((coins * amountRefunded) / amount));
  return { targetTotal, delta: Math.max(0, targetTotal - alreadyRefundedCoins), full };
};

/**
 * @param {object} deps  { adminDb, findSessionByPaymentIntent(paymentIntentId) → Checkout-Session|null, logHistory(uid, amount, reason, balanceAfter), now? }
 * @param {object} event Stripe-Ereignis
 * @returns {Promise<{handled: boolean, status?: string, deducted?: number}>}
 */
export const handleStripeRefund = async ({ adminDb, findSessionByPaymentIntent, logHistory, now = Date.now }, event) => {
  if (!event || event.type !== 'charge.refunded') return { handled: false };
  const charge = event.data && event.data.object;
  const paymentIntent = charge && charge.payment_intent;
  if (!paymentIntent) return { handled: true, status: 'no_payment_intent', deducted: 0 };

  const session = await findSessionByPaymentIntent(paymentIntent);
  if (!session || session.mode !== 'payment') return { handled: true, status: 'not_a_notes_purchase', deducted: 0 };
  const { uid, coins } = session.metadata || {};
  const coinsTotal = parseInt(coins, 10);
  if (!uid || !(coinsTotal > 0)) return { handled: true, status: 'unknown_purchase', deducted: 0 };

  // Der Kauf muss von uns gutgeschrieben worden sein (Eintrag existiert)
  const purchaseRef = adminDb.ref(`users/${uid}/purchases/${session.id}`);
  if (!(await purchaseRef.once('value')).val()) return { handled: true, status: 'unknown_purchase', deducted: 0 };

  // Differenz per Transaktion beanspruchen (parallele oder doppelt zugestellte Ereignisse ziehen nicht doppelt ab)
  let plan = { delta: 0 };
  const stamp = now();
  await purchaseRef.transaction((p) => {
    if (!p) return p;
    plan = planStripeRefund({ coins: coinsTotal, amount: charge.amount, amountRefunded: charge.amount_refunded, alreadyRefundedCoins: p.refundedCoins || 0 });
    if (plan.delta <= 0) return p;
    return { ...p, refundedCoins: plan.targetTotal, ...(plan.full ? { refundedAt: stamp } : { partiallyRefundedAt: stamp }) };
  });
  if (plan.delta <= 0) return { handled: true, status: 'already_refunded', deducted: 0 };

  let deducted = 0;
  let balanceAfter = null;
  await adminDb.ref(`users/${uid}/profile`).transaction((profile) => {
    if (!profile) return profile;
    const before = profile.coins || 0;
    const after = Math.max(0, before - plan.delta);
    deducted = before - after;
    balanceAfter = after;
    return { ...profile, coins: after };
  });
  try {
    await logHistory(uid, -deducted, `Erstattet: ${plan.delta} 🎵`, balanceAfter);
  } catch (e) {
    console.warn('⚠️ Stripe-Erstattung: Noten-Verlauf konnte nicht geschrieben werden:', e.message);
  }
  return { handled: true, status: 'refunded', deducted };
};
