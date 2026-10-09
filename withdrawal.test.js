import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canWithdraw, WITHDRAWAL_WINDOW_MS } from './withdrawal.js';

test('nicht gefunden', () => {
  assert.deepEqual(canWithdraw(null), { allowed: false, reason: 'not_found' });
});

test('bereits widerrufen', () => {
  assert.deepEqual(canWithdraw({ kind: 'premium', createdAt: Date.now(), withdrawnAt: 123 }), { allowed: false, reason: 'already_withdrawn' });
});

test('Noten: Widerrufsrecht durch sofortige Lieferung immer erloschen', () => {
  const now = Date.now();
  assert.deepEqual(canWithdraw({ kind: 'coins', createdAt: now }, now), { allowed: false, reason: 'digital_content_delivered' });
  assert.deepEqual(canWithdraw({ kind: 'coins', createdAt: now - 1000 }, now), { allowed: false, reason: 'digital_content_delivered' });
});

test('Premium: innerhalb der 14-Tage-Frist erlaubt', () => {
  const now = Date.now();
  assert.deepEqual(canWithdraw({ kind: 'premium', createdAt: now - 5 * 86400000 }, now), { allowed: true, reason: 'ok' });
  assert.deepEqual(canWithdraw({ kind: 'premium', createdAt: now }, now), { allowed: true, reason: 'ok' });
});

test('Premium: Frist knapp innerhalb und knapp abgelaufen', () => {
  const now = Date.now();
  assert.equal(canWithdraw({ kind: 'premium', createdAt: now - WITHDRAWAL_WINDOW_MS + 1000 }, now).allowed, true);
  assert.deepEqual(canWithdraw({ kind: 'premium', createdAt: now - WITHDRAWAL_WINDOW_MS - 1000 }, now), { allowed: false, reason: 'expired' });
});

test('Kaufdatum in der Zukunft wird abgelehnt (Datenfehler)', () => {
  const now = Date.now();
  assert.deepEqual(canWithdraw({ kind: 'premium', createdAt: now + 10000 }, now), { allowed: false, reason: 'expired' });
});

test('Store-Käufe (RevenueCat): kein Widerruf über uns', () => {
  const now = Date.now();
  assert.deepEqual(canWithdraw({ kind: 'premium', provider: 'revenuecat', createdAt: now }, now), { allowed: false, reason: 'store_purchase' });
  assert.deepEqual(canWithdraw({ kind: 'coins', provider: 'revenuecat', createdAt: now }, now), { allowed: false, reason: 'store_purchase' });
});
