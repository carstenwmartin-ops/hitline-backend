import test from 'node:test';
import assert from 'node:assert/strict';
import { oldestKeptDay, oldestKeptWeek, oldestKeptMonth, RETENTION_DAYS } from './dailyCore.js';
import { purgeExpiredDailyData, removeDailyData } from './daily.js';

// Minimale In-Memory-Attrappe der Realtime Database (nur was die Aufräum-Funktionen brauchen)
const makeDb = (initial) => {
  const data = structuredClone(initial);
  const parts = (p) => p.split('/').filter(Boolean);
  const get = (p) => parts(p).reduce((n, k) => (n == null ? undefined : n[k]), data);
  const del = (p) => {
    const ks = parts(p);
    const last = ks.pop();
    const parent = ks.reduce((n, k) => (n == null ? undefined : n[k]), data);
    if (parent && typeof parent === 'object') delete parent[last];
  };
  const ref = (path) => {
    const api = {
      end: null,
      orderByKey() { return api; },
      endAt(k) { api.end = k; return api; },
      async once() {
        const v = get(path);
        const keys = v && typeof v === 'object' ? Object.keys(v).sort() : [];
        const picked = api.end ? keys.filter((k) => k <= api.end) : keys;
        return {
          val: () => v ?? null,
          exists: () => v != null,
          forEach: (cb) => { for (const k of picked) { if (cb({ key: k, val: () => v[k] }) === true) break; } },
        };
      },
      async update(u) { for (const [k, v] of Object.entries(u)) { if (v === null) del(`${path}/${k}`); } },
      async remove() { del(path); },
    };
    return api;
  };
  return { ref, data };
};

const NOW = Date.UTC(2026, 9, 27, 10, 0, 0); // 27.10.2026 (Woche 44)

test('Aufbewahrungsgrenzen: ältester behaltener Tag, Woche und Monat', () => {
  assert.equal(oldestKeptDay('2026-10-27'), '2026-08-26');
  assert.equal(oldestKeptWeek('2026-10-27'), '2026-W34');
  assert.equal(oldestKeptMonth('2026-10-27'), '2026-07');
});

test('purgeExpiredDailyData löscht nur Abgelaufenes (Tage, Wochen, Monate)', async () => {
  const db = makeDb({
    dailyResults: { '2026-08-25': { a: 1 }, '2026-08-26': { a: 1 }, '2026-10-01': { a: 1 }, '2026-10-27': { a: 1 } },
    dailyBoards: {
      week: { '2026-W33': { a: 1 }, '2026-W34': { a: 1 }, '2026-W44': { a: 1 } },
      month: { '2026-06': { a: 1 }, '2026-07': { a: 1 }, '2026-10': { a: 1 } },
    },
  });
  await purgeExpiredDailyData(db, NOW);
  assert.deepEqual(Object.keys(db.data.dailyResults).sort(), ['2026-08-26', '2026-10-01', '2026-10-27']);
  assert.deepEqual(Object.keys(db.data.dailyBoards.week).sort(), ['2026-W34', '2026-W44']);
  assert.deepEqual(Object.keys(db.data.dailyBoards.month).sort(), ['2026-07', '2026-10']);
});

test('purgeExpiredDailyData ohne Abgelaufenes ändert nichts und wirft nicht bei leerer Datenbank', async () => {
  const db = makeDb({});
  await purgeExpiredDailyData(db, NOW);
  assert.deepEqual(db.data, {});
});

test('removeDailyData entfernt alles, was die Aufbewahrung noch behält (kein Rest nach Kontolöschung)', async () => {
  const day = (d) => ({ me: { name: 'Ich', score: 50 }, other: { name: 'Anna', score: 70 }, ...(d || {}) });
  const db = makeDb({
    dailyResults: { [oldestKeptDay('2026-10-27')]: day(), '2026-10-27': day() },
    dailyBoards: {
      week: { [oldestKeptWeek('2026-10-27')]: day(), '2026-W44': day() },
      month: { [oldestKeptMonth('2026-10-27')]: day(), '2026-10': day() },
    },
    dailyLeagues: { ABC234: { members: { me: { name: 'Ich' }, other: { name: 'Anna' } } } },
    users: { me: { daily: { leagues: { ABC234: 'Familie' } } } },
  });
  await removeDailyData(db, 'me', NOW);
  const left = JSON.stringify(db.data.dailyResults) + JSON.stringify(db.data.dailyBoards) + JSON.stringify(db.data.dailyLeagues);
  assert.ok(!left.includes('"me"'), 'eigene Einträge müssen überall weg sein');
  assert.ok(!left.includes('Ich'), 'eigener Name darf nirgends übrig sein');
  assert.ok(left.includes('Anna'), 'Einträge anderer bleiben unberührt');
});

test('Frist für Tagesergebnisse: 62 Tage', () => {
  assert.equal(RETENTION_DAYS, 62);
});
