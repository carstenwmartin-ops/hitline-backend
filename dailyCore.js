// dailyCore.js — reine Logik der "Daily Competition": Datumsschlüssel (Europe/Berlin), Wertung,
// Wochen-/Monatssummen, Plätze und Noten-Belohnung. Ohne Firebase/Express, damit testbar.

const berlinParts = (ms) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')) };
};

const pad = (n) => String(n).padStart(2, '0');

export const berlinDateKey = (ms = Date.now()) => {
  const { year, month, day } = berlinParts(ms);
  return `${year}-${pad(month)}-${pad(day)}`;
};
export const monthKeyOf = (dateKey) => dateKey.slice(0, 7);

// Datumsschlüssel um n Tage verschieben (reine Kalenderrechnung, ohne Zeitzonenfallen).
export const addDays = (dateKey, n) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};

// ISO-Woche ("YYYY-Www"): Woche beginnt Montag, Woche 1 enthält den ersten Donnerstag des Jahres.
export const weekKeyOf = (dateKey) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayNum = (dt.getUTCDay() + 6) % 7; // Mo=0
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3); // Donnerstag dieser Woche
  const isoYear = dt.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const week = 1 + Math.round(((dt - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${isoYear}-W${pad(week)}`;
};

// Alle Tage einer ISO-Woche bzw. eines Monats (für Abschluss und Anzeige).
export const daysOfWeek = (weekKey) => {
  const [yearStr, wStr] = weekKey.split('-W');
  const jan4 = new Date(Date.UTC(Number(yearStr), 0, 4));
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const monday = new Date(mondayWeek1);
  monday.setUTCDate(mondayWeek1.getUTCDate() + (Number(wStr) - 1) * 7);
  const start = `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
};
export const previousWeekKey = (dateKey) => weekKeyOf(addDays(dateKey, -7));
export const previousMonthKey = (dateKey) => {
  const [y, m] = dateKey.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
};

// ─── Wertung ──────────────────────────────────────────────────────────────────
export const POINTS_PER_CORRECT = 10;
export const STREAK_BONUS_STEP = 2;
export const STREAK_BONUS_MAX = 10;
export const WEEK_BEST_DAYS = 5;   // Wochenwertung: die besten 5 von 7 Tagen
export const MONTH_BEST_DAYS = 20; // Monatswertung: die besten 20 Tage

// songs[0] ist der Start-Song der Zeitleiste, songs[1..] werden der Reihe nach eingeordnet.
// placements[i] = Position (0..Länge der Zeitleiste), an die Song i+1 gelegt wurde.
// Classic-Regel: richtig platzierte Karten bleiben in der Zeitleiste, falsch platzierte werden verworfen
// (die Zeitleiste wird dann nicht länger, eine spätere Position außerhalb der Zeitleiste ist ungültig).
export const scorePlacements = (songs, placements) => {
  if (!Array.isArray(songs) || songs.length < 2 || !Array.isArray(placements)) return null;
  if (placements.length !== songs.length - 1) return null;
  const timeline = [songs[0].year];
  let streak = 0;
  let score = 0;
  let correct = 0;
  const grid = [];
  for (let i = 0; i < placements.length; i++) {
    const slot = placements[i];
    if (!Number.isInteger(slot) || slot < 0 || slot > timeline.length) return null;
    const year = songs[i + 1].year;
    const okLeft = slot === 0 || timeline[slot - 1] <= year;
    const okRight = slot === timeline.length || year <= timeline[slot];
    if (okLeft && okRight) {
      streak += 1; correct += 1;
      score += POINTS_PER_CORRECT + Math.min((streak - 1) * STREAK_BONUS_STEP, STREAK_BONUS_MAX);
      grid.push('1');
      timeline.splice(slot, 0, year);
    } else {
      streak = 0;
      grid.push('0');
    }
  }
  return { score, correct, total: placements.length, grid: grid.join('') };
};

// Summe der besten n Tageswerte (days: { 'YYYY-MM-DD': punkte }).
export const bestOfDays = (days, n) => {
  const scores = Object.values(days || {}).filter((v) => Number.isFinite(v)).sort((a, b) => b - a);
  return scores.slice(0, n).reduce((a, b) => a + b, 0);
};

// Rangliste: absteigend nach Punkt, bei Gleichstand wer früher fertig war; Plätze 1,2,3 …
export const rankEntries = (entries) => {
  const sorted = entries.slice().sort((a, b) => (b.score - a.score) || ((a.at || 0) - (b.at || 0)));
  return sorted.map((e, i) => ({ ...e, rank: i + 1 }));
};

// ─── Noten-Belohnung (klein gehalten: Noten werden auch gekauft) ──────────────
export const TROPHY_REWARDS = {
  day:   [2, 1, 1],
  week:  [5, 3, 2],
  month: [10, 6, 4],
};
export const rewardFor = (kind, place) => TROPHY_REWARDS[kind]?.[place - 1] || 0;

// Serie in Folge: gestern gespielt → +1, heute schon gespielt → unverändert, sonst neu bei 1.
export const nextStreak = (streak, todayKey) => {
  const s = streak || { last: null, current: 0, best: 0, played: 0 };
  if (s.last === todayKey) return s;
  const current = s.last === addDays(todayKey, -1) ? (s.current || 0) + 1 : 1;
  return { last: todayKey, current, best: Math.max(s.best || 0, current), played: (s.played || 0) + 1 };
};

export const cleanDisplayName = (raw, fallback = 'Spieler') => {
  const name = String(raw ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  return name || fallback;
};
