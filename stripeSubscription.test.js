import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subscriptionPeriodEndMs } from './stripeSubscription.js';

test('altes Format: Feld direkt am Abo', () => {
  assert.equal(subscriptionPeriodEndMs({ current_period_end: 1800000000 }), 1800000000000);
});
test('neues Format: Feld an den Positionen, späteste gilt', () => {
  const sub = { items: { data: [{ current_period_end: 1800000000 }, { current_period_end: 1810000000 }] } };
  assert.equal(subscriptionPeriodEndMs(sub), 1810000000000);
});
test('beides vorhanden: direkter Wert gewinnt', () => {
  assert.equal(subscriptionPeriodEndMs({ current_period_end: 1800000000, items: { data: [{ current_period_end: 1 }] } }), 1800000000000);
});
test('nichts vorhanden oder ungültig: null', () => {
  assert.equal(subscriptionPeriodEndMs({}), null);
  assert.equal(subscriptionPeriodEndMs(null), null);
  assert.equal(subscriptionPeriodEndMs({ items: { data: [{}] } }), null);
});
