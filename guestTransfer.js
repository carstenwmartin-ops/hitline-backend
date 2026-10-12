// guestTransfer.js — Übertrag gekaufter Noten aus einem anonymen Gast-Konto in ein vorhandenes Konto.
//
// Hintergrund: In der App kann man ohne Registrierung kaufen (anonymes Firebase-Konto). Meldet man sich danach mit
// einem BEREITS vorhandenen Konto an, wechselt die Konto-ID und die gekauften Noten blieben im Gast-Konto zurück.
// Ablauf: (1) VOR dem Wechsel holt die App mit dem Token des Gast-Kontos ein kurzlebiges, signiertes Ticket.
// (2) NACH der Anmeldung (und nur nach Zustimmung der Person) schickt sie Ticket + Token des Zielkontos zurück.
// Übertragen werden nur GEKAUFTE Noten (Kaufeinträge), nie erspielte (Tagesgrenze gegen Missbrauch). Jeder Kaufeintrag
// wird einzeln "geclaimt" (transferredTo) — dadurch ist der Übertrag idempotent, auch bei doppeltem Aufruf.

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
  .filter((p) => p && p.kind === 'coins' && p.provider === 'revenuecat' && !p.refundedAt && !p.transferredTo && coinsOfPurchase(p) > 0);

export const summarizeGuest = async (adminDb, guestUid) => {
  const purchases = (await adminDb.ref(`users/${guestUid}/purchases`).once('value')).val() || {};
  const sub = (await adminDb.ref(`users/${guestUid}/profile/premiumSubscription`).once('value')).val();
  const list = transferablePurchases(purchases);
  return {
    coins: list.reduce((n, p) => n + coinsOfPurchase(p), 0),
    premium: !!(sub && sub.status === 'active' && sub.provider === 'revenuecat'),
  };
};

/**
 * Überträgt die gekauften Noten des Gast-Kontos auf das Zielkonto.
 * @returns {{transferred: number}} tatsächlich übertragene Noten (0, wenn schon übertragen oder nichts vorhanden)
 */
export const transferGuestNotes = async ({ adminDb, guestUid, targetUid, logHistory }) => {
  if (!guestUid || !targetUid || guestUid === targetUid) return { transferred: 0 };
  const purchases = (await adminDb.ref(`users/${guestUid}/purchases`).once('value')).val() || {};
  let transferred = 0;
  for (const p of transferablePurchases(purchases)) {
    // Einzeln beanspruchen: nur wer das Feld als Erster setzt, darf gutschreiben (idempotent)
    let claimed = false;
    await adminDb.ref(`users/${guestUid}/purchases/${p.id}/transferredTo`).transaction((cur) => {
      if (cur) return undefined;
      claimed = true;
      return targetUid;
    });
    if (!claimed) continue;
    const n = coinsOfPurchase(p);
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
    transferred += n;
  }
  return { transferred };
};
