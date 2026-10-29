// Moderation der Daily (Apple Guideline 1.2): zu einem gemeldeten Namen das Konto finden. Reine Funktionen, ohne Firebase-Zugriff.
// Eine Meldung aus der Daily trägt den Namen und einen Schlüssel: Tag ("2026-10-29"), Woche ("2026-W44"), Monat ("2026-10") oder Liga-Code (6 Zeichen).

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_RE = /^\d{4}-W\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const LEAGUE_RE = /^[A-Z2-9]{6}$/;

// Schlüssel → Datenbankpfad, unter dem die Namen stehen, oder null bei ungültigem Schlüssel
export const moderationPath = (key) => {
  const k = String(key || '').trim();
  if (DAY_RE.test(k)) return { kind: 'day', path: `dailyResults/${k}` };
  if (WEEK_RE.test(k)) return { kind: 'week', path: `dailyBoards/week/${k}` };
  if (MONTH_RE.test(k)) return { kind: 'month', path: `dailyBoards/month/${k}` };
  const league = k.toUpperCase();
  if (LEAGUE_RE.test(league)) return { kind: 'league', path: `dailyLeagues/${league}/members` };
  return null;
};

const norm = (s) => String(s ?? '').trim().toLowerCase();

// entries: { uid: { name, … } } → [{ uid, name }] mit gleichem Namen (ohne Beachtung von Groß- und Kleinschreibung), höchstens 10
export const matchByName = (entries, name) => {
  const wanted = norm(name);
  if (!wanted || !entries || typeof entries !== 'object') return [];
  return Object.entries(entries)
    .filter(([, e]) => e && typeof e === 'object' && norm(e.name) === wanted)
    .slice(0, 10)
    .map(([uid, e]) => ({ uid, name: e.name }));
};
