import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUserStats, providerOf } from './adminUsers.js';

const NOW = new Date(Date.UTC(2026, 9, 28, 12, 0, 0));
const LAUNCH = { web: '2026-10-15', ios: '2026-10-15', android: '2026-10-28' };
const t = (iso, h = 10) => Date.parse(`${iso}T${String(h).padStart(2, '0')}:00:00Z`);

test('providerOf: bekannte Anbieter, sonst other', () => {
  assert.equal(providerOf(['google.com']), 'google');
  assert.equal(providerOf(['apple.com']), 'apple');
  assert.equal(providerOf(['password']), 'email');
  assert.equal(providerOf(['phone']), 'other');
  assert.equal(providerOf(undefined), 'other');
});

test('leere Eingabe ergibt Nullen statt Fehler', () => {
  for (const input of [null, undefined, []]) {
    const s = buildUserStats(input, { days: 7, now: NOW, launch: LAUNCH });
    assert.equal(s.totals.accountsAll, 0);
    assert.equal(s.series.length, 7);
    assert.equal(s.totals.active7dPct, 0);
  }
});

const USERS = [
  { createdAt: t('2026-09-01'), lastSignInAt: t('2026-10-27'), providers: ['password'] }, // Testkonto vor dem Start
  { createdAt: t('2026-10-14', 23), lastSignInAt: t('2026-10-14', 23), providers: ['google.com'] }, // Testkonto, einen Tag vor Start
  { createdAt: t('2026-10-15', 0), lastSignInAt: t('2026-10-20'), providers: ['google.com'] },
  { createdAt: t('2026-10-27'), lastSignInAt: t('2026-10-28', 8), providers: ['apple.com'] },
  { createdAt: t('2026-10-28'), lastSignInAt: t('2026-10-28', 9), providers: ['password'] },
  { createdAt: t('2026-10-28'), lastSignInAt: t('2026-10-28', 10), providers: ['password'] },
  { nope: true },
];

test('Konten seit Start getrennt von Testkonten davor', () => {
  const s = buildUserStats(USERS, { days: 'start', now: NOW, launch: LAUNCH });
  assert.equal(s.totals.accountsAll, 6); // ungültiger Eintrag zählt nicht
  assert.equal(s.totals.accountsSinceStart, 4);
  assert.equal(s.totals.testAccountsBefore, 2);
  assert.equal(s.range.from, '2026-10-15');
  assert.deepEqual(s.providers, { google: 1, apple: 1, email: 2, other: 0 });
});

test('Neuanmeldungen je Tag und aktive Konten', () => {
  const s = buildUserStats(USERS, { days: 'start', now: NOW, launch: LAUNCH });
  assert.equal(s.totals.newInRange, 4);
  assert.deepEqual(s.series[0], { date: '2026-10-15', newAccounts: 1 });
  assert.deepEqual(s.series.at(-1), { date: '2026-10-28', newAccounts: 2 });
  assert.equal(s.totals.active1d, 3); // zuletzt innerhalb der letzten 24 Stunden
  assert.equal(s.totals.active7d, 3); // die Anmeldung vom 20.10. liegt mehr als 7 Tage zurück
  assert.equal(s.totals.active30d, 4);
});

test('feste Zeiträume zählen nur Neuanmeldungen im Zeitraum', () => {
  const s = buildUserStats(USERS, { days: 2, now: NOW, launch: LAUNCH });
  assert.equal(s.totals.newInRange, 3);
  assert.equal(s.totals.accountsSinceStart, 4);
});
