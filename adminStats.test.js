import test from 'node:test';
import assert from 'node:assert/strict';
import { lastDays, buildGameStats } from './adminStats.js';

const NOW = new Date(Date.UTC(2026, 9, 28, 12, 0, 0)); // 2026-10-28

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
    assert.deepEqual(s.allTime.modes, []);
  }
});

const SAMPLE = {
  game_started: {
    total: 100,
    by_date: { '2026-10-28': 10, '2026-10-27': 6, '2026-10-01': 50, '2026-09-01': 34 },
    by_platform_date: { web: { '2026-10-28': 7, '2026-10-27': 6 }, ios: { '2026-10-28': 3 }, '2026-bogus': 'x' },
    by_mode: { classic: 60, race: 30, survival: 10 },
    by_play_location: { solo: 80, local_multiplayer: 15, remote_multiplayer: 5 },
    by_player_count: { 1: 80, 2: 20 },
    by_content_source: { genre: 70, theme: 30 },
    by_standalone_date: { '2026-10-28': 2 },
    by_is_first_timer_date: { yes: { '2026-10-28': 4 }, no: { '2026-10-28': 6 } },
    logged_in: { yes: 40, no: 60 },
  },
  game_completed: {
    total: 40,
    by_date: { '2026-10-28': 4, '2026-10-27': 3 },
    by_platform_date: { web: { '2026-10-28': 4, '2026-10-27': 3 } },
    by_mode: { classic: 30, race: 10 },
  },
  tutorial_completed: { by_date: { '2026-10-28': 3 } },
  game_config_chosen: { by_config: { schnelles_spiel: 12, beat_waehlt_aus: 4 } },
};

test('buildGameStats: Summen, Reihe und Quote im Zeitraum', () => {
  const s = buildGameStats(SAMPLE, { days: 7, now: NOW });
  assert.equal(s.totals.started, 16); // 28.10. + 27.10., ältere Tage liegen außerhalb
  assert.equal(s.totals.completed, 7);
  assert.equal(s.totals.abandoned, 9);
  assert.equal(s.totals.completionPct, 44);
  assert.equal(s.totals.newUsers, 4);
  assert.equal(s.totals.tutorialCompleted, 3);
  assert.equal(s.totals.installedWebApp, 2);
  assert.deepEqual(s.series[6], { date: '2026-10-28', started: 10, completed: 4 });
  assert.deepEqual(s.series[0], { date: '2026-10-22', started: 0, completed: 0 });
});

test('buildGameStats: Plattformen, Modi und Gesamtwerte', () => {
  const s = buildGameStats(SAMPLE, { days: 7, now: NOW });
  assert.deepEqual(s.platform.started, { web: 13, ios: 3, android: 0 });
  assert.deepEqual(s.platform.completed, { web: 7, ios: 0, android: 0 });
  assert.equal(s.allTime.started, 100);
  assert.equal(s.allTime.completed, 40);
  assert.deepEqual(s.allTime.modes[0], { mode: 'classic', started: 60, completed: 30, completionPct: 50 });
  assert.deepEqual(s.allTime.modes[1], { mode: 'race', started: 30, completed: 10, completionPct: 33 });
  assert.equal(s.allTime.modes[2].completed, 0); // Modus nur bei Starts bekannt
  assert.equal(s.allTime.playLocation.remote_multiplayer, 5);
  assert.deepEqual(s.allTime.gameConfig, { schnelles_spiel: 12, beat_waehlt_aus: 4 });
});

test('buildGameStats: Quote wird nie über 100 % ausgewiesen, Abbrüche nie negativ', () => {
  const s = buildGameStats({
    game_started: { by_date: { '2026-10-28': 2 } },
    game_completed: { by_date: { '2026-10-28': 5 } },
  }, { days: 1, now: NOW });
  assert.equal(s.totals.completionPct, 100);
  assert.equal(s.totals.abandoned, 0);
});

test('buildGameStats: Gesamtwert fällt ohne "total" auf die Summe der Tage zurück', () => {
  const s = buildGameStats({ game_started: { by_date: { '2026-10-28': 3, '2026-10-27': 4 } } }, { days: 1, now: NOW });
  assert.equal(s.allTime.started, 7);
});
