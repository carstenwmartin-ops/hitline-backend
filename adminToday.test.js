import test from 'node:test';
import assert from 'node:assert/strict';
import { berlinHour, berlinDayStart, buildTodayStats } from './adminToday.js';

// 2026-10-28 14:30 Berlin (Winterzeit, UTC+1) = 13:30 UTC
const NOW = new Date(Date.UTC(2026, 9, 28, 13, 30, 0));
const LAUNCH = { web: '2026-10-15', ios: '2026-10-15', android: '2026-10-28' };
const berlin = (iso, h, m = 0) => Date.UTC(...iso.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))), h - 1, m); // Winterzeit: Berlin = UTC+1

test('berlinHour: Winter- und Sommerzeit', () => {
  assert.equal(berlinHour(Date.UTC(2026, 9, 28, 13, 30)), 14);
  assert.equal(berlinHour(Date.UTC(2026, 6, 1, 12, 0)), 14);
  assert.equal(berlinHour(Date.UTC(2026, 9, 27, 23, 30)), 0);
});

test('berlinDayStart: Beginn des Berliner Tages, auch am Tag der Zeitumstellung', () => {
  assert.equal(berlinDayStart('2026-10-28'), Date.UTC(2026, 9, 27, 23, 0)); // Winterzeit
  assert.equal(berlinDayStart('2026-07-01'), Date.UTC(2026, 5, 30, 22, 0)); // Sommerzeit
  assert.equal(berlinDayStart('2026-10-25'), Date.UTC(2026, 9, 24, 22, 0)); // Umstellungstag beginnt noch in Sommerzeit
});

test('leere Daten ergeben Nullen und 24 Stundenwerte', () => {
  const s = buildTodayStats({ now: NOW, launch: LAUNCH });
  assert.equal(s.meta.date, '2026-10-28');
  assert.equal(s.meta.nowHour, 14);
  assert.equal(s.meta.compareDate, '2026-10-27');
  assert.equal(s.daily.players, 0);
  assert.equal(s.daily.hourly.length, 24);
  assert.equal(s.purchases.count, 0);
  assert.equal(s.accounts.newToday, 0);
  assert.equal(s.games.hourly, null);
});

test('Daily: nur Ergebnisse von heute bis jetzt, Vergleich mit gestern bis zur gleichen Uhrzeit', () => {
  const dailyResults = {
    '2026-10-28': {
      a: { score: 100, at: berlin('2026-10-28', 0, 30) },
      b: { score: 60, at: berlin('2026-10-28', 13, 0) },
      c: { score: 999, at: berlin('2026-10-28', 15, 0) }, // liegt nach "jetzt"
    },
    '2026-10-27': {
      d: { score: 50, at: berlin('2026-10-27', 10, 0) }, // bis jetzt (14:30) gestern
      e: { score: 70, at: berlin('2026-10-27', 20, 0) }, // gestern später
    },
  };
  const s = buildTodayStats({ now: NOW, launch: LAUNCH, dailyResults });
  assert.equal(s.daily.players, 2);
  assert.equal(s.daily.avgScore, 80);
  assert.equal(s.daily.bestScore, 100);
  assert.equal(s.daily.hourly[0], 1);
  assert.equal(s.daily.hourly[13], 1);
  assert.equal(s.daily.hourly[15], 0);
  assert.equal(s.daily.yesterdayUntilNow, 1);
  assert.equal(s.daily.yesterdayFull, 2);
});

test('Käufe: gleiche Regeln wie die Premium-Seite, nur heute bis jetzt', () => {
  const mk = (extra) => ({ kind: 'coins', amount: 299, currency: 'eur', provider: 'stripe', ...extra });
  const users = {
    u1: { purchases: {
      p1: mk({ id: 'cs_live_p1', createdAt: berlin('2026-10-28', 9, 0) }),
      p2: mk({ createdAt: berlin('2026-10-28', 9, 5), environment: 'SANDBOX' }),
      p3: mk({ id: 'cs_live_p3', createdAt: berlin('2026-10-28', 9, 10), withdrawnAt: 1 }),
      p4: mk({ createdAt: berlin('2026-10-28', 10, 0), provider: 'revenuecat', store: 'APP_STORE', amount: 499 }),
      p5: mk({ id: 'cs_live_p5', createdAt: berlin('2026-10-27', 9, 0) }), // gestern bis jetzt
      p6: mk({ id: 'cs_live_p6', createdAt: berlin('2026-10-27', 22, 0) }), // gestern später
    } },
  };
  const s = buildTodayStats({ now: NOW, launch: LAUNCH, users });
  assert.equal(s.purchases.count, 2);
  assert.deepEqual(s.purchases.byChannel, { web: 1, ios: 1, android: 0 });
  assert.equal(s.purchases.revenue.eur, 299 + 499);
  assert.equal(s.purchases.hourly[9], 1);
  assert.equal(s.purchases.hourly[10], 1);
  assert.equal(s.purchases.yesterdayUntilNow, 1);
  assert.equal(s.purchases.yesterdayRevenueUntilNow.eur, 299);
});

test('Neue Konten: Testkonten vor dem Start zählen nicht', () => {
  const authUsers = [
    { createdAt: berlin('2026-10-28', 8, 0) }, { createdAt: berlin('2026-10-28', 8, 30) },
    { createdAt: berlin('2026-10-27', 9, 0) }, { createdAt: Date.UTC(2026, 8, 1) },
  ];
  const s = buildTodayStats({ now: NOW, launch: LAUNCH, authUsers });
  assert.equal(s.accounts.newToday, 2);
  assert.equal(s.accounts.hourly[8], 2);
  assert.equal(s.accounts.yesterdayUntilNow, 1);
});

test('Spiele: Tageswert nach UTC-Tag mit Hinweis auf den Beginn, Stundenwerte aus by_hour', () => {
  const analytics = {
    game_started: {
      by_platform_date: { web: { '2026-10-28': 7, '2026-10-27': 20 }, ios: { '2026-10-28': 3 } },
      by_hour: { '2026-10-27': { 23: 3 }, '2026-10-28': { 12: 5, 13: 2 } },
    },
    game_completed: { by_platform_date: { web: { '2026-10-28': 4 } } },
  };
  const s = buildTodayStats({ now: NOW, launch: LAUNCH, analytics });
  assert.equal(s.games.started, 10);
  assert.equal(s.games.completed, 4);
  assert.deepEqual(s.games.platform.started, { web: 7, ios: 3, android: 0 });
  assert.equal(s.games.yesterdayFull.started, 20);
  assert.equal(s.games.countedSinceHour, 1); // UTC-Mitternacht = 1 Uhr deutscher Zeit (Winterzeit)
  assert.equal(s.games.hourly.started[0], 3); // 23:30 UTC = 0:30 Berlin
  assert.equal(s.games.hourly.started[13], 5);
  assert.equal(s.games.hourly.started[14], 2);
  assert.deepEqual(s.games.hourly.completed, Array(24).fill(0));
});

test('Ausgabe enthält keine Konto-IDs, Namen oder E-Mail-Adressen', () => {
  const users = { uid123: { purchases: { GPA1: { kind: 'coins', amount: 299, currency: 'eur', provider: 'stripe', createdAt: berlin('2026-10-28', 9, 0), customerEmail: 'x@example.com' } } } };
  const dailyResults = { '2026-10-28': { uid123: { name: 'Mia', score: 10, at: berlin('2026-10-28', 9, 0) } } };
  const json = JSON.stringify(buildTodayStats({ now: NOW, launch: LAUNCH, users, dailyResults }));
  for (const secret of ['uid123', 'GPA1', 'x@example.com', 'Mia']) assert.ok(!json.includes(secret), secret);
});

test('Heute: Stripe-Käufe im Testmodus (cs_test_) zählen nicht', () => {
  const mk = (id) => ({ id, kind: 'coins', amount: 299, currency: 'eur', provider: 'stripe', createdAt: berlin('2026-10-28', 9, 0) });
  const users = { u: { purchases: { a: mk('cs_test_1'), b: mk('cs_live_2') } } };
  assert.equal(buildTodayStats({ now: NOW, launch: LAUNCH, users }).purchases.count, 1);
});
