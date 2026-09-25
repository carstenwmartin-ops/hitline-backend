import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJoinPush, canSendRoomPush, sanitizePushName, ROOM_CODE_RE, MAX_PUSHES_PER_ROOM } from './roomPush.js';

test('Beitritt: Name und Zählerstand, deutsch und englisch', () => {
  assert.equal(buildJoinPush({ lang: 'de', name: 'Anna', joined: 2, desired: 4 }).body, 'Anna ist dem Spiel beigetreten (2/4)');
  assert.equal(buildJoinPush({ lang: 'en', name: 'Anna', joined: 2, desired: 4 }).body, 'Anna joined your game (2/4)');
});

test('Raum voll: Startnachricht', () => {
  assert.equal(buildJoinPush({ lang: 'de', name: 'Ben', joined: 3, desired: 3 }).body, 'Dein Spiel kann beginnen! Viel Spaß mit Hitlines!');
  assert.equal(buildJoinPush({ lang: 'en', name: 'Ben', joined: 3, desired: 3 }).body, 'Your game can start! Have fun with Hitlines!');
});

test('Name wird bereinigt und gekürzt, Ersatzname bei leerem Namen', () => {
  assert.equal(sanitizePushName('  <b>Max</b>  Mustermann  '), 'bMax/b Mustermann');
  assert.ok(sanitizePushName('x'.repeat(50)).length <= 24);
  assert.equal(sanitizePushName('   '), null);
  assert.equal(buildJoinPush({ lang: 'de', name: '', joined: 2, desired: 4 }).body, 'Jemand ist dem Spiel beigetreten (2/4)');
});

test('Bereinigter Name enthält keine spitzen Klammern oder Steuerzeichen', () => {
  const n = sanitizePushName('<script>a\u0007b</script>');
  assert.ok(!/[<>\u0000-\u001f]/.test(n));
});

test('Raumcode: genau 4 Großbuchstaben oder Ziffern', () => {
  assert.ok(ROOM_CODE_RE.test('AB2X'));
  assert.ok(!ROOM_CODE_RE.test('ab2x'));
  assert.ok(!ROOM_CODE_RE.test('ABCDE'));
  assert.ok(!ROOM_CODE_RE.test('../x'));
});

test('Rate-Limit: Mindestabstand und Höchstzahl je Raum', () => {
  const now = 1_000_000;
  assert.equal(canSendRoomPush({}, now), true);
  assert.equal(canSendRoomPush({ lastPushAt: now - 2000, pushCount: 1 }, now), false);
  assert.equal(canSendRoomPush({ lastPushAt: now - 20000, pushCount: 1 }, now), true);
  assert.equal(canSendRoomPush({ lastPushAt: 0, pushCount: MAX_PUSHES_PER_ROOM }, now), false);
});
