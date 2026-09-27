// mail/withdrawalConfirmation.js — Bestätigung eines Widerrufs (§ 356a BGB: unverzügliche Bestätigung
// auf einem dauerhaften Datenträger, mit Inhalt und Zeitpunkt des Widerrufs).
//
// !! Der Wortlaut ist ein ENTWURF. Insbesondere der Satz zum Wertersatz muss vor der Live-Schaltung
// !! durch die von der Kanzlei bestätigte Berechnung ersetzt werden (siehe withdrawal.js,
// !! REFUND_STATUS_PENDING, und AGB-LUECKEN.md).
import { formatMoney, formatDateTime } from './purchaseConfirmation.js';

const PLAN_LABEL = { monthly: 'monatlich', yearly: 'jährlich' };

/**
 * @param {object} p Kaufeintrag (users/{uid}/purchases/{id}) MIT withdrawnAt gesetzt
 * @returns {{subject:string, text:string, html:string}}
 */
export const buildWithdrawalConfirmation = (p) => {
  const isPremium = p.kind === 'premium';
  const productName = p.productName || (isPremium ? `Hitlines Premium (${PLAN_LABEL[p.plan] || p.plan})` : 'Hitlines-Kauf');
  const purchasedAt = formatDateTime(p.createdAt);
  const withdrawnAt = formatDateTime(p.withdrawnAt);
  const price = formatMoney(p.amount, p.currency);

  const subject = `Bestätigung deines Widerrufs — ${productName}`;

  const wertersatzText = isPremium
    ? 'Da du den Vertrag bereits vor Ablauf der Widerrufsfrist genutzt hast, schuldest du uns einen angemessenen Betrag für die bis zum Widerruf erbrachte Leistung (Wertersatz). Diesen Betrag ermitteln wir gesondert und teilen ihn dir zusammen mit der Rückerstattung des Restbetrags in einer separaten Nachricht mit.'
    : '';

  const lines = [
    'Hiermit bestätigen wir den Eingang deines Widerrufs.',
    '',
    `Vertrag: ${productName}`,
    `Vertragsschluss: ${purchasedAt}`,
    `Preis: ${price}`,
    `Widerruf eingegangen am: ${withdrawnAt}`,
    '',
    'Dein Zugriff auf die Leistung endet mit sofortiger Wirkung.',
  ];
  if (wertersatzText) lines.push('', wertersatzText);
  lines.push('', 'Bei Fragen erreichst du uns unter carsten.martin@hitlines.de.');

  const text = lines.join('\n');
  const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#111">${
    lines.map((l) => (l ? `<p style="margin:0 0 8px">${l}</p>` : '<br>')).join('')
  }</div>`;

  return { subject, text, html };
};
