import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCoinRefundEvent, applyRefundToProfile, handleCoinRefund } from './storeRefund.js';

const PACKAGES = [
  { id: 'coins_40', coins: 40, label: 'Solo' },
  { id: 'coins_150', coins: 150, label: 'Band' },
];

// Künstliche Firebase-Datenbank: nur ref(path).transaction()/update() mit Speicher im Objekt.
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
      transaction: async (fn) => { const next = fn(get(path) ?? null); if (next !== undefined) set(path, next); return { committed: true }; },
      update: async (patch) => { set(path, { ...(get(path) || {}), ...patch }); },
    }),
  };
};

const refundEvent = (over = {}) => ({
  type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', product_id: 'coins_150',
  app_user_id: 'uid1', transaction_id: 'tx-1', ...over,
});

test('erkennt nur Store-Erstattungen für Noten-Produkte', () => {
  const ids = PACKAGES.map((p) => p.id);
  assert.equal(isCoinRefundEvent(refundEvent(), ids), true);
  assert.equal(isCoinRefundEvent(refundEvent({ cancel_reason: 'UNSUBSCRIBE' }), ids), false);
  assert.equal(isCoinRefundEvent(refundEvent({ type: 'NON_RENEWING_PURCHASE' }), ids), false);
  assert.equal(isCoinRefundEvent(refundEvent({ product_id: 'hitlines_premium_monthly' }), ids), false);
  assert.equal(isCoinRefundEvent(null, ids), false);
});

test('Erstattung zieht die Noten ab und merkt sich die Transaktion', () => {
  const profile = { coins: 200, processedRevenueCatTransactions: { 'tx-1': true } };
  const r = applyRefundToProfile(profile, { transactionId: 'tx-1', coins: 150 });
  assert.equal(r.status, 'refunded');
  assert.equal(r.deducted, 150);
  assert.equal(r.profile.coins, 50);
  assert.equal(r.profile.processedRevenueCatRefunds['tx-1'], true);
});

test('Guthaben fällt nie unter 0 (Noten schon ausgegeben)', () => {
  const profile = { coins: 30, processedRevenueCatTransactions: { 'tx-1': true } };
  const r = applyRefundToProfile(profile, { transactionId: 'tx-1', coins: 150 });
  assert.equal(r.profile.coins, 0);
  assert.equal(r.deducted, 30);
});

test('doppelt zugestelltes Ereignis zieht nicht zweimal ab', () => {
  const profile = { coins: 200, processedRevenueCatTransactions: { 'tx-1': true } };
  const first = applyRefundToProfile(profile, { transactionId: 'tx-1', coins: 150 });
  const second = applyRefundToProfile(first.profile, { transactionId: 'tx-1', coins: 150 });
  assert.equal(second.status, 'already_refunded');
  assert.equal(second.profile.coins, 50);
});

test('unbekannte Transaktion (nie von uns gutgeschrieben) ändert nichts', () => {
  const profile = { coins: 200, processedRevenueCatTransactions: { 'andere': true } };
  const r = applyRefundToProfile(profile, { transactionId: 'tx-1', coins: 150 });
  assert.equal(r.status, 'unknown_transaction');
  assert.equal(r.profile.coins, 200);
});

test('Gesamtablauf mit künstlicher Datenbank: abziehen, Verlauf, Kaufeintrag', async () => {
  const db = fakeDb({
    users: { uid1: {
      profile: { coins: 160, processedRevenueCatTransactions: { 'tx-1': true } },
      purchases: { 'tx-1': { id: 'tx-1', kind: 'coins', provider: 'revenuecat' } },
    } },
  });
  const history = [];
  const logHistory = async (uid, amount, reason, bal) => { history.push({ uid, amount, reason, bal }); };

  const r1 = await handleCoinRefund({ adminDb: db, packages: PACKAGES, logHistory }, refundEvent());
  assert.deepEqual({ handled: r1.handled, status: r1.status, deducted: r1.deducted }, { handled: true, status: 'refunded', deducted: 150 });
  assert.equal(db.data.users.uid1.profile.coins, 10);
  assert.ok(db.data.users.uid1.purchases['tx-1'].refundedAt > 0);
  assert.deepEqual(history, [{ uid: 'uid1', amount: -150, reason: 'Erstattet: 150 🎵', bal: 10 }]);

  // erneute Zustellung: keine zweite Buchung
  const r2 = await handleCoinRefund({ adminDb: db, packages: PACKAGES, logHistory }, refundEvent());
  assert.equal(r2.status, 'already_refunded');
  assert.equal(db.data.users.uid1.profile.coins, 10);
  assert.equal(history.length, 1);
});

test('fremde Ereignisse werden nicht behandelt', async () => {
  const db = fakeDb({ users: { uid1: { profile: { coins: 50 } } } });
  const r = await handleCoinRefund({ adminDb: db, packages: PACKAGES, logHistory: async () => {} }, refundEvent({ cancel_reason: 'UNSUBSCRIBE' }));
  assert.equal(r.handled, false);
  assert.equal(db.data.users.uid1.profile.coins, 50);
});
