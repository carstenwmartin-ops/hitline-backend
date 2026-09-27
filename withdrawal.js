// withdrawal.js — Regeln für den Widerruf eines Web-Kaufs (users/{uid}/purchases/{id}).
//
// Zwei völlig unterschiedliche Fälle:
// - Noten (kind: 'coins'): digitaler Inhalt, sofort vollständig geliefert. Mit der im Kaufdialog
//   verlangten Zustimmung zum sofortigen Beginn ist das Widerrufsrecht in diesem Moment bereits
//   erloschen (§ 356 Abs. 5 BGB) — hier gibt es nichts mehr zu widerrufen.
// - Hitlines Premium (kind: 'premium'): Dienstleistung. Das Widerrufsrecht bleibt innerhalb der
//   14-Tage-Frist bestehen, der Kunde schuldet aber Wertersatz für die bereits erbrachte Leistung
//   (§ 357a BGB). Die genaue Berechnungsformel ist eine offene Rechtsfrage (siehe Mail an die
//   Kanzlei) — bis zur Antwort wird der Betrag NICHT automatisch berechnet oder erstattet, siehe
//   REFUND_STATUS_PENDING unten.
export const WITHDRAWAL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// Markiert einen Widerruf, dessen Wertersatz noch von Hand zu berechnen und zu erstatten ist —
// absichtlich kein automatischer Stripe-Refund, solange die Berechnungsformel nicht mit der
// Kanzlei abgestimmt ist.
export const REFUND_STATUS_PENDING = 'pending_manual_calculation';

/**
 * @param {object|null} purchase Eintrag aus users/{uid}/purchases/{id}, oder null wenn nicht gefunden
 * @param {number} now Date.now(), als Parameter für Tests
 * @returns {{allowed: boolean, reason: string}}
 *   reason: 'not_found' | 'already_withdrawn' | 'digital_content_delivered' | 'expired' | 'ok'
 */
export const canWithdraw = (purchase, now = Date.now()) => {
  if (!purchase) return { allowed: false, reason: 'not_found' };
  if (purchase.withdrawnAt) return { allowed: false, reason: 'already_withdrawn' };
  if (purchase.kind === 'coins') return { allowed: false, reason: 'digital_content_delivered' };
  const age = now - (purchase.createdAt || 0);
  if (age > WITHDRAWAL_WINDOW_MS || age < 0) return { allowed: false, reason: 'expired' };
  return { allowed: true, reason: 'ok' };
};
