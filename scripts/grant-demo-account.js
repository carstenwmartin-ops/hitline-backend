// Rüstet Demo-/Prüfkonten für den App Store Review aus: setzt den Notenstand, schaltet alle Modi,
// Genre-Pakete und Features frei. Schreibt einen coinHistory-Eintrag, damit
// GET /api/admin/coins-discrepancy-check (coins == 5 + Summe(coinHistory)) nicht anschlägt.
//
// Aufruf (aus hitline-backend/):
//   node scripts/grant-demo-account.js --key C:\pfad\serviceAccount.json [--coins 500] [--dry-run] [mail1 mail2 ...]
// Ohne --key wird FIREBASE_SERVICE_ACCOUNT (JSON) aus der Umgebung gelesen.
// Ohne Mailadressen: demo@hitlines.de und demo-2@hitlines.de.
import { readFileSync } from 'fs';
import admin from 'firebase-admin';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const dryRun = args.includes('--dry-run');
const targetCoins = Number(opt('--coins') ?? 500);
const keyFile = opt('--key');
const flagValues = new Set([opt('--key'), opt('--coins')]);
const emails = args.filter((a) => !a.startsWith('--') && !flagValues.has(a));
if (!emails.length) emails.push('demo@hitlines.de', 'demo-2@hitlines.de');

if (!Number.isFinite(targetCoins) || targetCoins < 0) { console.error('--coins muss eine Zahl >= 0 sein'); process.exit(1); }

const raw = keyFile ? readFileSync(keyFile, 'utf8') : process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.error('Kein Service-Account: --key <datei> angeben oder FIREBASE_SERVICE_ACCOUNT setzen.'); process.exit(1); }
const serviceAccount = JSON.parse(raw);
if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://hitline-139be-default-rtdb.europe-west1.firebasedatabase.app',
});
const db = admin.database();

// Gleiche Liste wie FEATURE_CONFIG im Frontend (src/data/features.js).
const ALL_MODES = ['classic', 'song-battle', 'gambling', 'quiz-casino', 'crazy-casino', 'pressure-cooker', 'survival',
  'double-quiz', 'zeitgeist', 'race', 'quiz', 'timeline-trap', 'song-swipe', 'crossover', 'coop', 'classic-team',
  'alliance', 'survival-coop', 'familien-jam', 'themen-duell', 'party', 'music-pub', 'song-gift'];
const ALL_GENRE_PACKS = ['starter', 'pack-1', 'pack-2', 'pack-3', 'pack-all'];
const ALL_FEATURES = ['multi-genre', 'favorites', 'themes', 'playlists'];

for (const email of emails) {
  let uid;
  try { uid = (await admin.auth().getUserByEmail(email)).uid; }
  catch (e) { console.error(`✗ ${email}: kein Konto gefunden (${e.code || e.message})`); continue; }

  const profileRef = db.ref(`users/${uid}/profile`);
  const profile = (await profileRef.once('value')).val() || {};
  const currentCoins = Number(profile.coins) || 0;
  const delta = targetCoins - currentCoins;
  const unlocked = {
    ...(profile.unlocked || {}),
    modes: ALL_MODES,
    genrePacks: ALL_GENRE_PACKS,
    features: ALL_FEATURES,
    singleGenres: profile.unlocked?.singleGenres || [],
    previews: profile.unlocked?.previews || {},
  };

  console.log(`${dryRun ? '[Probelauf] ' : ''}${email} (${uid}): Noten ${currentCoins} -> ${targetCoins} (${delta >= 0 ? '+' : ''}${delta}), ${ALL_MODES.length} Modi, alle Genre-Pakete, alle Features`);
  if (dryRun) continue;

  await profileRef.update({ coins: targetCoins, unlocked });
  if (delta !== 0) {
    await db.ref(`users/${uid}/coinHistory`).push({ ts: Date.now(), amount: delta, reason: 'Demo-Konto Ausstattung (App Review)', balance: targetCoins });
  }
  console.log('  ✓ gespeichert');
}
process.exit(0);
