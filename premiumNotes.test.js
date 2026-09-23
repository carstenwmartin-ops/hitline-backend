import { test } from 'node:test';
import assert from 'node:assert/strict';
import { berlinMonthKey, isEligibleForMonthlyNotes, PREMIUM_MONTHLY_NOTES } from './premiumNotes.js';

test('Monatsschlüssel folgt der Zeit in Europe/Berlin', () => {
  // 30.09.2026 23:30 UTC = 01.10.2026 01:30 in Berlin (Sommerzeit, UTC+2) -> schon Oktober
  assert.equal(berlinMonthKey(Date.UTC(2026, 8, 30, 23, 30)), '2026-10');
  // 30.09.2026 21:30 UTC = 30.09.2026 23:30 in Berlin -> noch September
  assert.equal(berlinMonthKey(Date.UTC(2026, 8, 30, 21, 30)), '2026-09');
  // Winterzeit (UTC+1): 31.12.2026 23:30 UTC = 01.01.2027 00:30 in Berlin
  assert.equal(berlinMonthKey(Date.UTC(2026, 11, 31, 23, 30)), '2027-01');
});

test('Gutschrift beträgt 10 Noten', () => {
  assert.equal(PREMIUM_MONTHLY_NOTES, 10);
});

test('aktive Stripe- und RevenueCat-Abos sind berechtigt', () => {
  const now = Date.UTC(2026, 9, 5);
  assert.equal(isEligibleForMonthlyNotes({ status: 'active', provider: 'stripe', currentPeriodEnd: now + 86400000 }, now), true);
  assert.equal(isEligibleForMonthlyNotes({ status: 'active', provider: 'revenuecat', currentPeriodEnd: now + 86400000 }, now), true);
});

test('fehlendes currentPeriodEnd bei aktivem Abo reicht', () => {
  assert.equal(isEligibleForMonthlyNotes({ status: 'active', provider: 'stripe' }, Date.now()), true);
  assert.equal(isEligibleForMonthlyNotes({ status: 'active', provider: 'stripe', currentPeriodEnd: null }, Date.now()), true);
});

test('abgelaufene oder gekündigte Abos sind nicht berechtigt', () => {
  const now = Date.UTC(2026, 9, 5);
  assert.equal(isEligibleForMonthlyNotes({ status: 'canceled', provider: 'stripe', currentPeriodEnd: now + 86400000 }, now), false);
  assert.equal(isEligibleForMonthlyNotes({ status: 'past_due', provider: 'stripe' }, now), false);
  assert.equal(isEligibleForMonthlyNotes({ status: 'active', provider: 'stripe', currentPeriodEnd: now - 1 }, now), false);
});

test('unbekannter Anbieter und fehlendes Abo sind nicht berechtigt', () => {
  assert.equal(isEligibleForMonthlyNotes({ status: 'active', provider: 'other' }), false);
  assert.equal(isEligibleForMonthlyNotes(null), false);
  assert.equal(isEligibleForMonthlyNotes(undefined), false);
  assert.equal(isEligibleForMonthlyNotes('active'), false);
});
