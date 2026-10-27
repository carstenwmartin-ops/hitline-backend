import test from 'node:test';
import assert from 'node:assert/strict';
import {
  berlinDateKey, addDays, weekKeyOf, daysOfWeek, previousWeekKey, previousMonthKey, scorePlacements,
  bestOfDays, rankEntries, rewardFor, nextStreak, cleanDisplayName,
} from './dailyCore.js';
import { DAILY_HITS, pickDailySongs, DAILY_SONG_COUNT } from './dailyHits.js';

test('berlinDateKey: Tageswechsel um Mitternacht deutscher Zeit', () => {
  // 2026-10-27 22:30 UTC = 23:30 MEZ (Sommerzeit endet 25.10.) → noch der 27.
  assert.equal(berlinDateKey(Date.UTC(2026, 9, 27, 22, 30)), '2026-10-27');
  assert.equal(berlinDateKey(Date.UTC(2026, 9, 27, 23, 30)), '2026-10-28');
});

test('addDays und Wochenschlüssel (ISO)', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(weekKeyOf('2026-01-01'), '2026-W01'); // Donnerstag
  assert.equal(weekKeyOf('2024-12-30'), '2025-W01'); // Montag der KW 1/2025
  assert.equal(weekKeyOf('2026-10-27'), '2026-W44');
  assert.equal(previousWeekKey('2026-10-27'), '2026-W43');
});

test('daysOfWeek liefert Montag bis Sonntag', () => {
  const days = daysOfWeek('2026-W44');
  assert.equal(days.length, 7);
  assert.equal(days[0], '2026-10-26');
  assert.equal(days[6], '2026-11-01');
  days.forEach((d) => assert.equal(weekKeyOf(d), '2026-W44'));
});

test('previousMonthKey', () => {
  assert.equal(previousMonthKey('2026-01-15'), '2025-12');
  assert.equal(previousMonthKey('2026-10-27'), '2026-09');
});

const songs = [1980, 1970, 1990, 1960, 2000].map((year, i) => ({ artist: `A${i}`, title: `T${i}`, year }));

test('scorePlacements: alles richtig gibt Serien-Bonus', () => {
  // Zeitleiste [1980]; 1970 → Pos 0; [1970,1980]; 1990 → Pos 2; [1970,1980,1990]; 1960 → Pos 0; 2000 → Pos 4
  const r = scorePlacements(songs, [0, 2, 0, 4]);
  assert.equal(r.correct, 4);
  assert.equal(r.grid, '1111');
  assert.equal(r.score, 10 + 12 + 14 + 16);
});

test('scorePlacements: Fehler setzt die Serie zurück, Karte wandert an die richtige Stelle', () => {
  // 1970 falsch nach rechts (Pos 1), danach ist [1970,1980]; 1990 → Pos 2 richtig
  const r = scorePlacements(songs, [1, 2, 0, 4]);
  assert.equal(r.grid, '0111');
  assert.equal(r.score, 10 + 12 + 14);
});

test('scorePlacements: ungültige Eingaben ergeben null', () => {
  assert.equal(scorePlacements(songs, [0, 2, 0]), null);       // falsche Länge
  assert.equal(scorePlacements(songs, [0, 9, 0, 4]), null);    // Position außerhalb
  assert.equal(scorePlacements(songs, [0, 'x', 0, 4]), null);  // kein Integer
  assert.equal(scorePlacements(songs, [0, -1, 0, 4]), null);
});

test('bestOfDays nimmt die besten n Tage', () => {
  assert.equal(bestOfDays({ a: 50, b: 90, c: 70, d: 10 }, 2), 160);
  assert.equal(bestOfDays({}, 5), 0);
});

test('rankEntries: Punkte absteigend, Gleichstand nach früherer Zeit', () => {
  const r = rankEntries([{ uid: 'a', score: 80, at: 5 }, { uid: 'b', score: 90, at: 9 }, { uid: 'c', score: 80, at: 2 }]);
  assert.deepEqual(r.map((e) => e.uid), ['b', 'c', 'a']);
  assert.deepEqual(r.map((e) => e.rank), [1, 2, 3]);
});

test('rewardFor: kleine Beträge, nur Plätze 1 bis 3', () => {
  assert.equal(rewardFor('day', 1), 2);
  assert.equal(rewardFor('month', 3), 4);
  assert.equal(rewardFor('day', 4), 0);
  assert.equal(rewardFor('unbekannt', 1), 0);
});

test('nextStreak', () => {
  const first = nextStreak(null, '2026-10-27');
  assert.deepEqual(first, { last: '2026-10-27', current: 1, best: 1, played: 1 });
  assert.equal(nextStreak(first, '2026-10-27'), first);
  assert.equal(nextStreak(first, '2026-10-28').current, 2);
  const broken = nextStreak({ last: '2026-10-20', current: 6, best: 6, played: 6 }, '2026-10-27');
  assert.equal(broken.current, 1);
  assert.equal(broken.best, 6);
});

test('cleanDisplayName', () => {
  assert.equal(cleanDisplayName('  Carsten <b>M.</b>  '), 'Carsten bM.b');
  assert.equal(cleanDisplayName('', 'Gast'), 'Gast');
  assert.equal(cleanDisplayName('x'.repeat(50)).length, 20);
});

test('Hit-Liste: genug Einträge, gültige Jahre, keine doppelten Titel', () => {
  assert.ok(DAILY_HITS.length >= 120);
  DAILY_HITS.forEach((s) => { assert.ok(s.year >= 1960 && s.year <= 2025); assert.ok(s.artist && s.title); });
  const keys = DAILY_HITS.map((s) => `${s.artist}|${s.title}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('pickDailySongs: stabil je Tag, verschiedene Jahre und Interpreten, wechselt täglich', () => {
  const a = pickDailySongs('2026-10-27');
  assert.equal(a.length, DAILY_SONG_COUNT);
  assert.deepEqual(a, pickDailySongs('2026-10-27'));
  assert.equal(new Set(a.map((s) => s.year)).size, a.length);
  assert.equal(new Set(a.map((s) => s.artist)).size, a.length);
  assert.notDeepEqual(a, pickDailySongs('2026-10-28'));
});
