// daily.js — Endpunkte der "Daily Competition" (Tagesrunde, Ranglisten, Trophäen, Freundes-Ligen).
// Alle bekommen am selben Tag dieselben Songs (pickDailySongs). Die Wertung rechnet der Server aus den
// gemeldeten Platzierungen selbst nach (scorePlacements); pro Konto und Tag zählt genau ein Versuch.
// Hinweis: Die Jahre der Songs gehen zur Anzeige der Auflösung an den Client; wer die Antwort im
// Netzwerkverkehr mitliest, kann also schummeln. Für ein Gelegenheitsspiel bewusst in Kauf genommen.
//
// Firebase-Pfade (nur per Admin-SDK, Clients haben keinen Zugriff):
//   dailyResults/{datum}/{uid}            { name, score, correct, grid, at }
//   dailyBoards/{week|month}/{key}/{uid}  { name, at, days: { datum: punkte } }
//   dailyFinal/{day|week|month}/{key}     { at, count, top: [{ name, score, place }] }  (Abschluss-Sperre)
//   dailyLeagues/{CODE}                   { name, owner, createdAt, members: { uid: { name, at } } }
//   users/{uid}/daily/{streak,trophies,leagues}
import {
  berlinDateKey, addDays, monthKeyOf, weekKeyOf, previousWeekKey, previousMonthKey, scorePlacements,
  bestOfDays, rankEntries, rewardFor, nextStreak, cleanDisplayName, WEEK_BEST_DAYS, MONTH_BEST_DAYS,
  RETENTION_DAYS, RETENTION_WEEKS, RETENTION_MONTHS, oldestKeptDay, oldestKeptWeek, oldestKeptMonth,
} from './dailyCore.js';
import { pickDailySongs } from './dailyHits.js';

const LEAGUE_CODE_RE = /^[A-Z2-9]{6}$/;
const LEAGUE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_LEAGUES_PER_USER = 10;
const MAX_LEAGUE_MEMBERS = 50;
const BOARD_SIZE = 20;

// Beim Löschen eines Kontos: alle Spuren außerhalb von users/{uid} entfernen (Tagesergebnisse der letzten ~2 Monate,
// Wochen-/Monatsranglisten, Liga-Mitgliedschaften). Wirft nie wegen eines einzelnen fehlenden Pfads.
export async function removeDailyData(db, uid, now = Date.now()) {
  const today = berlinDateKey(now);
  const ops = [];
  for (let i = 0; i <= RETENTION_DAYS; i++) ops.push(db.ref(`dailyResults/${addDays(today, -i)}/${uid}`).remove());
  for (let i = 0; i <= RETENTION_WEEKS; i++) ops.push(db.ref(`dailyBoards/week/${weekKeyOf(addDays(today, -7 * i))}/${uid}`).remove());
  let month = monthKeyOf(today);
  for (let i = 0; i <= RETENTION_MONTHS; i++) { ops.push(db.ref(`dailyBoards/month/${month}/${uid}`).remove()); month = previousMonthKey(`${month}-01`); }
  const leagues = (await db.ref(`users/${uid}/daily/leagues`).once('value')).val() || {};
  for (const code of Object.keys(leagues)) ops.push(db.ref(`dailyLeagues/${code}/members/${uid}`).remove());
  await Promise.all(ops);
}

// Löscht abgelaufene Tagesergebnisse und Ranglisten (Anzeigenamen) nach den Fristen aus dailyCore.js.
// Schlüssel sind Datum/Woche/Monat mit führenden Nullen, die Reihenfolge nach Schlüssel entspricht also der Zeit.
export async function purgeExpiredDailyData(db, now = Date.now()) {
  const today = berlinDateKey(now);
  const plans = [
    ['dailyResults', oldestKeptDay(today)],
    ['dailyBoards/week', oldestKeptWeek(today)],
    ['dailyBoards/month', oldestKeptMonth(today)],
  ];
  for (const [path, oldestKept] of plans) {
    const snap = await db.ref(path).orderByKey().endAt(oldestKept).once('value');
    const updates = {};
    snap.forEach((child) => { if (child.key < oldestKept) updates[child.key] = null; });
    if (Object.keys(updates).length > 0) await db.ref(path).update(updates);
  }
}

export function registerDailyRoutes(app, { getDb, logCoinHistory }) {
  const db = () => getDb();

  const authenticate = async (req) => {
    const header = req.headers['authorization'] || '';
    const idToken = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!idToken) return null;
    try {
      const { default: admin } = await import('firebase-admin');
      const decoded = await admin.auth().verifyIdToken(idToken);
      return { uid: decoded.uid, tokenName: decoded.name || null };
    } catch { return null; }
  };

  const guard = async (req, res) => {
    const user = await authenticate(req);
    if (!user) { res.status(401).json({ error: 'Bitte melde dich an.' }); return null; }
    if (!db()) { res.status(503).json({ error: 'Nicht konfiguriert' }); return null; }
    return user;
  };

  const credit = async (uid, amount, reason) => {
    let newBalance = null;
    await db().ref(`users/${uid}/profile`).transaction((p) => {
      if (!p) return p;
      newBalance = (p.coins || 0) + amount;
      return { ...p, coins: newBalance, totalEarned: (p.totalEarned || 0) + amount };
    });
    if (newBalance !== null) await logCoinHistory(uid, amount, reason, newBalance);
  };

  // ─── Abschluss von Tag/Woche/Monat: Plätze 1–3 bekommen Trophäe und kleine Noten-Belohnung ─────────
  const loadEntries = async (kind, key) => {
    if (kind === 'day') {
      const val = (await db().ref(`dailyResults/${key}`).once('value')).val() || {};
      return Object.entries(val).map(([uid, e]) => ({ uid, name: e.name, score: e.score, at: e.at }));
    }
    const best = kind === 'week' ? WEEK_BEST_DAYS : MONTH_BEST_DAYS;
    const val = (await db().ref(`dailyBoards/${kind}/${key}`).once('value')).val() || {};
    return Object.entries(val).map(([uid, e]) => ({ uid, name: e.name, score: bestOfDays(e.days, best), at: e.at }));
  };

  const TROPHY_REASON = { day: 'Daily: Tagesplatz', week: 'Daily: Wochenplatz', month: 'Daily: Monatsplatz' };

  const finalizePeriod = async (kind, key) => {
    const finalRef = db().ref(`dailyFinal/${kind}/${key}`);
    const claim = await finalRef.transaction((cur) => (cur ? undefined : { at: Date.now(), state: 'running' }));
    if (!claim.committed) return;
    const awarded = [];
    try {
      const entries = await loadEntries(kind, key);
      const top = rankEntries(entries).slice(0, 3);
      for (const e of top) {
        const reward = rewardFor(kind, e.rank);
        const trophyRef = db().ref(`users/${e.uid}/daily/trophies/${kind}_${key}`);
        const t = await trophyRef.transaction((cur) => (cur ? undefined : { kind, key, place: e.rank, score: e.score, reward, at: Date.now() }));
        if (t.committed) {
          awarded.push(trophyRef);
          if (reward > 0) await credit(e.uid, reward, `${TROPHY_REASON[kind]} ${e.rank} (${key}) 🏆`);
        }
      }
      await finalRef.set({
        at: Date.now(), count: entries.length,
        top: top.map((e) => ({ score: e.score, place: e.rank })), // bewusst ohne Namen (nirgends angezeigt)
      });
    } catch (e) {
      // Nichts halb abgeschlossen lassen: Sperre und frisch vergebene Trophäen lösen, damit der nächste Abruf es erneut versucht
      await Promise.all(awarded.map((r) => r.remove().catch(() => {})));
      await finalRef.remove().catch(() => {});
      throw e;
    }
  };

  let ensuredFor = null;
  let ensuring = null;
  const ensureFinalized = async () => {
    const today = berlinDateKey();
    if (ensuredFor === today) return;
    if (ensuring) return ensuring;
    ensuring = (async () => {
      try {
        for (let i = 1; i <= 7; i++) {
          const day = addDays(today, -i);
          const seen = (await db().ref(`dailyFinal/day/${day}`).once('value')).exists();
          if (!seen && (await db().ref(`dailyResults/${day}`).limitToFirst(1).once('value')).exists()) await finalizePeriod('day', day);
        }
        const week = previousWeekKey(today);
        if (!(await db().ref(`dailyFinal/week/${week}`).once('value')).exists()) await finalizePeriod('week', week);
        const month = previousMonthKey(today);
        if (!(await db().ref(`dailyFinal/month/${month}`).once('value')).exists()) await finalizePeriod('month', month);
        await purgeExpiredDailyData(db()).catch((e) => console.error('⚠️ Daily-Aufräumen fehlgeschlagen:', e.message));
        ensuredFor = today;
      } catch (e) {
        console.error('⚠️ Daily-Abschluss fehlgeschlagen:', e.message);
      } finally { ensuring = null; }
    })();
    return ensuring;
  };

  const songsForClient = (dateKey) => pickDailySongs(dateKey).map((s) => ({ artist: s.artist, title: s.title, year: s.year }));

  const pickOpponent = async (dateKey, uid, myScore) => {
    try {
      const val = (await db().ref(`dailyResults/${dateKey}`).once('value')).val() || {};
      const others = Object.entries(val).filter(([id]) => id !== uid).map(([, e]) => e);
      if (others.length) {
        const o = others[Math.floor(Math.random() * others.length)];
        return { name: o.name, score: o.score, grid: o.grid, isBot: false };
      }
      return { name: 'BEAT', score: Math.max(0, Math.round(myScore * 0.8)), grid: null, isBot: true };
    } catch { return null; }
  };

  // GET /api/daily/today — Songs des Tages (mit Jahren für die Auflösung) und der eigene Stand
  app.get('/api/daily/today', async (req, res) => {
    const user = await guard(req, res); if (!user) return;
    try {
      await ensureFinalized();
      const date = berlinDateKey();
      const mine = (await db().ref(`dailyResults/${date}/${user.uid}`).once('value')).val();
      const streak = (await db().ref(`users/${user.uid}/daily/streak`).once('value')).val();
      const body = { date, songs: songsForClient(date), result: mine || null, streak: streak || null };
      if (mine) body.opponent = await pickOpponent(date, user.uid, mine.score);
      res.json(body);
    } catch (e) {
      console.error('❌ daily/today:', e.message);
      res.status(500).json({ error: 'Daily konnte nicht geladen werden' });
    }
  });

  // POST /api/daily/submit — Platzierungen melden, Server wertet aus (ein Versuch pro Konto und Tag)
  app.post('/api/daily/submit', async (req, res) => {
    const user = await guard(req, res); if (!user) return;
    try {
      const date = berlinDateKey();
      const scored = scorePlacements(pickDailySongs(date), req.body?.placements);
      if (!scored) return res.status(400).json({ error: 'Ungültige Platzierungen' });
      const name = cleanDisplayName(req.body?.name || user.tokenName);
      const at = Date.now();
      const entry = { name, score: scored.score, correct: scored.correct, grid: scored.grid, at };

      const tx = await db().ref(`dailyResults/${date}/${user.uid}`).transaction((cur) => (cur ? undefined : entry));
      if (!tx.committed) {
        const existing = (await db().ref(`dailyResults/${date}/${user.uid}`).once('value')).val();
        return res.status(409).json({ error: 'Heute schon gespielt', result: existing });
      }
      await Promise.all([
        db().ref(`dailyBoards/week/${weekKeyOf(date)}/${user.uid}`).update({ name, at, [`days/${date}`]: scored.score }),
        db().ref(`dailyBoards/month/${monthKeyOf(date)}/${user.uid}`).update({ name, at, [`days/${date}`]: scored.score }),
      ]);
      const streakTx = await db().ref(`users/${user.uid}/daily/streak`).transaction((cur) => nextStreak(cur, date));
      const opponent = await pickOpponent(date, user.uid, scored.score);
      res.json({ result: entry, opponent, streak: streakTx.snapshot.val() });
    } catch (e) {
      console.error('❌ daily/submit:', e.message);
      res.status(500).json({ error: 'Ergebnis konnte nicht gespeichert werden' });
    }
  });

  // GET /api/daily/leaderboard?period=day|week|month[&league=CODE]
  app.get('/api/daily/leaderboard', async (req, res) => {
    const user = await guard(req, res); if (!user) return;
    try {
      await ensureFinalized();
      const period = ['day', 'week', 'month'].includes(req.query.period) ? req.query.period : 'day';
      const date = berlinDateKey();
      const key = period === 'day' ? date : period === 'week' ? weekKeyOf(date) : monthKeyOf(date);
      let entries = await loadEntries(period, key);

      const leagueCode = String(req.query.league || '').toUpperCase();
      if (leagueCode) {
        if (!LEAGUE_CODE_RE.test(leagueCode)) return res.status(400).json({ error: 'Ungültiger Code' });
        const members = (await db().ref(`dailyLeagues/${leagueCode}/members`).once('value')).val() || {};
        if (!members[user.uid]) return res.status(403).json({ error: 'Kein Mitglied dieser Liga' });
        entries = entries.filter((e) => members[e.uid]);
      }

      const ranked = rankEntries(entries);
      const me = ranked.find((e) => e.uid === user.uid) || null;
      res.json({
        period, key, count: ranked.length,
        top: ranked.slice(0, BOARD_SIZE).map((e) => ({ rank: e.rank, name: e.name, score: e.score, isMe: e.uid === user.uid })),
        me: me ? { rank: me.rank, score: me.score } : null,
      });
    } catch (e) {
      console.error('❌ daily/leaderboard:', e.message);
      res.status(500).json({ error: 'Rangliste konnte nicht geladen werden' });
    }
  });

  // GET /api/daily/me — Trophäen, Serie und eigene Ligen
  app.get('/api/daily/me', async (req, res) => {
    const user = await guard(req, res); if (!user) return;
    try {
      await ensureFinalized();
      const node = (await db().ref(`users/${user.uid}/daily`).once('value')).val() || {};
      const trophies = Object.values(node.trophies || {}).sort((a, b) => (b.at || 0) - (a.at || 0));
      const leagues = Object.entries(node.leagues || {}).map(([code, name]) => ({ code, name }));
      res.json({ streak: node.streak || null, trophies, leagues });
    } catch (e) {
      console.error('❌ daily/me:', e.message);
      res.status(500).json({ error: 'Profil konnte nicht geladen werden' });
    }
  });

  // POST /api/daily/league — { action: 'create', name } | { action: 'join', code } | { action: 'leave', code }
  app.post('/api/daily/league', async (req, res) => {
    const user = await guard(req, res); if (!user) return;
    try {
      const action = req.body?.action;
      const myName = cleanDisplayName(req.body?.myName || user.tokenName);
      const myLeagues = (await db().ref(`users/${user.uid}/daily/leagues`).once('value')).val() || {};

      if (action === 'create') {
        if (Object.keys(myLeagues).length >= MAX_LEAGUES_PER_USER) return res.status(409).json({ error: 'Zu viele Ligen' });
        const name = cleanDisplayName(req.body?.name, 'Freunde');
        for (let attempt = 0; attempt < 6; attempt++) {
          const code = Array.from({ length: 6 }, () => LEAGUE_ALPHABET[Math.floor(Math.random() * LEAGUE_ALPHABET.length)]).join('');
          const tx = await db().ref(`dailyLeagues/${code}`).transaction((cur) => (cur ? undefined : {
            name, owner: user.uid, createdAt: Date.now(), members: { [user.uid]: { name: myName, at: Date.now() } },
          }));
          if (tx.committed) {
            await db().ref(`users/${user.uid}/daily/leagues/${code}`).set(name);
            return res.json({ code, name });
          }
        }
        return res.status(500).json({ error: 'Code konnte nicht erzeugt werden' });
      }

      const code = String(req.body?.code || '').toUpperCase().trim();
      if (!LEAGUE_CODE_RE.test(code)) return res.status(400).json({ error: 'Ungültiger Code' });
      const leagueRef = db().ref(`dailyLeagues/${code}`);
      const league = (await leagueRef.once('value')).val();
      if (!league) return res.status(404).json({ error: 'Liga nicht gefunden' });

      if (action === 'join') {
        const members = league.members || {};
        if (!members[user.uid]) {
          if (Object.keys(myLeagues).length >= MAX_LEAGUES_PER_USER) return res.status(409).json({ error: 'Zu viele Ligen' });
          if (Object.keys(members).length >= MAX_LEAGUE_MEMBERS) return res.status(409).json({ error: 'Liga ist voll' });
          await leagueRef.child(`members/${user.uid}`).set({ name: myName, at: Date.now() });
        }
        await db().ref(`users/${user.uid}/daily/leagues/${code}`).set(league.name);
        return res.json({ code, name: league.name });
      }
      if (action === 'leave') {
        await leagueRef.child(`members/${user.uid}`).remove();
        await db().ref(`users/${user.uid}/daily/leagues/${code}`).remove();
        return res.json({ left: true });
      }
      return res.status(400).json({ error: 'Unbekannte Aktion' });
    } catch (e) {
      console.error('❌ daily/league:', e.message);
      res.status(500).json({ error: 'Liga-Aktion fehlgeschlagen' });
    }
  });
}
