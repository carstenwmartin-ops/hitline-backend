// Auswertung der Daily Competition für das Admin-Dashboard (reine Funktionen, ohne Firebase-Zugriff).
// Quellen: dailyResults/{Tag}/{uid} = { name, score, correct, grid, at } (Tage nach Berliner Zeit), analytics/daily_* (Ereigniszähler, UTC-Tage)
// und dailyLeagues. Die Ausgabe enthält nur Zähler und Durchschnitte, keine Namen und keine Konto-IDs.
import { addDays, berlinDateKey } from './dailyCore.js';
import { LAUNCH_DATES, earliestLaunch, launchedOnDate, platformSums, pct } from './adminStats.js';

const DAY_MS = 86400000;
export const FUNNEL_EVENTS = ['daily_opened', 'daily_started', 'daily_completed', 'daily_share'];
export const MIN_PLAYERS_PER_SONG = 3;

const avg = (sum, n, digits = 1) => (n > 0 ? Math.round((sum / n) * 10 ** digits) / 10 ** digits : 0);

// Die letzten n Tage nach Berliner Zeit, älteste zuerst, inklusive heute.
export const lastBerlinDays = (n, now = new Date()) => {
  const today = berlinDateKey(now.getTime());
  return Array.from({ length: n }, (_, i) => addDays(today, -(n - 1 - i)));
};

const daysFromTo = (fromKey, toKey) => Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS) + 1;

// Anzahl der Tage eines Zeitraums: Zahl oder 'start' (seit dem frühesten Plattformstart, höchstens 120)
export const daysForRange = (days, now = new Date(), launch = LAUNCH_DATES) =>
  days === 'start' ? Math.max(1, Math.min(120, daysFromTo(earliestLaunch(launch), berlinDateKey(now.getTime())))) : days;

export const SCORE_BUCKETS = [
  { label: '0–29', min: 0, max: 29 }, { label: '30–59', min: 30, max: 59 }, { label: '60–89', min: 60, max: 89 },
  { label: '90–119', min: 90, max: 119 }, { label: '120–149', min: 120, max: 149 }, { label: '150–170', min: 150, max: Infinity },
];

const validEntry = (e) => e && typeof e === 'object' && Number.isFinite(e.score) && Number.isFinite(e.correct) && typeof e.grid === 'string';

// results: { 'YYYY-MM-DD': { uid: entry } }   analytics: Knoten "analytics" (nur daily_*-Ereignisse nötig)
// leagues: Knoten "dailyLeagues"   songsForDate: (dateKey) => [{ title, artist, year }] (Tagesliste, Startsong zuerst)
export const buildDailyStats = ({ results, analytics, leagues, songsForDate, days = 'start', now = new Date(), launch = LAUNCH_DATES } = {}) => {
  const sinceStart = days === 'start';
  const n = daysForRange(days, now, launch);
  const keys = lastBerlinDays(n, now);

  const perUser = new Map(); // uid → gespielte Tage im Zeitraum
  const correctDist = Array(11).fill(0);
  const scoreDist = SCORE_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  const songStats = new Map(); // "Tag#Zug" → { date, move, players, correct }
  let scoreSum = 0; let correctSum = 0; let best = 0; let perfect = 0; let playerDays = 0;

  const series = keys.map((date) => {
    const day = Object.entries(results?.[date] || {}).filter(([, e]) => validEntry(e));
    let daySum = 0;
    for (const [uid, e] of day) {
      playerDays += 1; daySum += e.score; scoreSum += e.score; correctSum += e.correct;
      best = Math.max(best, e.score);
      if (e.correct >= 10) perfect += 1;
      correctDist[Math.max(0, Math.min(10, e.correct))] += 1;
      const bucket = scoreDist.findIndex((_, i) => e.score >= SCORE_BUCKETS[i].min && e.score <= SCORE_BUCKETS[i].max);
      if (bucket >= 0) scoreDist[bucket].count += 1;
      perUser.set(uid, (perUser.get(uid) || 0) + 1);
      [...e.grid].forEach((c, i) => {
        const k = `${date}#${i}`;
        const s = songStats.get(k) || { date, move: i, players: 0, correct: 0 };
        s.players += 1; if (c === '1') s.correct += 1;
        songStats.set(k, s);
      });
    }
    return { date, players: day.length, avgScore: avg(daySum, day.length) };
  });

  const uniquePlayers = perUser.size;
  const returning = [...perUser.values()].filter((d) => d >= 2).length;
  const daysPlayed = { '1': 0, '2': 0, '3–4': 0, '5+': 0 };
  for (const d of perUser.values()) daysPlayed[d === 1 ? '1' : d === 2 ? '2' : d <= 4 ? '3–4' : '5+'] += 1;

  // Schwerste und leichteste Songs (Zug i gehört zu songs[i + 1]); nur mit genug Spielenden pro Tag
  const songRows = [...songStats.values()]
    .filter((s) => s.players >= MIN_PLAYERS_PER_SONG)
    .map((s) => {
      const song = songsForDate?.(s.date)?.[s.move + 1];
      return song ? { date: s.date, title: song.title, artist: song.artist, year: song.year, players: s.players, correctPct: pct(s.correct, s.players) } : null;
    })
    .filter(Boolean);
  const hardest = [...songRows].sort((x, y) => x.correctPct - y.correctPct || y.players - x.players).slice(0, 5);
  const easiest = [...songRows].sort((x, y) => y.correctPct - x.correctPct || y.players - x.players).slice(0, 5);

  // Ereignis-Trichter (UTC-Tage, nur ab Plattformstart)
  const funnel = {};
  const funnelPlatform = {};
  for (const ev of FUNNEL_EVENTS) {
    const byPlatformDate = analytics?.[ev]?.by_platform_date;
    funnel[ev] = keys.reduce((s, k) => s + launchedOnDate(byPlatformDate, k, launch), 0);
    funnelPlatform[ev] = platformSums(byPlatformDate, keys, launch);
  }

  // Freundes-Ligen: nur Zahlen
  const sizes = Object.values(leagues || {}).map((l) => Object.keys(l?.members || {}).length).filter((c) => c > 0);
  const sizeDist = { '1': 0, '2–3': 0, '4–9': 0, '10+': 0 };
  for (const c of sizes) sizeDist[c === 1 ? '1' : c <= 3 ? '2–3' : c <= 9 ? '4–9' : '10+'] += 1;

  return {
    range: { days: n, mode: sinceStart ? 'start' : 'days', from: keys[0], to: keys[keys.length - 1], timezone: 'Europe/Berlin (Ereignis-Trichter: UTC)' },
    totals: {
      playerDays, uniquePlayers, returningPlayers: returning, returningPct: pct(returning, uniquePlayers),
      avgScore: avg(scoreSum, playerDays), avgCorrect: avg(correctSum, playerDays), bestScore: best,
      perfectRounds: perfect, perfectPct: pct(perfect, playerDays),
    },
    series,
    distributions: { correct: correctDist, score: scoreDist, daysPlayed },
    songs: { hardest, easiest, minPlayers: MIN_PLAYERS_PER_SONG },
    funnel: { counts: funnel, platform: funnelPlatform },
    leagues: { count: sizes.length, members: sizes.reduce((a, b) => a + b, 0), sizeDist },
  };
};
