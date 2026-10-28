import test from 'node:test';
import assert from 'node:assert/strict';
import { lastDays, buildGameStats, LAUNCH_DATES } from './adminStats.js';

const NOW = new Date(Date.UTC(2026, 9, 28, 12, 0, 0)); // 2026-10-28

test('Starttage: Web und iOS 15.10., Android 28.10.', () => {
  assert.deepEqual(LAUNCH_DATES, { web: '2026-10-15', ios: '2026-10-15', android: '2026-10-28' });
});

test('lastDays: älteste zuerst, inklusive heute, über Monatsgrenze', () => {
  assert.deepEqual(lastDays(3, NOW), ['2026-10-26', '2026-10-27', '2026-10-28']);
  assert.deepEqual(lastDays(2, new Date(Date.UTC(2026, 10, 1))), ['2026-10-31', '2026-11-01']);
});

test('buildGameStats: leere oder fehlende Daten ergeben Nullen statt Fehler', () => {
  for (const input of [null, undefined, {}]) {
    const s = buildGameStats(input, { days: 7, now: NOW });
    assert.equal(s.series.length, 7);
    assert.equal(s.totals.started, 0);
    assert.equal(s.totals.completionPct, 0);
    assert.deepEqual(s.platform.started, { web: 0, ios: 0, android: 0 });
    assert.deepEqual(s.includesTests.modes, []);
    assert.equal(s.sinceLaunch.started, 0);
  }
});

const LAUNCH = { web: '2026-10-15', ios: '2026-10-15', android: '2026-10-28' };

const SAMPLE = {
  game_started: {
    total: 200,
    by_date: { '2026-10-28': 12 },
    by_platform_date: {
      web: { '2026-10-10': 40, '2026-10-14': 30, '2026-10-15': 5, '2026-10-27': 6, '2026-10-28': 7 },
      ios: { '2026-10-12': 20, '2026-10-15': 4, '2026-10-28': 3 },
      android: { '2026-10-20': 9, '2026-10-27': 8, '2026-10-28': 2 },
      '2026-bogus': { '2026-10-28': 99 },
    },
    by_mode: { classic: 60, race: 30, survival: 10 },
    by_play_location: { solo: 80, local_multiplayer: 15, remote_multiplayer: 5 },
    by_player_count: { 1: 80, 2: 20 },
    by_content_source: { genre: 70, theme: 30 },
    by_standalone_date: { '2026-10-10': 4, '2026-10-28': 2 },
    by_is_first_timer_date: { yes: { '2026-10-14': 8, '2026-10-15': 3, '2026-10-28': 4 }, no: { '2026-10-28': 6 } },
    logged_in: { yes: 40, no: 60 },
  },
  game_completed: {
    total: 40,
    by_platform_date: {
      web: { '2026-10-14': 10, '2026-10-27': 3, '2026-10-28': 4 },
      ios: { '2026-10-28': 1 },
      android: { '2026-10-27': 5, '2026-10-28': 1 },
    },
    by_mode: { classic: 30, race: 10 },
  },
  tutorial_completed: { by_platform_date: { web: { '2026-10-14': 5, '2026-10-28': 2 }, android: { '2026-10-20': 4, '2026-10-28': 1 } } },
  game_config_chosen: { by_config: { schnelles_spiel: 12, beat_waehlt_aus: 4 } },
};

test('Abgrenzung: Aufrufe vor dem Start der Plattform zählen nicht (Zeitreihe und Summen)', () => {
  const s = buildGameStats(SAMPLE, { days: 'start', now: NOW, launch: LAUNCH });
  // Web ab 15.10.: 5+6+7=18, iOS ab 15.10.: 4+3=7, Android ab 28.10.: 2 (20.10. und 27.10. sind Tests)
  assert.equal(s.totals.started, 27);
  // Abschlüsse: Web 3+4=7 (14.10. zählt nicht), iOS 1, Android nur 28.10.: 1
  assert.equal(s.totals.completed, 9);
  assert.deepEqual(s.platform.started, { web: 18, ios: 7, android: 2 });
  assert.deepEqual(s.platform.completed, { web: 7, ios: 1, android: 1 });
  assert.equal(s.sinceLaunch.started, 27);
  assert.equal(s.sinceLaunch.completed, 9);
});

test('Abgrenzung: "seit Start" beginnt am frühesten Starttag und endet heute', () => {
  const s = buildGameStats(SAMPLE, { days: 'start', now: NOW, launch: LAUNCH });
  assert.equal(s.range.mode, 'start');
  assert.equal(s.range.from, '2026-10-15');
  assert.equal(s.range.to, '2026-10-28');
  assert.equal(s.range.days, 14);
  assert.equal(s.series[0].date, '2026-10-15');
  assert.deepEqual(s.series[0], { date: '2026-10-15', started: 9, completed: 0 });
  assert.deepEqual(s.series[13], { date: '2026-10-28', started: 12, completed: 6 });
});

test('Abgrenzung: feste Zeiträume vor dem Start enthalten nur Nullen', () => {
  const s = buildGameStats(SAMPLE, { days: 30, now: NOW, launch: LAUNCH });
  assert.equal(s.series.length, 30);
  assert.deepEqual(s.series[0], { date: '2026-09-29', started: 0, completed: 0 });
  assert.equal(s.series.find((r) => r.date === '2026-10-14').started, 0);
  assert.equal(s.totals.started, 27);
});

test('Abgrenzung: neue Nutzer ab frühestem Start, Demo und Web-App je Plattform', () => {
  const s = buildGameStats(SAMPLE, { days: 'start', now: NOW, launch: LAUNCH });
  assert.equal(s.totals.newUsers, 7); // 3 + 4, die 8 vom 14.10. zählen nicht
  assert.equal(s.totals.tutorialCompleted, 3); // Web 28.10.: 2 + Android 28.10.: 1
  assert.equal(s.totals.installedWebApp, 2); // 10.10. liegt vor dem Web-Start
});

test('Quote wird nie über 100 % ausgewiesen, Abbrüche nie negativ', () => {
  const s = buildGameStats({
    game_started: { by_platform_date: { web: { '2026-10-28': 2 } } },
    game_completed: { by_platform_date: { web: { '2026-10-28': 5 } } },
  }, { days: 1, now: NOW, launch: LAUNCH });
  assert.equal(s.totals.completionPct, 100);
  assert.equal(s.totals.abandoned, 0);
});

test('Aufschlüsselungen ohne Datum stehen unter includesTests', () => {
  const s = buildGameStats(SAMPLE, { days: 7, now: NOW, launch: LAUNCH });
  assert.equal(s.includesTests.started, 200);
  assert.equal(s.includesTests.completed, 40);
  assert.deepEqual(s.includesTests.modes[0], { mode: 'classic', started: 60, completed: 30, completionPct: 50 });
  assert.deepEqual(s.includesTests.modes[1], { mode: 'race', started: 30, completed: 10, completionPct: 33 });
  assert.equal(s.includesTests.modes[2].completed, 0);
  assert.equal(s.includesTests.playLocation.remote_multiplayer, 5);
  assert.deepEqual(s.includesTests.gameConfig, { schnelles_spiel: 12, beat_waehlt_aus: 4 });
});

test('Gesamtwert fällt ohne "total" auf die Summe der Tage zurück', () => {
  const s = buildGameStats({ game_started: { by_date: { '2026-10-28': 3, '2026-10-27': 4 } } }, { days: 1, now: NOW });
  assert.equal(s.includesTests.started, 7);
});
