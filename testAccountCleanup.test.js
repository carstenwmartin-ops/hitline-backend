import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAccount, summarizePurchases, DEFAULT_CUTOFF_MS } from './testAccountCleanup.js';

const CUT = DEFAULT_CUTOFF_MS;
const before = '2026-10-10T10:00:00Z';
const after = '2026-10-16T10:00:00Z';
const base = { cutoffMs: CUT, adminEmail: 'admin@x.de', adminUid: 'admin' };
const anon = (over = {}) => ({ uid: 'a1', email: null, providerData: [], metadata: { creationTime: before, lastSignInTime: before }, ...over });

test('Zusammenfassung der Käufe: Sandbox, echt, Stripe vor/nach Stichtag', () => {
  const s = summarizePurchases({
    a: { provider: 'revenuecat', environment: 'SANDBOX' },
    b: { provider: 'revenuecat', environment: 'PRODUCTION' },
    c: { provider: 'stripe', createdAt: CUT - 1000 },
    d: { provider: 'stripe', createdAt: CUT + 1000 },
  }, CUT);
  assert.deepEqual(s, { sandbox: 1, production: 1, stripeTest: 1, stripeLive: 1, other: 0 });
});

test('anonymes Konto vor dem Stichtag, nur Sandbox, inaktiv: Kandidat', () => {
  const r = classifyAccount({ ...base, authUser: anon(), userData: { profile: { coins: 5 }, purchases: { x: { provider: 'revenuecat', environment: 'SANDBOX' } } } });
  assert.equal(r.category, 'anonymous');
  assert.equal(r.candidate, true);
  assert.deepEqual(r.protectedReasons, []);
});

test('echter Kauf schützt, auch vor dem Stichtag', () => {
  const r1 = classifyAccount({ ...base, authUser: anon(), userData: { purchases: { x: { provider: 'revenuecat', environment: 'PRODUCTION' } } } });
  assert.equal(r1.candidate, false);
  assert.ok(r1.protectedReasons.includes('production_purchase'));
  const r2 = classifyAccount({ ...base, authUser: anon(), userData: { purchases: { x: { provider: 'stripe', createdAt: CUT + 5 } } } });
  assert.ok(r2.protectedReasons.includes('live_stripe_purchase'));
  const r3 = classifyAccount({ ...base, authUser: anon(), userData: { profile: { premiumSubscription: { environment: 'PRODUCTION' } } } });
  assert.ok(r3.protectedReasons.includes('production_subscription'));
});

test('altes Stripe-Testkauf (vor dem Stichtag) schützt nicht', () => {
  const r = classifyAccount({ ...base, authUser: anon(), userData: { purchases: { x: { provider: 'stripe', createdAt: CUT - 5 } } } });
  assert.equal(r.candidate, true);
});

test('nach dem Stichtag angelegt: geschützt', () => {
  const r = classifyAccount({ ...base, authUser: anon({ metadata: { creationTime: after, lastSignInTime: after } }), userData: null });
  assert.ok(r.protectedReasons.includes('created_after_cutoff'));
  assert.equal(r.candidate, false);
});

test('nach dem Stichtag noch aktiv: nur mit includeActive', () => {
  const a = anon({ metadata: { creationTime: before, lastSignInTime: before, lastRefreshTime: after } });
  assert.equal(classifyAccount({ ...base, authUser: a, userData: null }).candidate, false);
  assert.equal(classifyAccount({ ...base, authUser: a, userData: null }).activeAfterCutoff, true);
  assert.equal(classifyAccount({ ...base, authUser: a, userData: null, includeActive: true }).candidate, true);
});

test('Admin und gewöhnliche Konten werden nie Kandidaten', () => {
  const admin = classifyAccount({ ...base, authUser: { uid: 'admin', email: 'admin@x.de', providerData: [{ providerId: 'google.com' }], metadata: { creationTime: before } }, userData: { profile: { testChannel: 'ios-testflight' } } });
  assert.equal(admin.candidate, false);
  assert.ok(admin.protectedReasons.includes('admin'));
  const regular = classifyAccount({ ...base, authUser: { uid: 'r', email: 'a@b.de', providerData: [{ providerId: 'google.com' }], metadata: { creationTime: before } }, userData: { profile: {} } });
  assert.equal(regular.category, 'regular');
  assert.equal(regular.candidate, false);
});

test('Tester-Markierung: Kandidat, Apple-Prüferkonto nur auf Wunsch', () => {
  const tester = classifyAccount({ ...base, authUser: { uid: 't', email: 't@x.de', providerData: [{ providerId: 'google.com' }], metadata: { creationTime: before } }, userData: { profile: { testChannel: 'ios-testflight' } } });
  assert.equal(tester.category, 'tester');
  assert.equal(tester.candidate, true);
  const apple = { uid: 'p', email: 'abc@privaterelay.appleid.com', providerData: [{ providerId: 'apple.com' }], metadata: { creationTime: before } };
  assert.equal(classifyAccount({ ...base, authUser: apple, userData: null }).candidate, false);
  assert.equal(classifyAccount({ ...base, authUser: apple, userData: null, includeAppleRelay: true }).candidate, true);
});
