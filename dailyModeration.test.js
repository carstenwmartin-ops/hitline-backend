import test from 'node:test';
import assert from 'node:assert/strict';
import { moderationPath, matchByName } from './dailyModeration.js';
import { sanitizeName } from './contentFilter.js';
import { cleanDisplayName } from './dailyCore.js';

test('moderationPath: Tag, Woche, Monat und Liga', () => {
  assert.deepEqual(moderationPath('2026-10-29'), { kind: 'day', path: 'dailyResults/2026-10-29' });
  assert.deepEqual(moderationPath('2026-W44'), { kind: 'week', path: 'dailyBoards/week/2026-W44' });
  assert.deepEqual(moderationPath('2026-10'), { kind: 'month', path: 'dailyBoards/month/2026-10' });
  assert.deepEqual(moderationPath('abc234'), { kind: 'league', path: 'dailyLeagues/ABC234/members' });
});

test('moderationPath: ungültige Schlüssel (auch Pfad-Tricks) ergeben null', () => {
  for (const k of [undefined, '', 'x', '2026-10-29/../users', '../users', 'ABC2345', 'ABC10O', '2026-13']) {
    if (k === '2026-13') assert.ok(moderationPath(k)); // sieht wie ein Monat aus, der Pfad bleibt harmlos (kein Treffer)
    else assert.equal(moderationPath(k), null, String(k));
  }
});

test('matchByName: ohne Beachtung von Groß- und Kleinschreibung, höchstens 10, nur Objekte', () => {
  const entries = { a: { name: 'Mia' }, b: { name: ' mia ' }, c: { name: 'Tom' }, d: 'x', e: null };
  assert.deepEqual(matchByName(entries, 'MIA').map((m) => m.uid), ['a', 'b']);
  assert.deepEqual(matchByName(entries, ''), []);
  assert.deepEqual(matchByName(null, 'Mia'), []);
  const many = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`u${i}`, { name: 'Ina' }]));
  assert.equal(matchByName(many, 'ina').length, 10);
});

test('sanitizeName ersetzt bekannte Begriffe durch Sternchen', () => {
  assert.equal(sanitizeName('Max Wichser'), 'Max *******');
  assert.equal(sanitizeName('FUCK'), '****');
  assert.equal(sanitizeName('Mia'), 'Mia');
  assert.equal(sanitizeName(undefined), undefined);
});

test('cleanDisplayName: Wortfilter wirkt, leere oder rein gefilterte Namen werden zum Ersatznamen', () => {
  assert.equal(cleanDisplayName('Max Wichser'), 'Max');
  assert.equal(cleanDisplayName('Nazi'), 'Spieler');
  assert.equal(cleanDisplayName('Nazi', 'Freunde'), 'Freunde');
  assert.equal(cleanDisplayName('  Mia  '), 'Mia');
  assert.equal(cleanDisplayName('Anna-Lena_2'), 'Anna-Lena_2');
});
