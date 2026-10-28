import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPremiumStats, channelOf, planOfSubscription } from './adminPremium.js';

const NOW = new Date(Date.UTC(2026, 9, 28, 12, 0, 0));
const LAUNCH = { web: '2026-10-15', ios: '2026-10-15', android: '2026-10-28' };
const t = (iso) => Date.parse(`${iso}T10:00:00Z`);
const isYearlyProduct = (id) => String(id).includes('yearly');

test('channelOf: Stripe = web, Stores = ios/android, sonst unbekannt', () => {
  assert.equal(channelOf('stripe', null), 'web');
  assert.equal(channelOf('revenuecat', 'APP_STORE'), 'ios');
  assert.equal(channelOf('revenuecat', 'PLAY_STORE'), 'android');
  assert.equal(channelOf('revenuecat', 'AMAZON'), null);
});

test('planOfSubscription: Store über Produkt-ID, Stripe über Preis-ID', () => {
  assert.equal(planOfSubscription({ provider: 'revenuecat', priceId: 'hitlines_premium_yearly' }, { isYearlyProduct }), 'yearly');
  assert.equal(planOfSubscription({ provider: 'revenuecat', priceId: 'hitlines_premium_monthly:monatlich' }, { isYearlyProduct }), 'monthly');
  assert.equal(planOfSubscription({ provider: 'stripe', priceId: 'price_y' }, { stripeYearlyPriceId: 'price_y' }), 'yearly');
  assert.equal(planOfSubscription({ provider: 'stripe', priceId: 'price_m' }, { stripeYearlyPriceId: 'price_y' }), 'monthly');
  assert.equal(planOfSubscription({ provider: 'stripe', priceId: 'price_m' }, {}), 'unknown');
});

test('leere Daten ergeben Nullen statt Fehler', () => {
  for (const input of [null, undefined, {}]) {
    const s = buildPremiumStats(input, { days: 7, now: NOW, launch: LAUNCH });
    assert.equal(s.accounts.total, 0);
    assert.equal(s.subscriptions.active, 0);
    assert.equal(s.purchases.count, 0);
    assert.equal(s.series.length, 7);
  }
});

const USERS = {
  a: { profile: { premiumSubscription: { status: 'active', provider: 'revenuecat', store: 'APP_STORE', priceId: 'hitlines_premium_monthly', currentPeriodEnd: t('2026-11-20'), willRenew: true, environment: 'PRODUCTION' } },
    purchases: { p1: { kind: 'premium', plan: 'monthly', amount: 499, currency: 'eur', createdAt: t('2026-10-20'), provider: 'revenuecat', store: 'APP_STORE', environment: 'PRODUCTION' } } },
  b: { profile: { premiumSubscription: { status: 'active', provider: 'stripe', priceId: 'price_y', currentPeriodEnd: t('2027-10-01'), willRenew: false } },
    purchases: {
      p2: { id: 'cs_live_p2', kind: 'premium', plan: 'yearly', amount: 4999, currency: 'eur', createdAt: t('2026-10-27'), provider: 'stripe' },
      p3: { id: 'cs_live_p3', kind: 'coins', packageId: 'coins_40', coins: 40, amount: 299, currency: 'eur', createdAt: t('2026-10-28'), provider: 'stripe' },
    } },
  c: { profile: { premiumSubscription: { status: 'active', provider: 'revenuecat', store: 'APP_STORE', environment: 'SANDBOX', currentPeriodEnd: t('2026-11-20') } },
    purchases: { p4: { kind: 'coins', coins: 90, amount: 599, currency: 'eur', createdAt: t('2026-10-20'), provider: 'revenuecat', store: 'APP_STORE', environment: 'SANDBOX' } } },
  d: { profile: { appleMusicComplimentary: true, premiumSubscription: { status: 'canceled', provider: 'stripe' } },
    purchases: {
      p5: { id: 'cs_live_p5', kind: 'coins', coins: 40, amount: 299, currency: 'eur', createdAt: t('2026-10-10'), provider: 'stripe' }, // vor Start
      p6: { id: 'cs_live_p6', kind: 'coins', coins: 40, amount: 299, currency: 'eur', createdAt: t('2026-10-22'), provider: 'stripe', withdrawnAt: 1 },
      p7: { kind: 'coins', coins: 40, amount: 299, currency: 'eur', createdAt: t('2026-10-22'), provider: 'revenuecat', store: 'PLAY_STORE' }, // vor Android-Start
      p8: { kind: 'coins', coins: 150, amount: 899, currency: 'eur', createdAt: t('2026-10-28'), provider: 'revenuecat', store: 'PLAY_STORE', refundedAt: 5 },
      p9: { kind: 'coins', coins: 220, amount: 1299, currency: 'eur', createdAt: t('2026-10-28'), provider: 'revenuecat', store: 'PLAY_STORE' },
    } },
  e: { profile: {} },
  bogus: 'x',
};

test('Abos: aktive nach Kanal und Tarif, Sandbox und beendete getrennt', () => {
  const s = buildPremiumStats(USERS, { days: 'start', now: NOW, launch: LAUNCH, isYearlyProduct, stripeYearlyPriceId: 'price_y' });
  assert.equal(s.accounts.total, 5); // ungültiger Eintrag zählt nicht
  assert.equal(s.subscriptions.active, 2); // a (iOS) und b (Web); c ist Sandbox
  assert.equal(s.subscriptions.sandboxIgnored, 1);
  assert.equal(s.subscriptions.expiring, 1); // b läuft aus
  assert.equal(s.subscriptions.canceled, 0); // Konto d: beendetes Stripe-Abo ohne Live-Kauf gilt als Test
  assert.equal(s.subscriptions.stripeTestIgnored, 1);
  assert.equal(s.subscriptions.complimentary, 1);
  assert.deepEqual(s.subscriptions.byChannel, { web: 1, ios: 1, android: 0 });
  assert.deepEqual(s.subscriptions.byPlan, { monthly: 1, yearly: 1, unknown: 0 });
  assert.equal(s.accounts.premiumPct, 40);
});

test('Käufe: Sandbox, vor Start, widerrufen und erstattet zählen nicht', () => {
  const s = buildPremiumStats(USERS, { days: 'start', now: NOW, launch: LAUNCH, isYearlyProduct, stripeYearlyPriceId: 'price_y' });
  // gezählt: p1 (iOS 499), p2 (Web 4999), p3 (Web 299), p9 (Android 1299)
  assert.equal(s.purchases.count, 4);
  assert.deepEqual(s.purchases.byChannel, { web: 2, ios: 1, android: 1 });
  assert.deepEqual(s.purchases.byKind, { coins: 2, premium: 2 });
  assert.equal(s.purchases.revenue.eur, 499 + 4999 + 299 + 1299);
  assert.equal(s.purchases.revenueByChannel.web.eur, 5298);
  assert.equal(s.purchases.coinsSold, 40 + 220);
  assert.deepEqual(s.excluded, { sandbox: 1, markedTest: 0, stripeTest: 0, beforeLaunch: 2, withdrawn: 1, refunded: 1, unknownChannel: 0 });
  assert.equal(s.purchases.buyers, 3);
});

test('Reihe und Zeitraum: nur Käufe im Zeitraum, Summen je Tag', () => {
  const s = buildPremiumStats(USERS, { days: 2, now: NOW, launch: LAUNCH });
  assert.equal(s.series.length, 2);
  assert.equal(s.purchases.count, 3); // 27.10. und 28.10.: p2, p3, p9
  assert.deepEqual(s.series[1].revenue, { eur: 299 + 1299 });
  assert.equal(s.series[1].purchases, 2);
});

test('Ausgabe enthält keine Kaufnummern, Konto-IDs oder E-Mail-Adressen', () => {
  const users = { uid123: { profile: {}, purchases: { 'GPA_1234': { kind: 'coins', coins: 40, amount: 299, currency: 'eur', createdAt: t('2026-10-28'), provider: 'stripe', customerEmail: 'x@example.com' } } } };
  const json = JSON.stringify(buildPremiumStats(users, { days: 'start', now: NOW, launch: LAUNCH }));
  for (const secret of ['uid123', 'GPA_1234', 'x@example.com']) assert.ok(!json.includes(secret), secret);
});

test('Stripe: Kaufnummer cs_test_ ist Testmodus, cs_live_ ist echt', () => {
  const mk = (id) => ({ id, kind: 'coins', coins: 40, amount: 299, currency: 'eur', createdAt: t('2026-10-28'), provider: 'stripe' });
  const users = { a: { purchases: { x: mk('cs_test_abc'), y: mk('cs_live_def'), z: mk(undefined) } } };
  const s = buildPremiumStats(users, { days: 'start', now: NOW, launch: LAUNCH });
  assert.equal(s.purchases.count, 1); // nur cs_live_
  assert.equal(s.excluded.stripeTest, 2); // cs_test_ und ohne Nummer
  assert.equal(s.purchases.revenue.eur, 299);
});

test('Stripe-Abo zählt nur mit Abo-Kauf im Live-Modus', () => {
  const sub = { status: 'active', provider: 'stripe', priceId: 'price_m', currentPeriodEnd: t('2026-11-20') };
  const users = {
    live: { profile: { premiumSubscription: sub }, purchases: { a: { id: 'cs_live_1', kind: 'premium', provider: 'stripe', createdAt: t('2026-10-20') } } },
    test: { profile: { premiumSubscription: sub }, purchases: { b: { id: 'cs_test_1', kind: 'premium', provider: 'stripe', createdAt: t('2026-10-20') } } },
    none: { profile: { premiumSubscription: sub } },
  };
  const s = buildPremiumStats(users, { days: 'start', now: NOW, launch: LAUNCH, stripeYearlyPriceId: 'price_y' });
  assert.equal(s.subscriptions.active, 1);
  assert.equal(s.subscriptions.stripeTestIgnored, 2);
  assert.deepEqual(s.subscriptions.byChannel, { web: 1, ios: 0, android: 0 });
});

test('Einzelkauf mit isTest: true zählt nicht', () => {
  const users = { a: { purchases: { x: { kind: 'coins', coins: 40, amount: 299, currency: 'eur', createdAt: t('2026-10-28'), provider: 'revenuecat', store: 'APP_STORE', environment: 'PRODUCTION', isTest: true } } } };
  const s = buildPremiumStats(users, { days: 'start', now: NOW, launch: LAUNCH });
  assert.equal(s.purchases.count, 0);
  assert.equal(s.excluded.markedTest, 1);
});
