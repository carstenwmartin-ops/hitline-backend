// Auswertung der Zähler unter analytics/{event}/… für das Admin-Dashboard (reine Funktionen, ohne Firebase-Zugriff).
// Geschrieben werden die Zähler von logAnalyticsEvent() in der App. Alle Datumsschlüssel sind UTC (toISOString().slice(0, 10)).
//
// Abgrenzung Test/Echtbetrieb: Alles vor dem Start einer Plattform waren ausschließlich Testaufrufe. Zeitreihen und Summen zählen deshalb
// je Plattform erst ab ihrem Starttag (LAUNCH_DATES). Aufschlüsselungen ohne Datumsdimension (Modus, Spielort, …) lassen sich nicht
// abgrenzen und werden vom Aufrufer als "enthält Testaufrufe" gekennzeichnet.

export const PLATFORMS = ['web', 'ios', 'android'];

// Starttage (UTC-Datum) je Plattform. Bei einem weiteren Start (z. B. Web-Relaunch) hier anpassen.
export const LAUNCH_DATES = { web: '2026-10-15', ios: '2026-10-15', android: '2026-10-28' };

const DAY_MS = 86400000;
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const utcMidnight = (now) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

// Die letzten n Tage (UTC), älteste zuerst, inklusive heute.
export const lastDays = (n, now = new Date()) => {
  const base = utcMidnight(now);
  return Array.from({ length: n }, (_, i) => dayKey(base - (n - 1 - i) * DAY_MS));
};

export const earliestLaunch = (launch) => Object.values(launch).sort()[0];

// Anzahl Tage vom Datum (inklusive) bis heute (inklusive).
const daysSince = (iso, now) => Math.floor((utcMidnight(now) - Date.parse(`${iso}T00:00:00Z`)) / DAY_MS) + 1;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export const sumKeys = (byDate, keys) => keys.reduce((s, k) => s + num(byDate?.[k]), 0);

const sumAll = (obj) => Object.values(obj || {}).reduce((s, v) => s + num(v), 0);

const cleanCounts = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, num(v)]));

// Zähler eines Tages über alle Plattformen, nur Plattformen, die an diesem Tag schon gestartet waren.
export const launchedOnDate = (byPlatformDate, date, launch) =>
  PLATFORMS.reduce((s, p) => (date >= launch[p] ? s + num(byPlatformDate?.[p]?.[date]) : s), 0);

// {platform: {datum: count}} → {platform: Summe im Zeitraum} (nur Tage ab Start der Plattform).
export const platformSums = (byPlatformDate, keys, launch) =>
  Object.fromEntries(PLATFORMS.map((p) => [p, sumKeys(byPlatformDate?.[p], keys.filter((k) => k >= launch[p]))]));

// Summe über alle Tage seit Start je Plattform (ohne Zeitraumgrenze).
const sinceLaunchTotal = (byPlatformDate, launch) =>
  PLATFORMS.reduce((s, p) => s + Object.entries(byPlatformDate?.[p] || {}).reduce((t, [d, v]) => (d >= launch[p] ? t + num(v) : t), 0), 0);

export const pct = (part, whole) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0);

// Kennzahlen zu Spielstarts, Abschlüssen, Modi, Plattformen und Spielort.
// analytics = Inhalt des RTDB-Knotens "analytics" (Objekt oder null).
// days: Anzahl Tage oder 'start' (seit dem frühesten Plattformstart).
export const buildGameStats = (analytics, { days = 30, now = new Date(), launch = LAUNCH_DATES } = {}) => {
  const a = analytics || {};
  const started = a.game_started || {};
  const completed = a.game_completed || {};
  const sinceStart = days === 'start';
  const n = sinceStart ? Math.max(1, Math.min(366, daysSince(earliestLaunch(launch), now))) : days;
  const keys = lastDays(n, now);
  const firstLaunch = earliestLaunch(launch);

  const series = keys.map((date) => ({
    date,
    started: launchedOnDate(started.by_platform_date, date, launch),
    completed: launchedOnDate(completed.by_platform_date, date, launch),
  }));
  const startedTotal = series.reduce((s, r) => s + r.started, 0);
  const completedTotal = series.reduce((s, r) => s + r.completed, 0);

  // Aufschlüsselungen nach Modus liegen nur als Gesamtwert vor (nicht nach Datum, nicht von Tests getrennt).
  const modeStarted = cleanCounts(started.by_mode);
  const modeCompleted = cleanCounts(completed.by_mode);
  const modes = Object.keys({ ...modeStarted, ...modeCompleted })
    .map((mode) => ({
      mode,
      started: modeStarted[mode] || 0,
      completed: modeCompleted[mode] || 0,
      completionPct: pct(modeCompleted[mode] || 0, modeStarted[mode] || 0),
    }))
    .sort((x, y) => y.started - x.started);

  const keysFromFirstLaunch = keys.filter((k) => k >= firstLaunch);
  const keysFromWebLaunch = keys.filter((k) => k >= launch.web);
  // "Neue Nutzer" liegen ohne Plattform vor: Zählung ab dem frühesten Start (Android-Tests vor dem 28.10. sind darin nicht trennbar).
  const newUsers = sumKeys(started.by_is_first_timer_date?.yes, keysFromFirstLaunch);
  const tutorialCompleted = PLATFORMS.reduce(
    (s, p) => s + sumKeys(a.tutorial_completed?.by_platform_date?.[p], keys.filter((k) => k >= launch[p])), 0);

  return {
    range: { days: n, mode: sinceStart ? 'start' : 'days', from: keys[0], to: keys[keys.length - 1], timezone: 'UTC' },
    launch: { ...launch },
    totals: {
      started: startedTotal,
      completed: completedTotal,
      abandoned: Math.max(0, startedTotal - completedTotal),
      completionPct: pct(completedTotal, startedTotal),
      newUsers,
      tutorialCompleted,
      installedWebApp: sumKeys(started.by_standalone_date, keysFromWebLaunch),
    },
    series,
    platform: {
      started: platformSums(started.by_platform_date, keys, launch),
      completed: platformSums(completed.by_platform_date, keys, launch),
    },
    // Seit dem jeweiligen Plattformstart (ohne Zeitraumgrenze) für Spielstarts und Abschlüsse
    sinceLaunch: {
      started: sinceLaunchTotal(started.by_platform_date, launch),
      completed: sinceLaunchTotal(completed.by_platform_date, launch),
    },
    // Ohne Datumsdimension geschrieben: enthalten auch die Testaufrufe vor dem Start und lassen sich nicht abgrenzen.
    includesTests: {
      started: num(started.total) || sumAll(started.by_date),
      completed: num(completed.total) || sumAll(completed.by_date),
      modes,
      playLocation: cleanCounts(started.by_play_location),
      playerCount: cleanCounts(started.by_player_count),
      contentSource: cleanCounts(started.by_content_source),
      gameConfig: cleanCounts(a.game_config_chosen?.by_config),
      loggedIn: cleanCounts(started.logged_in),
    },
  };
};
