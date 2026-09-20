// mail/purchaseConfirmation.js — Kaufbestätigung für Web-Käufe (Stripe): Noten und Hitlines Premium.
//
// Zweck (rechtlich): Bestätigung des Vertrags auf einem dauerhaften Datenträger (§ 312f BGB) mit Vertragsinhalt,
// der Zustimmung zum sofortigen Beginn und den Rechtstexten (Widerrufsbelehrung, AGB) in der Fassung zum Kaufzeitpunkt.
//
// !! Die kursiv/als "ERLÄUTERUNG" markierten Formulierungen zum Widerrufsrecht sind ENTWÜRFE und müssen vor der
// !! Live-Schaltung des Web-Shops von der IT-Recht Kanzlei geprüft bzw. durch deren Wortlaut ersetzt werden
// !! (siehe AGB-LUECKEN.md, Punkte B2/B12 und Mail-Frage 4).
import { LEGAL } from '../legal/index.js';

export const PROVIDER = {
  name: 'Carsten Martin UG (haftungsbeschränkt)',
  street: 'Moosäcker 24',
  city: '85296 Rohrbach',
  country: 'Deutschland',
  email: 'carsten.martin@hitlines.de',
  phone: '+49 163 3723882',
  register: 'Amtsgericht Ingolstadt, HRB 13018',
  vatId: 'DE463560309',
  managingDirector: 'Carsten Martin',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const formatMoney = (cents, currency = 'eur') =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: String(currency || 'eur').toUpperCase() }).format((cents || 0) / 100);

export const formatDateTime = (ms) =>
  new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeStyle: 'medium', timeZone: 'Europe/Berlin' }).format(new Date(ms)) + ' Uhr';

const PLAN_LABEL = { monthly: 'monatlich', yearly: 'jährlich' };

/**
 * @param {object} p Kaufeintrag (users/{uid}/purchases/{id})
 * @returns {{subject:string, text:string, html:string}}
 */
export const buildPurchaseConfirmation = (p) => {
  const isPremium = p.kind === 'premium';
  const price = formatMoney(p.amount, p.currency);
  const when = formatDateTime(p.createdAt);
  const agb = LEGAL.agb;
  const widerruf = LEGAL.widerruf;
  const consentWhen = p.consent?.givenAt ? formatDateTime(p.consent.givenAt) : null;

  const subject = `Bestellbestätigung: ${p.productName} – Hitlines: Songflow`;

  // ── Bausteine (jeweils Text + HTML) ──────────────────────────────────────────────
  const orderRows = [
    ['Bestellnummer', p.id],
    ['Datum und Uhrzeit', when],
    ['Produkt', p.productName],
    ['Gesamtpreis (inkl. gesetzlicher Umsatzsteuer)', isPremium ? `${price} je ${p.plan === 'yearly' ? 'Jahr' : 'Monat'}` : price],
    ['Zahlungsart', 'Kreditkarte (Zahlungsabwicklung über Stripe)'],
    ['Anbieter', `${PROVIDER.name}, ${PROVIDER.street}, ${PROVIDER.city}, ${PROVIDER.country}`],
  ];

  const deliveryText = isPremium
    ? 'Hitlines Premium wurde für dein Konto sofort nach Zahlungseingang freigeschaltet. Es ermöglicht dir die Nutzung deiner eigenen Apple-Music-Playlists als Songquelle im Spiel. Ein eigenes, aktives Apple-Music-Abo ist Voraussetzung und nicht Bestandteil von Hitlines Premium.'
    : `Die ${p.coins ? p.coins + ' ' : ''}Noten wurden deinem Hitlines-Konto sofort nach Zahlungseingang gutgeschrieben. Noten sind eine virtuelle Spielwährung: Sie sind nur in Hitlines nutzbar, haben keinen Geldwert, sind nicht übertragbar und werden nicht ausgezahlt.`;

  const subscriptionText = isPremium
    ? [
        `Laufzeit: ${PLAN_LABEL[p.plan] || ''} (Preis ${price} je ${p.plan === 'yearly' ? 'Jahr' : 'Monat'}). Das Abonnement verlängert sich automatisch um die gewählte Laufzeit, solange du es nicht kündigst.`,
        'Kündigung: jederzeit in der App unter Profil → „Abo verwalten / kündigen“. Die Kündigung wirkt zum Ende der laufenden Laufzeit; bis dahin behältst du den Zugriff.',
      ]
    : null;

  // ERLÄUTERUNG zur Zustimmung — ENTWURF, Kanzlei-Prüfung nötig (siehe Kopfkommentar)
  const consentExplain = isPremium
    ? 'Damit haben wir auf deinen ausdrücklichen Wunsch sofort mit der Leistung begonnen. Widerrufst du den Vertrag innerhalb der Widerrufsfrist, hast du uns einen angemessenen Betrag für die bis zum Widerruf bereits erbrachten Leistungen zu zahlen (Wertersatz).'
    : 'Damit haben wir auf deinen ausdrücklichen Wunsch sofort mit der Ausführung begonnen. Mit der Gutschrift der Noten haben wir den Vertrag vollständig erfüllt; dein Widerrufsrecht ist damit erloschen.';

  const withdrawalText = `Wenn dir ein Widerrufsrecht zusteht, kannst du es mit einer eindeutigen Erklärung an ${PROVIDER.email} ausüben (Muster-Widerrufsformular siehe unten). Die vollständige Widerrufsbelehrung findest du am Ende dieser E-Mail.`;

  // ── Klartext ─────────────────────────────────────────────────────────────────────
  const line = '────────────────────────────────────────';
  const t = [];
  t.push('Hallo,', '', 'vielen Dank für deine Bestellung bei Hitlines: Songflow. Hiermit bestätigen wir den Abschluss des Vertrags.', '');
  t.push('DEINE BESTELLUNG', line);
  for (const [k, v] of orderRows) t.push(`${k}: ${v}`);
  t.push('', 'LEISTUNG', line, deliveryText, '');
  if (subscriptionText) { t.push('ABONNEMENT', line, ...subscriptionText, ''); }
  t.push('DEINE ZUSTIMMUNG ZUM SOFORTIGEN BEGINN', line);
  if (p.consent?.text) {
    t.push(`Du hast am ${consentWhen} im Kaufdialog folgender Erklärung zugestimmt:`, `„${p.consent.text}“`, '', consentExplain, '');
  } else {
    t.push('Zu diesem Kauf liegt keine gespeicherte Zustimmungserklärung vor.', '');
  }
  t.push('WIDERRUFSRECHT', line, withdrawalText, '');
  t.push('RECHTSTEXTE (Fassung zum Zeitpunkt deines Kaufs)', line);
  t.push(`Widerrufsbelehrung und Muster-Widerrufsformular, Stand ${widerruf.stand}`, `Allgemeine Geschäftsbedingungen, Stand ${agb.stand}`, '');
  t.push(line, widerruf.text, '', `© IT-Recht Kanzlei (Stand: ${widerruf.stand})`, '', line, agb.text, '', `© IT-Recht Kanzlei (Stand: ${agb.stand})`, '', line);
  t.push('', `${PROVIDER.name}`, `${PROVIDER.street}, ${PROVIDER.city}, ${PROVIDER.country}`, `Geschäftsführer: ${PROVIDER.managingDirector}`, `${PROVIDER.register} · USt-IdNr. ${PROVIDER.vatId}`, `E-Mail: ${PROVIDER.email} · Tel.: ${PROVIDER.phone}`);
  const text = t.join('\n');

  // ── HTML ─────────────────────────────────────────────────────────────────────────
  const h = (tag, content, style = '') => `<${tag} style="${style}">${content}</${tag}>`;
  const sec = (title) => h('h2', esc(title), 'font-size:15px;letter-spacing:.04em;text-transform:uppercase;color:#0b6b8a;margin:28px 0 8px;border-bottom:1px solid #d9dee3;padding-bottom:6px;');
  const para = (s) => h('p', s, 'margin:0 0 10px;line-height:1.55;');
  const rows = orderRows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#5b6570;vertical-align:top;">${esc(k)}</td><td style="padding:4px 0;">${esc(v)}</td></tr>`).join('');
  const legalBlock = (title, stand, inner) =>
    `${sec(title)}<div style="font-size:12.5px;line-height:1.5;color:#2b333b;">${inner}<p style="margin:14px 0 0;color:#5b6570;">© IT-Recht Kanzlei (Stand: ${esc(stand)})</p></div>`;

  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#f3f5f7;font-family:Arial,Helvetica,sans-serif;color:#1e262d;">
<div style="max-width:680px;margin:0 auto;padding:24px 16px;">
<div style="background:#ffffff;border-radius:12px;padding:24px 28px;">
${h('h1', 'Hitlines: Songflow', 'font-size:20px;margin:0 0 4px;color:#050312;')}
${para('Hallo,')}
${para('vielen Dank für deine Bestellung. Hiermit bestätigen wir den Abschluss des Vertrags.')}
${sec('Deine Bestellung')}
<table style="border-collapse:collapse;font-size:14px;">${rows}</table>
${sec('Leistung')}
${para(esc(deliveryText))}
${subscriptionText ? sec('Abonnement') + subscriptionText.map((s) => para(esc(s))).join('') : ''}
${sec('Deine Zustimmung zum sofortigen Beginn')}
${p.consent?.text
    ? para(`Du hast am ${esc(consentWhen)} im Kaufdialog folgender Erklärung zugestimmt:`) + h('p', `„${esc(p.consent.text)}“`, 'margin:0 0 10px;padding:10px 12px;background:#f3f5f7;border-left:3px solid #0b6b8a;line-height:1.5;') + para(esc(consentExplain))
    : para('Zu diesem Kauf liegt keine gespeicherte Zustimmungserklärung vor.')}
${sec('Widerrufsrecht')}
${para(esc(withdrawalText))}
${legalBlock('Widerrufsbelehrung und Muster-Widerrufsformular', widerruf.stand, widerruf.html)}
${legalBlock('Allgemeine Geschäftsbedingungen', agb.stand, agb.html)}
<p style="margin:28px 0 0;font-size:12px;color:#5b6570;line-height:1.5;">${esc(PROVIDER.name)}<br>${esc(PROVIDER.street)}, ${esc(PROVIDER.city)}, ${esc(PROVIDER.country)}<br>Geschäftsführer: ${esc(PROVIDER.managingDirector)} · ${esc(PROVIDER.register)} · USt-IdNr. ${esc(PROVIDER.vatId)}<br>E-Mail: ${esc(PROVIDER.email)} · Tel.: ${esc(PROVIDER.phone)}</p>
</div></div></body></html>`;

  return { subject, text, html };
};
