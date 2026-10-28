import test from 'node:test';
import assert from 'node:assert/strict';
import {
  baseProductId, isPremiumSubscriptionProduct, isYearlyPremium, findActivePremiumSubscription, PREMIUM_SUBSCRIPTION_PRODUCT_IDS,
} from './premiumProducts.js';

test('baseProductId schneidet den Basistarif ab', () => {
  assert.equal(baseProductId('hitlines_premium_monthly:monatlich'), 'hitlines_premium_monthly');
  assert.equal(baseProductId('hitlines_premium_yearly'), 'hitlines_premium_yearly');
  assert.equal(baseProductId(undefined), '');
  assert.equal(baseProductId(null), '');
});

test('isPremiumSubscriptionProduct erkennt iOS-ID und Android-ID mit Basistarif', () => {
  assert.equal(isPremiumSubscriptionProduct('hitlines_premium_monthly'), true);
  assert.equal(isPremiumSubscriptionProduct('hitlines_premium_monthly:monatlich'), true);
  assert.equal(isPremiumSubscriptionProduct('hitlines_premium_yearly:jaehrlich'), true);
});

test('isPremiumSubscriptionProduct lehnt Noten-Pakete und Unbekanntes ab', () => {
  for (const id of ['coins_40', 'coins_90_v2', 'hitlines_premium_monthly_extra', 'xhitlines_premium_monthly', '', undefined, null]) {
    assert.equal(isPremiumSubscriptionProduct(id), false, String(id));
  }
});

test('isYearlyPremium unterscheidet Jahres- und Monatsabo (mit und ohne Basistarif)', () => {
  assert.equal(isYearlyPremium('hitlines_premium_yearly:jaehrlich'), true);
  assert.equal(isYearlyPremium('hitlines_premium_yearly'), true);
  assert.equal(isYearlyPremium('hitlines_premium_monthly:monatlich'), false);
});

test('findActivePremiumSubscription: Schlüssel mit Basistarif, spätestes Ablaufdatum gewinnt', () => {
  const now = Date.UTC(2026, 9, 28);
  const subs = {
    'hitlines_premium_monthly:monatlich': { expires_date: '2026-11-28T10:00:00Z', store: 'play_store' },
    'hitlines_premium_yearly:jaehrlich': { expires_date: '2027-10-28T10:00:00Z', store: 'play_store' },
    'andere_sache': { expires_date: '2030-01-01T00:00:00Z' },
  };
  const best = findActivePremiumSubscription(subs, now);
  assert.equal(best.pid, 'hitlines_premium_yearly');
  assert.equal(best.exp, Date.parse('2027-10-28T10:00:00Z'));
});

test('findActivePremiumSubscription: Schlüssel ohne Basistarif (iOS) und abgelaufene Abos', () => {
  const now = Date.UTC(2026, 9, 28);
  assert.equal(findActivePremiumSubscription({ hitlines_premium_monthly: { expires_date: '2026-10-01T00:00:00Z' } }, now), null);
  const ok = findActivePremiumSubscription({ hitlines_premium_monthly: { expires_date: '2026-11-01T00:00:00Z' } }, now);
  assert.equal(ok.pid, 'hitlines_premium_monthly');
  assert.equal(findActivePremiumSubscription({}, now), null);
  assert.equal(findActivePremiumSubscription(undefined, now), null);
  assert.equal(findActivePremiumSubscription({ 'hitlines_premium_monthly:x': null }, now), null);
});

test('Produktliste entspricht den Store-Produkten', () => {
  assert.deepEqual(PREMIUM_SUBSCRIPTION_PRODUCT_IDS, ['hitlines_premium_monthly', 'hitlines_premium_yearly']);
});
