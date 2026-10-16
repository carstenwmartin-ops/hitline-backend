// guestTransfer.js — Übertrag gekaufter Noten aus einem anonymen Gast-Konto in ein vorhandenes Konto.
//
// Hintergrund: In der App kann man ohne Registrierung kaufen (anonymes Firebase-Konto). Meldet man sich danach mit
// einem BEREITS vorhandenen Konto an, wechselt die Konto-ID und die gekauften Noten blieben im Gast-Konto zurück.
// Ablauf: (1) VOR dem Wechsel holt die App mit dem Token des Gast-Kontos ein kurzlebiges, signiertes Ticket.
// (2) NACH der Anmeldung (und nur nach Zustimmung der Person) schickt sie Ticket + Token des Zielkontos zurück.
// Übertragen werden nur GEKAUFTE Noten, nie erspielte (Tagesgrenze gegen Missbrauch), und nur der AKTUELL GÜLTIGE Stand:
// Beim Ausgeben gelten erspielte Noten zuerst, gekaufte zuletzt. Von P gekauften Noten sind bei einem Guthaben B daher noch
// min(P, B) übrig (wer fast alles ausgegeben hat, bekommt entsprechend weniger übertragen, nicht das ganze Paket).
// Der Übertrag ist einmalig und idempotent: ein Marker am Gast-Konto (guestTransfer) verhindert einen zweiten Durchlauf.

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const TICKET_TTL_MS = 15 * 60 * 1000;

const b64 = (buf) => Buffer.from(buf).toString('base64url');

export const signTicket = (guestUid, secret, now = Date.now()) => {
  const payload = b64(JSON.stringify({ g: guestUid, exp: now + TICKET_TTL_MS, n: randomBytes(8).toString('hex') }));
  const sig = createHmac('sha256', 'hitlines-guest-transfer:' + secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
};

// Gibt die Gast-UID zurück, wenn das Ticket echt und nicht abgelaufen ist, sonst null.
export const verifyTicket = (ticket, secret, now = Date.now()) => {
  if (typeof ticket !== 'string' || !secret) return null;
  const [payload, sig] = ticket.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', 'hitlines-guest-transfer:' + secret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.g || typeof data.exp !== 'number' || data.exp < now) return null;
    return data.g;
  } catch { return null; }
};

// Anzahl gekaufter Noten eines Kaufeintrags (neue Einträge haben `coins`, ältere nur "40 Noten (Solo)" im Namen).
export const coinsOfPurchase = (p) => {
  if (Number.isFinite(p?.coins) && p.coins > 0) return p.coins;
  const m = String(p?.productName || '').match(/^\s*(\d+)\s*Noten/i);
  return m ? parseInt(m[1], 10) : 0;
};

// Übertragbare Käufe: Noten, über den Store gekauft, nicht erstattet, noch nicht übertragen.
export const transferablePurchases = (purchases) => Object.values(purchases || {})
  .filter((p) => p && p.kind === 'coins' && p.provider === 'revenuecat' && !p.refundedAt && !p.transferredTo && !p.transferredFrom && coinsOfPurchase(p) > 0);

// Noch gültige gekaufte Noten: min(gekaufte Summe, aktuelles Guthaben) — erspielte werden zuerst ausgegeben.
export const remainingPurchased = (purchasedSum, balance) => Math.max(0, Math.min(purchasedSum || 0, balance || 0));

export const summarizeGuest = async (adminDb, guestUid) => {
  const purchases = (await adminDb.ref(`users/${guestUid}/purchases`).once('value')).val() || {};
  const profile = (await adminDb.ref(`users/${guestUid}/profile`).once('value')).val() || {};
  const sub = profile.premiumSubscription;
  const already = (await adminDb.ref(`users/${guestUid}/guestTransfer`).once('value')).val();
  const purchasedSum = transferablePurchases(purchases).reduce((n, p) => n + coinsOfPurchase(p), 0);
  return {
    coins: already ? 0 : remainingPurchased(purchasedSum, profile.coins),
    premium: !already && !!(sub && sub.status === 'active' && sub.provider === 'revenuecat'),
  };
};

/**
 * Überträgt die noch gültigen gekauften Noten des Gast-Kontos auf das Zielkonto (einmalig).
 * @returns {{transferred: number}} tatsächlich übertragene Noten (0, wenn schon übertragen oder nichts vorhanden)
 */
export const transferGuestNotes = async ({ adminDb, guestUid, targetUid, logHistory }) => {
  if (!guestUid || !targetUid || guestUid === targetUid) return { transferred: 0 };

  // Einmalig: Marker am Gast-Konto (Transaktion). Wer ihn nicht setzen kann, war zu spät.
  let first = false;
  await adminDb.ref(`users/${guestUid}/guestTransfer`).transaction((cur) => {
    if (cur) return undefined;
    first = true;
    return { to: targetUid, at: Date.now() };
  });
  if (!first) return { transferred: 0 };

  const purchases = (await adminDb.ref(`users/${guestUid}/purchases`).once('value')).val() || {};
  const list = transferablePurchases(purchases);
  const purchasedSum = list.reduce((n, p) => n + coinsOfPurchase(p), 0);
  const guestProfile = (await adminDb.ref(`users/${guestUid}/profile`).once('value')).val() || {};
  const n = remainingPurchased(purchasedSum, guestProfile.coins);

  // alle gekauften Einträge als erledigt markieren (auch ein bereits ausgegebener Rest wird nicht später übertragen)
  for (const p of list) {
    await adminDb.ref(`users/${guestUid}/purchases/${p.id}`).update({ transferredTo: targetUid });
  }
  if (n <= 0) return { transferred: 0 };
  // Kopie im Zielkonto, damit der Kaufverlauf dort den Kauf zeigt (Erstattungen markieren beide Einträge)
  for (const p of list) {
    await adminDb.ref(`users/${targetUid}/purchases/${p.id}`).update({ ...p, transferredFrom: guestUid });
  }

  let targetBalance = null;
  await adminDb.ref(`users/${targetUid}/profile`).transaction((profile) => {
    const base = profile || {};
    targetBalance = (base.coins || 0) + n;
    return { ...base, coins: targetBalance, totalEarned: (base.totalEarned || 0) + n };
  });
  let guestBalance = null;
  await adminDb.ref(`users/${guestUid}/profile`).transaction((profile) => {
    if (!profile) return profile;
    guestBalance = Math.max(0, (profile.coins || 0) - n);
    return { ...profile, coins: guestBalance };
  });
  if (logHistory) {
    await logHistory(targetUid, n, `Übernommen aus Gast-Konto: ${n} 🎵`, targetBalance);
    await logHistory(guestUid, -n, `Übertragen in Konto: ${n} 🎵`, guestBalance);
  }
  return { transferred: n };
};
