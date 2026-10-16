import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planStripeRefund, handleStripeRefund } from './stripeRefund.js';

// Künstliche Firebase-Datenbank: ref(path).once()/transaction()/update() mit Speicher im Objekt.
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
      transaction: async (fn) => { const next = fn(get(path) ?? null); if (next !== undefined && next !== null) set(path, next); return { committed: true }; },
      update: async (patch) => { set(path, { ...(get(path) || {}), ...patch }); },
    }),
  };
};

const world = () => fakeDb({
  users: { u1: { profile: { coins: 100, totalEarned: 100 }, purchases: { cs_1: { id: 'cs_1', kind: 'coins', coins: 40, provider: 'stripe' } } } },
});
const session = { id: 'cs_1', mode: 'payment', metadata: { uid: 'u1', coins: '40' } };
const find = (s = session) => async () => s;
const refundEvent = (over = {}) => ({ type: 'charge.refunded', data: { object: { payment_intent: 'pi_1', amount: 299, amount_refunded: 299, ...over } } });

test('Berechnung: volle und teilweise Erstattung', () => {
  assert.deepEqual(planStripeRefund({ coins: 40, amount: 299, amountRefunded: 299 }), { targetTotal: 40, delta: 40, full: true });
  assert.deepEqual(planStripeRefund({ coins: 40, amount: 300, amountRefunded: 150 }), { targetTotal: 20, delta: 20, full: false });
  assert.deepEqual(planStripeRefund({ coins: 40, amount: 300, amountRefunded: 225 }, 0), { targetTotal: 30, delta: 30, full: false });
  // schon abgezogene Noten werden nicht doppelt gezählt
  assert.deepEqual(planStripeRefund({ coins: 40, amount: 300, amountRefunded: 300, alreadyRefundedCoins: 20 }), { targetTotal: 40, delta: 20, full: true });
  assert.equal(planStripeRefund({ coins: 40, amount: 300, amountRefunded: 0 }).delta, 0);
  assert.equal(planStripeRefund({ coins: 0, amount: 300, amountRefunded: 300 }).delta, 0);
});

test('fremde Ereignisse werden nicht behandelt', async () => {
  const r = await handleStripeRefund({ adminDb: world(), findSessionByPaymentIntent: find(), logHistory: async () => {} }, { type: 'invoice.paid' });
  assert.equal(r.handled, false);
});

test('volle Erstattung: Noten abziehen, Verlauf, Kaufeintrag', async () => {
  const db = world();
  const history = [];
  const logHistory = async (uid, amount, reason, bal) => { history.push({ uid, amount, reason, bal }); };
  const r = await handleStripeRefund({ adminDb: db, findSessionByPaymentIntent: find(), logHistory, now: () => 123 }, refundEvent());
  assert.deepEqual({ status: r.status, deducted: r.deducted }, { status: 'refunded', deducted: 40 });
  assert.equal(db.data.users.u1.profile.coins, 60);
  assert.equal(db.data.users.u1.purchases.cs_1.refundedAt, 123);
  assert.equal(db.data.users.u1.purchases.cs_1.refundedCoins, 40);
  assert.deepEqual(history, [{ uid: 'u1', amount: -40, reason: 'Erstattet: 40 🎵', bal: 60 }]);
});

test('doppelt zugestelltes Ereignis zieht nicht noch einmal ab', async () => {
  const db = world();
  const deps = { adminDb: db, findSessionByPaymentIntent: find(), logHistory: async () => {} };
  await handleStripeRefund(deps, refundEvent());
  const again = await handleStripeRefund(deps, refundEvent());
  assert.equal(again.status, 'already_refunded');
  assert.equal(db.data.users.u1.profile.coins, 60);
});

test('Teilerstattung, danach der Rest: insgesamt nur 40 Noten', async () => {
  const db = world();
  const deps = { adminDb: db, findSessionByPaymentIntent: find(), logHistory: async () => {}, now: () => 5 };
  const a = await handleStripeRefund(deps, refundEvent({ amount: 300, amount_refunded: 150 }));
  assert.equal(a.deducted, 20);
  assert.ok(db.data.users.u1.purchases.cs_1.partiallyRefundedAt > 0);
  assert.equal(db.data.users.u1.purchases.cs_1.refundedAt, undefined);
  const b = await handleStripeRefund(deps, refundEvent({ amount: 300, amount_refunded: 300 }));
  assert.equal(b.deducted, 20);
  assert.equal(db.data.users.u1.profile.coins, 60);
  assert.equal(db.data.users.u1.purchases.cs_1.refundedAt, 5);
});

test('Guthaben fällt nie unter 0', async () => {
  const db = world();
  db.data.users.u1.profile.coins = 12;
  const r = await handleStripeRefund({ adminDb: db, findSessionByPaymentIntent: find(), logHistory: async () => {} }, refundEvent());
  assert.equal(r.deducted, 12);
  assert.equal(db.data.users.u1.profile.coins, 0);
});

test('Abo-Zahlung, unbekannter Kauf oder ohne payment_intent: nichts passiert', async () => {
  const db = world();
  const base = { adminDb: db, logHistory: async () => {} };
  assert.equal((await handleStripeRefund({ ...base, findSessionByPaymentIntent: find({ ...session, mode: 'subscription' }) }, refundEvent())).status, 'not_a_notes_purchase');
  assert.equal((await handleStripeRefund({ ...base, findSessionByPaymentIntent: find(null) }, refundEvent())).status, 'not_a_notes_purchase');
  assert.equal((await handleStripeRefund({ ...base, findSessionByPaymentIntent: find({ ...session, id: 'cs_unbekannt' }) }, refundEvent())).status, 'unknown_purchase');
  assert.equal((await handleStripeRefund({ ...base, findSessionByPaymentIntent: find() }, refundEvent({ payment_intent: null }))).status, 'no_payment_intent');
  assert.equal(db.data.users.u1.profile.coins, 100);
});
