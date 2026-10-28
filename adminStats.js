// Auswertung der Zähler unter analytics/{event}/… für das Admin-Dashboard (reine Funktionen, ohne Firebase-Zugriff).
// Geschrieben werden die Zähler von logAnalyticsEvent() in der App. Alle Datumsschlüssel sind UTC (toISOString().slice(0, 10)).

const PLATFORMS = ['web', 'ios', 'android'];

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

// Die letzten n Tage (UTC), älteste zuerst, inklusive heute.
export const lastDays = (n, now = new Date()) => {
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: n }, (_, i) => dayKey(base - (n - 1 - i) * 86400000));
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const sumKeys = (byDate, keys) => keys.reduce((s, k) => s + num(byDate?.[k]), 0);

const sumAll = (obj) => Object.values(obj || {}).reduce((s, v) => s + num(v), 0);

const cleanCounts = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, num(v)]));

// {platform: {datum: count}} → {platform: Summe im Zeitraum}; nur bekannte Plattformen, fehlende stehen mit 0 drin.
const platformSums = (byPlatformDate, keys) => {
  return Object.fromEntries(PLATFORMS.map((p) => [p, sumKeys(byPlatformDate?.[p], keys)]));
};

const pct = (part, whole) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0);

// Kennzahlen zu Spielstarts, Abschlüssen, Modi, Plattformen und Spielort.
// analytics = Inhalt des RTDB-Knotens "analytics" (Objekt oder null).
export const buildGameStats = (analytics, { days = 30, now = new Date() } = {}) => {
  const a = analytics || {};
  const started = a.game_started || {};
  const completed = a.game_completed || {};
  const keys = lastDays(days, now);

  const series = keys.map((date) => ({
    date,
    started: num(started.by_date?.[date]),
    completed: num(completed.by_date?.[date]),
  }));
  const startedTotal = series.reduce((s, r) => s + r.started, 0);
  const completedTotal = series.reduce((s, r) => s + r.completed, 0);

  // Aufschlüsselungen nach Modus liegen nur als Gesamtwert vor (nicht nach Datum).
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

  const standaloneKeys = started.by_standalone_date || {};
  const newUsersByDate = started.by_is_first_timer_date?.yes || {};

  return {
    range: { days, from: keys[0], to: keys[keys.length - 1], timezone: 'UTC' },
    totals: {
      started: startedTotal,
      completed: completedTotal,
      abandoned: Math.max(0, startedTotal - completedTotal),
      completionPct: pct(completedTotal, startedTotal),
      newUsers: sumKeys(newUsersByDate, keys),
      tutorialCompleted: sumKeys(a.tutorial_completed?.by_date, keys),
      installedWebApp: sumKeys(standaloneKeys, keys),
    },
    series,
    platform: {
      started: platformSums(started.by_platform_date, keys),
      completed: platformSums(completed.by_platform_date, keys),
    },
    // Gesamtwerte seit Beginn der Zählung (nicht zeitgefiltert, da ohne Datumsdimension geschrieben)
    allTime: {
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
