import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyStats, lastBerlinDays, SCORE_BUCKETS } from './adminDaily.js';

const NOW = new Date(Date.UTC(2026, 9, 28, 12, 0, 0)); // 2026-10-28 (Berlin ebenfalls der 28.)
const LAUNCH = { web: '2026-10-15', ios: '2026-10-15', android: '2026-10-28' };
const songs = (date) => Array.from({ length: 11 }, (_, i) => ({ title: `Song ${date.slice(8)}-${i}`, artist: 'A', year: 1970 + i }));
const entry = (score, correct, grid, name = 'Mia') => ({ name, score, correct, grid, at: 1 });

test('lastBerlinDays: älteste zuerst, heute zuletzt', () => {
  assert.deepEqual(lastBerlinDays(3, NOW), ['2026-10-26', '2026-10-27', '2026-10-28']);
});

test('leere Daten ergeben Nullen statt Fehler', () => {
  for (const input of [{}, { results: null, analytics: null, leagues: null }]) {
    const s = buildDailyStats({ ...input, songsForDate: songs, days: 7, now: NOW, launch: LAUNCH });
    assert.equal(s.series.length, 7);
    assert.equal(s.totals.playerDays, 0);
    assert.equal(s.totals.avgScore, 0);
    assert.equal(s.leagues.count, 0);
    assert.deepEqual(s.songs.hardest, []);
  }
});

const RESULTS = {
  '2026-10-27': { u1: entry(158, 10, '1111111111'), u2: entry(60, 5, '1010100101'), bad: { name: 'x' } },
  '2026-10-28': { u1: entry(120, 8, '1111011101'), u3: entry(0, 0, '0000000000') },
  '2026-10-10': { old: entry(100, 7, '1111111000') }, // außerhalb des Zeitraums
};

test('Summen, Durchschnitt und Wiederkehrer', () => {
  const s = buildDailyStats({ results: RESULTS, songsForDate: songs, days: 7, now: NOW, launch: LAUNCH });
  assert.equal(s.totals.playerDays, 4); // ungültiger Eintrag und alter Tag zählen nicht
  assert.equal(s.totals.uniquePlayers, 3);
  assert.equal(s.totals.returningPlayers, 1); // u1 an zwei Tagen
  assert.equal(s.totals.returningPct, 33);
  assert.equal(s.totals.avgScore, 84.5); // (158+60+120+0)/4
  assert.equal(s.totals.avgCorrect, 5.8); // (10+5+8+0)/4 = 5.75 → 5.8
  assert.equal(s.totals.bestScore, 158);
  assert.equal(s.totals.perfectRounds, 1);
  assert.deepEqual(s.series.at(-1), { date: '2026-10-28', players: 2, avgScore: 60 });
});

test('Verteilungen: richtige Antworten, Punkte, gespielte Tage', () => {
  const s = buildDailyStats({ results: RESULTS, songsForDate: songs, days: 7, now: NOW, launch: LAUNCH });
  assert.equal(s.distributions.correct.length, 11);
  assert.equal(s.distributions.correct[10], 1);
  assert.equal(s.distributions.correct[0], 1);
  assert.equal(s.distributions.score.length, SCORE_BUCKETS.length);
  assert.equal(s.distributions.score.reduce((a, b) => a + b.count, 0), 4);
  assert.deepEqual(s.distributions.daysPlayed, { '1': 2, '2': 1, '3–4': 0, '5+': 0 });
});

test('Schwerste und leichteste Songs nur mit genug Spielenden', () => {
  const results = { '2026-10-28': {} };
  for (let i = 0; i < 4; i++) results['2026-10-28'][`u${i}`] = entry(10, 1, i === 0 ? '1000000000' : '0000000000');
  const s = buildDailyStats({ results, songsForDate: songs, days: 1, now: NOW, launch: LAUNCH });
  // Zug 0 gehört zu songs[1]; 1 von 4 richtig = 25 %
  assert.equal(s.songs.hardest[0].correctPct, 0);
  const move0 = [...s.songs.hardest, ...s.songs.easiest].find((x) => x.title === 'Song 28-1');
  assert.equal(move0.correctPct, 25);
  assert.equal(move0.players, 4);
  const few = buildDailyStats({ results: { '2026-10-28': { a: entry(10, 1, '1000000000') } }, songsForDate: songs, days: 1, now: NOW, launch: LAUNCH });
  assert.deepEqual(few.songs.hardest, []); // nur 1 Spieler
});

test('Ereignis-Trichter zählt je Plattform erst ab dem Start', () => {
  const analytics = {
    daily_opened: { by_platform_date: { web: { '2026-10-27': 5, '2026-10-10': 99 }, android: { '2026-10-27': 4, '2026-10-28': 1 } } },
    daily_started: { by_platform_date: { web: { '2026-10-28': 3 } } },
  };
  const s = buildDailyStats({ analytics, songsForDate: songs, days: 7, now: NOW, launch: LAUNCH });
  assert.equal(s.funnel.counts.daily_opened, 6); // Web 5 + Android nur 28.10.: 1
  assert.equal(s.funnel.counts.daily_started, 3);
  assert.equal(s.funnel.counts.daily_completed, 0);
  assert.deepEqual(s.funnel.platform.daily_opened, { web: 5, ios: 0, android: 1 });
});

test('Ligen: Anzahl, Mitglieder und Größenverteilung ohne Namen', () => {
  const leagues = {
    AAAAAA: { name: 'Freunde', members: { a: { name: 'x' }, b: { name: 'y' } } },
    BBBBBB: { name: 'Solo', members: { a: { name: 'x' } } },
    CCCCCC: { name: 'Leer', members: {} },
  };
  const s = buildDailyStats({ leagues, songsForDate: songs, days: 1, now: NOW, launch: LAUNCH });
  assert.equal(s.leagues.count, 2); // leere Liga zählt nicht
  assert.equal(s.leagues.members, 3);
  assert.deepEqual(s.leagues.sizeDist, { '1': 1, '2–3': 1, '4–9': 0, '10+': 0 });
  assert.ok(!JSON.stringify(s).includes('Freunde'));
});

test('seit Start: Zeitraum beginnt am frühesten Plattformstart', () => {
  const s = buildDailyStats({ songsForDate: songs, days: 'start', now: NOW, launch: LAUNCH });
  assert.equal(s.range.mode, 'start');
  assert.equal(s.range.from, '2026-10-15');
  assert.equal(s.range.days, 14);
});
