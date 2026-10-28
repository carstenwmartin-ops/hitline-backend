// Sicht "Heute" für das Admin-Dashboard (reine Funktionen, ohne Firebase-Zugriff): der Berliner Tag von 0:00 Uhr bis jetzt,
// mit Stundenwerten und Vergleich zu "gestern bis zur gleichen Uhrzeit". Ausgabe nur Zähler und Summen.
//
// Zeitbasis: Daily-Ergebnisse, Käufe und Konten haben genaue Zeitstempel und zählen nach Berliner Zeit. Die Spielzähler (analytics) kennen
// nur UTC-Tage; ihr Tageswert beginnt deshalb erst um 01:00 bzw. 02:00 Uhr deutscher Zeit. Stundenwerte für Spiele gibt es erst mit den
// Zählern by_hour (App-Stand ab Phase 6) und nur für Geräte mit dieser Version.
import { addDays, berlinDateKey } from './dailyCore.js';
import { LAUNCH_DATES, PLATFORMS, earliestLaunch, launchedOnDate, platformSums } from './adminStats.js';
import { classifyPurchase } from './adminPremium.js';

const HOUR_MS = 3600000;
const MIN_MS = 60000;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const zeros = () => Array(24).fill(0);

// Stunde (0 bis 23) einer Zeit nach Berliner Zeit
export const berlinHour = (ms) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)));

// Erster Zeitpunkt (ms) des Berliner Tages mit diesem Datumsschlüssel
export const berlinDayStart = (dateKey) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d) - 3 * HOUR_MS;
  for (let t = base; t < base + 5 * HOUR_MS; t += MIN_MS) if (berlinDateKey(t) === dateKey) return t;
  return base + 3 * HOUR_MS;
};

const utcDateOf = (ms) => new Date(ms).toISOString().slice(0, 10);

// by_hour = { 'YYYY-MM-DD' (UTC): { 'HH' (UTC): count } } → Zähler je Berliner Stunde für einen Berliner Tag. null, wenn gar keine Stundenwerte da sind.
const hourlyForBerlinDay = (byHour, dateKey) => {
  if (!byHour || typeof byHour !== 'object' || Object.keys(byHour).length === 0) return null;
  const out = zeros();
  for (const [utcDate, hours] of Object.entries(byHour)) {
    for (const [hh, count] of Object.entries(hours || {})) {
      const ms = Date.parse(`${utcDate}T${String(hh).padStart(2, '0')}:30:00Z`);
      if (Number.isNaN(ms)) continue;
      if (berlinDateKey(ms) === dateKey) out[berlinHour(ms)] += num(count);
    }
  }
  return out;
};

// dailyResults: { 'YYYY-MM-DD': { uid: { score, at, ... } } } (gestern und heute)
// users: { uid: { profile, purchases } }   authUsers: [{ createdAt }]
export const buildTodayStats = ({ analytics, dailyResults, users, authUsers, now = new Date(), launch = LAUNCH_DATES } = {}) => {
  const nowMs = now.getTime();
  const today = berlinDateKey(nowMs);
  const yesterday = addDays(today, -1);
  const startToday = berlinDayStart(today);
  const startYesterday = berlinDayStart(yesterday);
  const elapsed = nowMs - startToday;
  const yesterdayUntil = startYesterday + elapsed; // gleiche Uhrzeit gestern
  const nowHour = berlinHour(nowMs);
  const inToday = (ms) => ms >= startToday && ms <= nowMs;
  const inYesterdayUntilNow = (ms) => ms >= startYesterday && ms <= yesterdayUntil;

  // ── Spiele ──
  const started = analytics?.game_started || {};
  const completed = analytics?.game_completed || {};
  const utcToday = utcDateOf(nowMs);
  const utcMidnightBerlinHour = berlinHour(Date.parse(`${utcToday}T00:00:00Z`));
  const hourlyStarted = hourlyForBerlinDay(started.by_hour, today);
  const hourlyCompleted = hourlyForBerlinDay(completed.by_hour, today);
  const games = {
    started: launchedOnDate(started.by_platform_date, utcToday, launch),
    completed: launchedOnDate(completed.by_platform_date, utcToday, launch),
    platform: { started: platformSums(started.by_platform_date, [utcToday], launch), completed: platformSums(completed.by_platform_date, [utcToday], launch) },
    countedSinceHour: utcMidnightBerlinHour,
    yesterdayFull: {
      started: launchedOnDate(started.by_platform_date, utcDateOf(nowMs - 24 * HOUR_MS), launch),
      completed: launchedOnDate(completed.by_platform_date, utcDateOf(nowMs - 24 * HOUR_MS), launch),
    },
    hourly: hourlyStarted || hourlyCompleted ? { started: hourlyStarted || zeros(), completed: hourlyCompleted || zeros() } : null,
  };
  // vor dem Start der ersten Plattform gibt es nichts zu zählen
  if (today < earliestLaunch(launch)) { games.started = 0; games.completed = 0; }

  // ── Daily ──
  const dailyOf = (key, filter) => Object.values(dailyResults?.[key] || {}).filter((e) => e && Number.isFinite(e.score) && filter(num(e.at)));
  const dailyToday = dailyOf(today, inToday);
  const dailyHourly = zeros();
  for (const e of dailyToday) dailyHourly[berlinHour(num(e.at))] += 1;
  const dailyYesterdayUntil = dailyOf(yesterday, inYesterdayUntilNow).length;
  const avg = (list) => (list.length ? Math.round((list.reduce((s, e) => s + e.score, 0) / list.length) * 10) / 10 : 0);
  const daily = {
    players: dailyToday.length, avgScore: avg(dailyToday), bestScore: dailyToday.reduce((m, e) => Math.max(m, e.score), 0),
    hourly: dailyHourly, yesterdayUntilNow: dailyYesterdayUntil, yesterdayFull: dailyOf(yesterday, () => true).length,
  };

  // ── Käufe ──
  const purchaseHourly = zeros();
  const revenue = {};
  const byChannel = Object.fromEntries(PLATFORMS.map((p) => [p, 0]));
  let purchaseCount = 0; let yPurchases = 0; const yRevenue = {};
  for (const u of Object.values(users || {})) {
    for (const p of Object.values(u?.purchases || {})) {
      if (!p || typeof p !== 'object') continue;
      const verdict = classifyPurchase(p, launch);
      if (verdict.excluded) continue;
      const ms = num(p.createdAt);
      const cur = String(p.currency || 'eur').toLowerCase();
      const cents = num(p.amount);
      if (inToday(ms)) {
        purchaseCount += 1; purchaseHourly[berlinHour(ms)] += 1; byChannel[verdict.channel] += 1;
        revenue[cur] = (revenue[cur] || 0) + cents;
      } else if (inYesterdayUntilNow(ms)) { yPurchases += 1; yRevenue[cur] = (yRevenue[cur] || 0) + cents; }
    }
  }
  const purchases = { count: purchaseCount, revenue, byChannel, hourly: purchaseHourly, yesterdayUntilNow: yPurchases, yesterdayRevenueUntilNow: yRevenue };

  // ── Neue Konten (Konten vor dem frühesten Plattformstart sind Testkonten) ──
  const firstMs = Date.parse(`${earliestLaunch(launch)}T00:00:00Z`);
  const accHourly = zeros();
  let accToday = 0; let accYesterday = 0;
  for (const a of authUsers || []) {
    const ms = num(a?.createdAt);
    if (ms < firstMs) continue;
    if (inToday(ms)) { accToday += 1; accHourly[berlinHour(ms)] += 1; } else if (inYesterdayUntilNow(ms)) accYesterday += 1;
  }

  return {
    meta: { date: today, since: new Date(startToday).toISOString(), nowHour, timezone: 'Europe/Berlin', compareDate: yesterday },
    games, daily, purchases,
    accounts: { newToday: accToday, hourly: accHourly, yesterdayUntilNow: accYesterday },
  };
};
