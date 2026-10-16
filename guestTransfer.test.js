import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signTicket, verifyTicket, coinsOfPurchase, transferablePurchases, summarizeGuest, transferGuestNotes, remainingPurchased, TICKET_TTL_MS } from './guestTransfer.js';

// Künstliche Firebase-Datenbank (Speicher im Objekt): ref(path).once()/transaction()/update()
const fakeDb = (initial = {}) => {
  const data = structuredClone(initial);
  const get = (path) => path.split('/').reduce((o, k) => (o == null ? o : o[k]), data);
  const set = (path, value) => {
    const keys = path.split('/');
    let o = data;
    keys.slice(0, -1).forEach((k) => { o[k] = o[k] ?? {}; o = o[k]; });
    o[keys[keys.length - 1]] = value;
  };
  return {
    data,
    ref: (path) => ({
      once: async () => ({ val: () => get(path) ?? null }),
      transaction: async (fn) => { const next = fn(get(path) ?? null); if (next !== undefined) set(path, next); return { committed: next !== undefined }; },
      update: async (patch) => { set(path, { ...(get(path) || {}), ...patch }); },
    }),
  };
};

const SECRET = 'test-secret';
const guestWorld = () => fakeDb({
  users: {
    guest: {
      profile: { coins: 55, totalEarned: 55 },
      purchases: {
        t1: { id: 't1', kind: 'coins', provider: 'revenuecat', productName: '50 Noten (Solo)' },
        t2: { id: 't2', kind: 'coins', provider: 'revenuecat', productName: '40 Noten (Solo)', coins: 40, refundedAt: 123 },
        t3: { id: 't3', kind: 'premium', provider: 'revenuecat', productName: 'Hitlines Premium (monatlich)' },
        t4: { id: 't4', kind: 'coins', provider: 'stripe', productName: '90 Noten (Duo)' },
      },
    },
    target: { profile: { coins: 483, totalEarned: 500 } },
  },
});

test('Ticket: echt, abgelaufen und manipuliert', () => {
  const now = 1_000_000;
  const t = signTicket('guest', SECRET, now);
  assert.equal(verifyTicket(t, SECRET, now + 1000), 'guest');
  assert.equal(verifyTicket(t, SECRET, now + TICKET_TTL_MS + 1), null);
  assert.equal(verifyTicket(t, 'anderes-geheimnis', now + 1000), null);
  const [payload, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ g: 'opfer', exp: now + 99999999, n: 'x' })).toString('base64url') + '.' + sig;
  assert.equal(verifyTicket(forged, SECRET, now + 1000), null);
  assert.equal(verifyTicket('quatsch', SECRET), null);
  assert.equal(verifyTicket(undefined, SECRET), null);
});

test('Noten eines Kaufs: Feld oder Name', () => {
  assert.equal(coinsOfPurchase({ coins: 150 }), 150);
  assert.equal(coinsOfPurchase({ productName: '50 Noten (Solo)' }), 50);
  assert.equal(coinsOfPurchase({ productName: 'Hitlines Premium' }), 0);
});

test('nur Store-Notenkäufe ohne Erstattung/Übertrag sind übertragbar', () => {
  const list = transferablePurchases(guestWorld().data.users.guest.purchases);
  assert.deepEqual(list.map((p) => p.id), ['t1']);
});

test('übrige gekaufte Noten = min(gekauft, Guthaben)', () => {
  assert.equal(remainingPurchased(50, 55), 50);
  assert.equal(remainingPurchased(50, 5), 5);
  assert.equal(remainingPurchased(50, 0), 0);
  assert.equal(remainingPurchased(0, 99), 0);
  assert.equal(remainingPurchased(undefined, undefined), 0);
});

test('Zusammenfassung des Gast-Kontos (unverbraucht, teilweise ausgegeben, Premium)', async () => {
  const db = guestWorld();
  assert.deepEqual(await summarizeGuest(db, 'guest'), { coins: 50, premium: false });
  db.data.users.guest.profile.coins = 5; // fast alles ausgegeben
  assert.equal((await summarizeGuest(db, 'guest')).coins, 5);
  db.data.users.guest.profile.premiumSubscription = { status: 'active', provider: 'revenuecat' };
  assert.equal((await summarizeGuest(db, 'guest')).premium, true);
});

test('Übertrag: Noten wandern, Verlauf auf beiden Seiten, Kaufeintrag markiert', async () => {
  const db = guestWorld();
  const history = [];
  const r = await transferGuestNotes({ adminDb: db, guestUid: 'guest', targetUid: 'target', logHistory: async (u, a, why, b) => { history.push({ u, a, b }); } });
  assert.equal(r.transferred, 50);
  assert.equal(db.data.users.target.profile.coins, 533);
  assert.equal(db.data.users.target.profile.totalEarned, 550);
  assert.equal(db.data.users.guest.profile.coins, 5);
  assert.equal(db.data.users.guest.purchases.t1.transferredTo, 'target');
  assert.deepEqual(history, [{ u: 'target', a: 50, b: 533 }, { u: 'guest', a: -50, b: 5 }]);
});

test('fast alles ausgegeben: nur der Rest wird übertragen, nicht das ganze Paket', async () => {
  const db = guestWorld();
  db.data.users.guest.profile.coins = 5; // 50 gekauft, aber nur 5 übrig
  const r = await transferGuestNotes({ adminDb: db, guestUid: 'guest', targetUid: 'target' });
  assert.equal(r.transferred, 5);
  assert.equal(db.data.users.target.profile.coins, 488);
  assert.equal(db.data.users.guest.profile.coins, 0);
  // der ausgegebene Rest kann später nicht mehr übertragen werden
  assert.equal(db.data.users.guest.purchases.t1.transferredTo, 'target');
});

test('Übertrag ist einmalig und idempotent', async () => {
  const db = guestWorld();
  await transferGuestNotes({ adminDb: db, guestUid: 'guest', targetUid: 'target' });
  const again = await transferGuestNotes({ adminDb: db, guestUid: 'guest', targetUid: 'target' });
  assert.equal(again.transferred, 0);
  assert.equal(db.data.users.target.profile.coins, 533);
  // auch nicht an ein anderes Konto
  db.data.users.other = { profile: { coins: 1 } };
  const third = await transferGuestNotes({ adminDb: db, guestUid: 'guest', targetUid: 'other' });
  assert.equal(third.transferred, 0);
  assert.equal(db.data.users.other.profile.coins, 1);
  // und die Zusammenfassung zeigt nichts mehr an
  assert.equal((await summarizeGuest(db, 'guest')).coins, 0);
});

test('Gast gleich Ziel oder fehlende Angaben: nichts passiert', async () => {
  const db = guestWorld();
  assert.equal((await transferGuestNotes({ adminDb: db, guestUid: 'guest', targetUid: 'guest' })).transferred, 0);
  assert.equal((await transferGuestNotes({ adminDb: db, guestUid: '', targetUid: 'target' })).transferred, 0);
  assert.equal(db.data.users.target.profile.coins, 483);
});

test('Guthaben null: nichts wird übertragen, Käufe gelten trotzdem als erledigt', async () => {
  const db = guestWorld();
  db.data.users.guest.profile.coins = 0;
  const r = await transferGuestNotes({ adminDb: db, guestUid: 'guest', targetUid: 'target' });
  assert.equal(r.transferred, 0);
  assert.equal(db.data.users.target.profile.coins, 483);
  assert.equal(db.data.users.guest.purchases.t1.transferredTo, 'target');
});

test('Übertrag legt den Kaufeintrag im Zielkonto an (Kaufverlauf), aber nicht erneut übertragbar', async () => {
  const db = guestWorld();
  await transferGuestNotes({ adminDb: db, guestUid: 'guest', targetUid: 'target' });
  const copy = db.data.users.target.purchases.t1;
  assert.equal(copy.transferredFrom, 'guest');
  assert.equal(copy.transferredTo, undefined);
  assert.equal(transferablePurchases(db.data.users.target.purchases).length, 0);
});

test('nichts übertragen (Guthaben 0): keine Kopie im Zielkonto', async () => {
  const db = guestWorld();
  db.data.users.guest.profile.coins = 0;
  await transferGuestNotes({ adminDb: db, guestUid: 'guest', targetUid: 'target' });
  assert.equal(db.data.users.target.purchases, undefined);
});
