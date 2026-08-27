import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import http2 from 'http2';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// API Key (OpenRouter)
const apiKey = process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  console.error('❌ OPENROUTER_API_KEY nicht gefunden!');
  process.exit(1);
}

console.log('✅ OpenRouter API Key geladen:', apiKey.substring(0, 20) + '...');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
// Webhook braucht Raw Body — JSON-Parser nur für alle anderen Routen
app.use((req, res, next) => {
  if (req.path === '/api/stripe-webhook') return next();
  express.json()(req, res, next);
});

// Hilfsfunktion: Prompt bereinigen (Umlaute etc.)
const sanitizePrompt = (prompt) => prompt
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
  .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
  .replace(/ß/g, 'ss')
  .replace(/[^\x00-\x7F]/g, '');

// Hilfsfunktion: LLM via OpenRouter aufrufen (OpenAI-kompatibel)
// temperature optional niedrig ansetzen für faktenkritische Aufgaben (reduziert Halluzinationen)
const callClaude = async (system, userContent, maxTokens = 2000, temperature) => {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://hitlines-song2flow-fri3nds.netlify.app',
      'X-Title': 'Hitlines Songflow'
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4-5',
      max_tokens: maxTokens,
      ...(temperature !== undefined && { temperature }),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent }
      ]
    })
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(`OpenRouter ${response.status}: ${JSON.stringify(err)}`);
  }
  const data = await response.json();
  return data.choices[0].message.content
    .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
};

// =====================================================================
// ROUTE 1: Kleine Playlist (30 Künstler)
// =====================================================================
app.post('/api/hitline-playlist', async (req, res) => {
  const { prompt, songCount } = req.body;
  console.log('🎵 Kleine Playlist für:', prompt);

  try {
    const cleanPrompt = sanitizePrompt(prompt);

    const content = await callClaude(
      'Du bist ein Musik-Experte. Erstelle eine Playlist als JSON-Objekt. WICHTIG: Antworte NUR mit JSON, keine Markdown-Bloecke! Format: {"playlistName": "Name", "description": "Beschreibung", "artists": ["Kuenstler1", "Kuenstler2"], "difficulty": "medium", "tags": ["tag1"]}. Gib NUR Kuenstlernamen zurueck, KEINE Song-Titel. Waehle bekannte Kuenstler die zum Thema passen.',
      `Erstelle eine Liste mit ${songCount} Kuenstlern fuer: ${cleanPrompt}`,
      4000
    );

    const aiPlaylist = JSON.parse(content);
    console.log('✅', aiPlaylist.playlistName, '–', aiPlaylist.artists?.length, 'Künstler');

    res.json({
      success: true,
      playlist: {
        name: aiPlaylist.playlistName,
        description: aiPlaylist.description,
        type: 'artists',
        artists: aiPlaylist.artists || [],
        aiGenerated: true,
        tags: aiPlaylist.tags || [],
        difficulty: aiPlaylist.difficulty || 'medium'
      }
    });
  } catch (error) {
    console.error('❌', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================================
// ROUTE 2: Große Künstler-Playlist (bis 150 Künstler in Batches)
// =====================================================================
app.post('/api/hitline-playlist-large', async (req, res) => {
  const { prompt, totalCount } = req.body;
  const target = Math.min(Math.max(parseInt(totalCount) || 75, 10), 150); // ← 150 max
  console.log(`🎵 Große Künstler-Playlist: "${prompt}" → ${target} Künstler`);

  try {
    const cleanPrompt = sanitizePrompt(prompt);
    const allArtists = [];
    const batchSize = 30;
    const batches = Math.ceil(target / batchSize);

    for (let i = 0; i < batches; i++) {
      const currentBatchSize = Math.min(batchSize, target - allArtists.length);
      if (currentBatchSize <= 0) break;

      const excludeList = allArtists.length > 0
        ? `\n\nBereits verwendet (NICHT wiederholen): ${allArtists.join(', ')}`
        : '';

      const content = await callClaude(
        'Du bist ein Musik-Experte. Erstelle eine Liste von Kuenstlern als JSON-Objekt. WICHTIG: Antworte NUR mit JSON, keine Markdown-Bloecke! Format: {"artists": ["Kuenstler1", "Kuenstler2"]}. Gib NUR Kuenstlernamen zurueck, KEINE Song-Titel. Waehle bekannte, unterschiedliche Kuenstler. KEINE Duplikate!',
        `Erstelle eine Liste mit ${currentBatchSize} verschiedenen Kuenstlern fuer: ${cleanPrompt}${excludeList}`
      );

      const batch = JSON.parse(content);
      if (batch.artists && Array.isArray(batch.artists)) {
        const newArtists = batch.artists.filter(a => !allArtists.includes(a));
        allArtists.push(...newArtists);
        console.log(`  Batch ${i + 1}/${batches}: +${newArtists.length} → gesamt ${allArtists.length}`);
      }

      if (i < batches - 1) await new Promise(r => setTimeout(r, 500));
    }

    const playlistName = `${cleanPrompt.charAt(0).toUpperCase() + cleanPrompt.slice(1)} Megamix`;
    console.log(`✅ ${allArtists.length} Künstler fertig`);

    res.json({
      success: true,
      playlist: {
        name: playlistName,
        description: `Eine umfassende Sammlung von ${allArtists.length} Künstlern zum Thema: ${cleanPrompt}`,
        type: 'artists',
        artists: allArtists,
        aiGenerated: true,
        tags: [cleanPrompt.split(' ')[0]],
        difficulty: 'medium'
      }
    });
  } catch (error) {
    console.error('❌', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================================
// ROUTE 3: Song-Playlist (Künstler + Titel, bis 150 Songs in Batches)
// =====================================================================
app.post('/api/hitline-playlist-tracks', async (req, res) => {
  const { prompt, totalCount } = req.body;
  const target = Math.min(Math.max(parseInt(totalCount) || 75, 10), 200);
  console.log(`🎵 Song-Playlist: "${prompt}" → ${target} Songs`);

  try {
    const cleanPrompt = sanitizePrompt(prompt);
    const allTracks = [];
    const batchSize = 40;
    const batches = Math.ceil(target / batchSize);

    for (let i = 0; i < batches; i++) {
      const currentBatchSize = Math.min(batchSize, target - allTracks.length);
      if (currentBatchSize <= 0) break;

      const excludeList = allTracks.length > 0
        ? `\n\nBEREITS VORHANDEN (nicht wiederholen):\n${allTracks.map(t => `- ${t.artist} - ${t.track}`).join('\n')}`
        : '';

      const content = await callClaude(
        'Du bist ein Musik-Experte. Erstelle eine Liste von Songs als JSON-Objekt. WICHTIG: Antworte NUR mit JSON, keine Markdown-Bloecke, kein ```json! Format: {"tracks": [{"artist": "Kuenstlername", "track": "Songtitel"}, ...]}. Gib nur bekannte, reale Songs zurueck die auf Streamingdiensten existieren. KEINE Duplikate! Nur das exakte JSON-Format ohne weiteren Text.',
        `Erstelle eine Liste mit exakt ${currentBatchSize} verschiedenen Songs fuer das Thema: ${cleanPrompt}${excludeList}`
      );

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        console.warn(`  ⚠️ JSON-Parse fehlgeschlagen Batch ${i + 1}`);
        continue;
      }

      for (const item of (parsed.tracks || [])) {
        if (!item.artist || !item.track) continue;
        const artist = String(item.artist).trim();
        const track  = String(item.track).trim();
        const isDuplicate = allTracks.some(
          t => t.artist.toLowerCase() === artist.toLowerCase() &&
               t.track.toLowerCase()  === track.toLowerCase()
        );
        if (!isDuplicate) allTracks.push({ artist, track });
      }

      console.log(`  Batch ${i + 1}/${batches}: gesamt ${allTracks.length} Songs`);
      if (i < batches - 1) await new Promise(r => setTimeout(r, 500));
    }

    allTracks.sort(() => Math.random() - 0.5);
    console.log(`✅ ${allTracks.length} Songs fertig`);

    res.json({
      success: true,
      playlist: {
        name: cleanPrompt.charAt(0).toUpperCase() + cleanPrompt.slice(1),
        description: `KI-kuratierte Song-Playlist: ${allTracks.length} Songs zum Thema „${cleanPrompt}"`,
        type: 'tracks',
        tracks: allTracks,
        artists: [],
        aiGenerated: true,
        tags: [cleanPrompt.split(' ')[0]],
        difficulty: 'medium'
      }
    });
  } catch (error) {
    console.error('❌', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/hitline-playlist-similar', async (req, res) => {
  const { seeds, totalCount } = req.body;
  const target = Math.min(Math.max(parseInt(totalCount) || 75, 10), 200);

  if (!seeds || !Array.isArray(seeds) || seeds.length === 0) {
    return res.status(400).json({ success: false, error: 'Keine Seed-Künstler angegeben' });
  }

  const cleanSeeds = seeds.map(s => String(s).trim()).filter(Boolean).slice(0, 10);
  const seedLabel = cleanSeeds.length === 1
    ? cleanSeeds[0]
    : `${cleanSeeds[0]} & ${cleanSeeds.length - 1} weitere`;

  console.log(`🔗 Similar-Playlist: Seeds=[${cleanSeeds.join(', ')}], Ziel: ${target} Künstler`);

  try {
    const allArtists = [];
    const batchSize = 40;
    const batches = Math.ceil(target / batchSize);

    for (let i = 0; i < batches; i++) {
      const currentBatchSize = Math.min(batchSize, target - allArtists.length);
      if (currentBatchSize <= 0) break;

      const excludeList = allArtists.length > 0
        ? `\n\nBereits verwendet (NICHT wiederholen): ${allArtists.join(', ')}`
        : '';

      const seedsFormatted = cleanSeeds.join(', ');

      const responseText = await callClaude(
        'Du bist ein Musik-Experte. Erstelle eine Liste von Kuenstlern als JSON-Objekt. WICHTIG: Antworte NUR mit JSON, keine Markdown-Bloecke! Format: {"artists": ["Kuenstler1", "Kuenstler2"]}. Gib NUR Kuenstlernamen zurueck, KEINE Song-Titel. Waehle bekannte, unterschiedliche Kuenstler. KEINE Duplikate!',
        `Erstelle eine Liste mit ${currentBatchSize} Kuenstlern die klanglich aehnlich sind wie: ${seedsFormatted}

Die Kuenstler sollen:
- Aehnlichen Stil, Genre oder Sound haben wie die genannten Kuenstler
- Real und bekannt sein (auf Streamingdiensten verfuegbar)
- Abwechslungsreich sein (nicht nur sehr offensichtliche Aehnlichkeiten)
- Die Seed-Kuenstler selbst NICHT enthalten${excludeList}`
      );

      let parsed;
      try {
        parsed = JSON.parse(responseText);
      } catch (e) {
        console.warn(`  ⚠️ JSON-Parse fehlgeschlagen Batch ${i + 1}`);
        continue;
      }

      if (parsed.artists && Array.isArray(parsed.artists)) {
        const newArtists = parsed.artists
          .map(a => String(a).trim())
          .filter(a => a && !allArtists.includes(a) && !cleanSeeds.some(s => s.toLowerCase() === a.toLowerCase()));
        allArtists.push(...newArtists);
        console.log(`  Batch ${i + 1}/${batches}: +${newArtists.length} → gesamt ${allArtists.length}`);
      }

      if (i < batches - 1) await new Promise(r => setTimeout(r, 500));
    }

    allArtists.sort(() => Math.random() - 0.5);
    console.log(`✅ Similar-Playlist fertig: ${allArtists.length} Künstler`);

    res.json({
      success: true,
      playlist: {
        name: `Ähnlich wie ${seedLabel}`,
        description: `${allArtists.length} Künstler ähnlich wie: ${cleanSeeds.join(', ')}`,
        type: 'artists',
        artists: allArtists,
        tracks: [],
        aiGenerated: true,
        tags: cleanSeeds.slice(0, 2),
        difficulty: 'medium'
      }
    });

  } catch (error) {
    console.error('❌ Similar-Playlist Fehler:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================================
// PWA: Statische Dateien (manifest, sw.js, icons)
// =====================================================================
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(join(__dirname, 'public', 'manifest.json'));
});

app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(join(__dirname, 'public', 'sw.js'));
});

app.use('/icons', express.static(join(__dirname, 'public', 'icons'), { maxAge: '7d' }));

// =====================================================================
// Sonstige Routen
// =====================================================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend läuft' });
});

// =====================================================================
// iTunes Proxy — umgeht Browser-seitige 403/Rate-Limit-Probleme
// GET /api/itunes-search?term=...
// =====================================================================
app.get('/api/itunes-search', async (req, res) => {
  const { term } = req.query;
  if (!term) return res.status(400).json({ error: 'term required' });
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=40`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'HitlineSongflow/1.0' }
    });
    if (!response.ok) {
      console.warn(`iTunes ${response.status} für "${term}"`);
      return res.json({ results: [] });
    }
    const data = await response.json();
    res.set('Cache-Control', 'public, max-age=3600'); // 1h cachen
    res.json(data);
  } catch (e) {
    console.warn(`iTunes-Proxy Fehler für "${term}":`, e.message);
    res.json({ results: [] });
  }
});

// =====================================================================
// MusicKit Developer Token — signiertes JWT fuer Apples Catalog Search API
// GET /api/musickit-token
//
// Das Token ist kein dauerhaftes Geheimnis (kurzlebiger Bearer-JWT nur fuer
// Katalog-Lesezugriffe), wird aber serverseitig signiert, weil der private
// Schluessel (.p8, ES256) nie im Client landen darf. Einmal signiert, bis kurz
// vor Ablauf im Prozessspeicher gecacht statt bei jeder Anfrage neu zu signieren.
// =====================================================================
let _musicKitTokenCache = { token: null, expiresAt: 0 };

const getMusicKitToken = () => {
  const now = Date.now();
  // Noch > 24h gueltig? Cache verwenden.
  if (_musicKitTokenCache.token && _musicKitTokenCache.expiresAt - now > 24 * 60 * 60 * 1000) {
    return _musicKitTokenCache.token;
  }
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_MUSICKIT_KEY_ID;
  const privateKeyRaw = process.env.APPLE_MUSICKIT_PRIVATE_KEY;
  if (!teamId || !keyId || !privateKeyRaw) {
    throw new Error('APPLE_TEAM_ID/APPLE_MUSICKIT_KEY_ID/APPLE_MUSICKIT_PRIVATE_KEY fehlen');
  }
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n');
  const expiresInSeconds = 180 * 24 * 60 * 60; // 180 Tage — sicher unter Apples 6-Monats-Maximum
  const token = jwt.sign({}, privateKey, {
    algorithm: 'ES256',
    keyid: keyId,
    issuer: teamId,
    expiresIn: expiresInSeconds,
  });
  _musicKitTokenCache = { token, expiresAt: now + expiresInSeconds * 1000 };
  return token;
};

app.get('/api/musickit-token', (req, res) => {
  try {
    const token = getMusicKitToken();
    res.set('Cache-Control', 'private, max-age=3600');
    res.json({ token });
  } catch (e) {
    console.error('MusicKit-Token Fehler:', e.message);
    res.status(500).json({ error: 'token unavailable' });
  }
});

app.get('/api/lastfm-similar', async (req, res) => {
  const { artist } = req.query;
  const lastfmApiKey = process.env.LASTFM_API_KEY;
  if (!lastfmApiKey) return res.status(500).json({ error: 'Last.fm API Key fehlt' });
  try {
    const response = await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(artist)}&api_key=${lastfmApiKey}&format=json&limit=10`
    );
    res.json(await response.json());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/config', (req, res) => {
  res.json({ firebaseApiKey: process.env.FIREBASE_API_KEY });
});

// =====================================================================
// ROUTE: Crossover-Modus — KI-Fakten für One Truth, Once Upon, More Hits
// =====================================================================
// BUGFIX: rief zuvor direkt api.anthropic.com mit dem OpenRouter-Key auf — schlug dadurch
// IMMER fehl (falscher Key-Typ für die native Anthropic-API), was den One-Truth-Fallback auf
// "Quiz" in JEDER Runde auslöste. Jetzt konsistent über OpenRouter wie callClaude().
const callClaudeHaiku = async (system, userContent, maxTokens = 400, temperature) => {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://hitlines-song2flow-fri3nds.netlify.app',
      'X-Title': 'Hitlines Songflow'
    },
    body: JSON.stringify({
      model: 'anthropic/claude-haiku-4-5',
      max_tokens: maxTokens,
      ...(temperature !== undefined && { temperature }),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent }
      ]
    })
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(`OpenRouter ${response.status}: ${JSON.stringify(err)}`);
  }
  const data = await response.json();
  return data.choices[0].message.content
    .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
};

app.post('/api/crossover-facts', async (req, res) => {
  const { title, artist, year, variant } = req.body;
  if (!title || !artist || !year || !variant) {
    return res.status(400).json({ error: 'title, artist, year, variant required' });
  }

  console.log(`🎯 Crossover [${variant}]: ${artist} – ${title} (${year})`);

  try {
    let content;

    // ── Variante 3: One Truth ──────────────────────────────────────────
    if (variant === 'one-truth') {
      content = await callClaudeHaiku(
        'Du bist ein Musik-Quiz-Experte. Antworte NUR mit validem JSON, keine Markdown-Bloecke, kein erklaerenden Text.',
        `Song: "${title}" von "${artist}" (${year}).

Erstelle ein schwieriges Quiz: Eine echte, nicht-offensichtliche Aussage + drei ueberzeugend klingende Blueffs.

REGELN fuer die WAHRE Aussage (truth):
- Darf NICHT den Kuenstlernamen, den Songtitel oder das Jahr direkt enthalten – diese sind dem Spieler bereits bekannt!
- Soll einen nicht-offensichtlichen Fakt nennen: z.B. Chartplatzierung, Produzent, Sample-Quelle, Label, Co-Autor, Musikvideo-Detail, Award, Entstehungsgeschichte, Instrumental-Besonderheit
- Falls kein spezifischer Fakt bekannt ist: nenne eine echte Aussage zum Genre, zur Stilaera oder zum Musikmarkt des Jahres ${year}
- Max 20 Woerter, knackig formuliert

REGELN fuer die BLUFFS:
- Sollen plausibel und verfuehrerisch klingen – nicht sofort als falsch erkennbar
- Koennen frei erfunden sein, sollen aber wie echte Musik-Facts wirken
- Kein offensichtlicher Bezug zum Kuenstlernamen oder Songtitel

Format: {"truth": "...", "bluffs": ["...", "...", "..."], "correctIndex": 0, "explanation": "Kurze Erklaerung warum die Wahrheit stimmt (max 2 Saetze)."}
correctIndex ist immer 0. Das Frontend shuffelt.`,
        600
      );

    // ── Variante 4: Once Upon a Time — Sonnet für Fakten-Genauigkeit ─────
    } else if (variant === 'once-upon') {
      const salts = ['A','B','C','D','E','F','G','H'];
      const salt = salts[Math.floor(Math.random() * salts.length)];
      content = await callClaude(
        'Du bist ein Musik-Historiker mit praezisem Faktenwissen. Faktentreue hat absolute Prioritaet vor Kreativitaet. Antworte NUR mit validem JSON, keine Markdown-Bloecke, kein Text ausserhalb des JSON.',
        `Jahr: ${year}. Salt: ${salt} (ignorieren, nur fuer Abwechslung).

Erstelle ein Quiz: Welcher Kuenstler hatte in ${year} KEINEN grossen Hit?

DREI echte Hits aus ${year} — HOECHSTE FAKTENTREUE ERFORDERLICH:
- Nenne drei Kuenstler/Bands mit einem Song, der in ${year} NACHWEISLICH in einer grossen, bekannten Hitparade platziert war (z.B. Billboard Hot 100, UK Singles Chart, deutsche Media-Control/GfK-Single-Charts) — keine obskuren Nischen- oder Regionalcharts
- Waehle nur Songs/Kuenstler, bei denen du dir zu 100% sicher bist. Bist du dir bei einem Fakt nicht absolut sicher, waehle stattdessen einen anderen, dir zweifelsfrei bekannten Song aus ${year}
- Der Song MUSS wirklich aus dem Jahr ${year} stammen (Erstveroeffentlichung/Charteinstieg), nicht aus einem Nachbarjahr
- Die Band/der Kuenstler muss ${year} bereits gegruendet/aktiv gewesen sein
- Gerne aus verschiedenen Genres (Rock, Pop, Soul, Country, Schlager, …) – muss aber nicht

EIN Fake:
- Ein Kuenstler, der in ${year} KEINEN charterfolgreichen Song hatte
- Kann eine spaeter beruehmt gewordene Band sein, die ${year} noch nicht existierte oder noch keine Hits hatte
- Nenne einen echten, zweifelsfrei belegten Song dieses Kuenstlers, aber aus einem anderen Jahr (realYear muss exakt korrekt sein!)
- KEINE erfundenen Songs oder Jahreszahlen! Bei Unsicherheit einen bekannteren Kuenstler/Song waehlen.

Format: {"hits": [{"artist": "Name", "song": "Titel", "year": ${year}}, {"artist": "Name", "song": "Titel", "year": ${year}}, {"artist": "Name", "song": "Titel", "year": ${year}}], "fake": {"artist": "Name", "song": "Echter Titel dieses Kuenstlers", "realYear": ZAHL}, "explanation": "1 Satz Erklaerung warum der Fake-Kuenstler ${year} keinen Hit hatte."}`,
        700,
        0.2
      );

    // ── Variante 5: More Hits — Sonnet für Fakten-Genauigkeit ────────────
    } else if (variant === 'more-hits') {
      content = await callClaude(
        'Du bist ein Musik-Historiker mit praezisem Faktenwissen. Faktentreue hat absolute Prioritaet vor Kreativitaet. Antworte NUR mit validem JSON, keine Markdown-Bloecke, kein Text ausserhalb des JSON.',
        `Kuenstler: "${artist}", Song: "${title}" (${year}).

Aufgabe: Welcher Song stammt wirklich von "${artist}"?

ECHTER Song (realSong) — HOECHSTE FAKTENTREUE ERFORDERLICH:
- Ein anderer bekannter, nachweislich existierender Song von "${artist}" – NICHT "${title}"
- Song und Jahreszahl muessen exakt korrekt sein – nichts erfinden, keine Verwechslung mit aehnlich klingenden Songs/Kuenstlern
- Waehle nur einen Song, bei dem du dir zu 100% sicher bist, dass er wirklich von "${artist}" stammt. Bist du dir unsicher, waehle stattdessen einen anderen, dir zweifelsfrei bekannten Song desselben Kuenstlers

DREI Fake-Songs (fakeSongs):
- Echte, bekannte Songs von ANDEREN, tatsaechlich existierenden Kuenstlern – keine erfundenen Titel
- Titel und Kuenstler muessen real existieren und korrekt zueinander passen (kein Verwechseln von Interpreten)
- Jahreszahl des jeweiligen Songs exakt korrekt angeben
- Bei Unsicherheit einen bekannteren, zweifelsfrei belegten Song waehlen statt zu raten

Format: {"realSong": {"title": "Echter Titel", "artist": "${artist}", "year": ZAHL}, "fakeSongs": [{"title": "Echter Titel", "artist": "Anderer Kuenstler", "year": ZAHL}, {"title": "Echter Titel", "artist": "Anderer Kuenstler", "year": ZAHL}, {"title": "Echter Titel", "artist": "Anderer Kuenstler", "year": ZAHL}], "explanation": "1 Satz Erklaerung."}`,
        600,
        0.2
      );

    } else {
      return res.status(400).json({ error: `Unbekannte Variante: ${variant}` });
    }

    const parsed = JSON.parse(content);
    console.log(`✅ Crossover [${variant}] generiert`);
    res.json({ success: true, variant, data: parsed });

  } catch (error) {
    console.error(`❌ Crossover Fehler [${variant}]:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================================
// STRIPE: Coin-Pakete kaufen
// =====================================================================
const COIN_PACKAGES = [
  { id: 'coins_40',  coins: 40,  price: 299,  name: '40 Noten',  currency: 'eur' },
  { id: 'coins_90_v2',  coins: 90,  price: 599,  name: '90 Noten',  currency: 'eur' },
  { id: 'coins_150', coins: 150, price: 899,  name: '150 Noten', currency: 'eur' },
  { id: 'coins_220', coins: 220, price: 1299, name: '220 Noten', currency: 'eur' },
  { id: 'coins_300', coins: 300, price: 1499, name: '300 Noten', currency: 'eur' },
];

// Hitlines-Premium-Abo-Produkte im Store (iOS/Android) — muss 1:1 mit den productId-Werten in
// src/data/premiumSubscription.js (Frontend) sowie den tatsaechlich in App Store Connect/Play
// Console angelegten Abo-Produkten uebereinstimmen.
const PREMIUM_SUBSCRIPTION_PRODUCT_IDS = ['hitlines_premium_monthly', 'hitlines_premium_yearly'];

// Firebase Admin initialisieren (nur wenn Credentials vorhanden)
let adminDb = null;
try {
  const { default: admin } = await import('firebase-admin');
  const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (saRaw && !admin.apps.length) {
    console.log('🔥 Firebase Service Account vorhanden, Länge:', saRaw.length);
    const serviceAccount = JSON.parse(saRaw);
    // private_key: Render.com kodiert \n manchmal als literal \\n
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: 'https://hitline-139be-default-rtdb.europe-west1.firebasedatabase.app',
    });
    adminDb = admin.database();
    console.log('🔥 Firebase Admin initialisiert ✅');
  } else if (!saRaw) {
    console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT nicht gesetzt');
  }
} catch (e) {
  console.error('❌ Firebase Admin Init Fehler:', e.message);
}

// =====================================================================
// APNs Push Notifications — signiertes Provider-JWT + HTTP/2-Versand
// POST /api/send-push
//
// Device-Tokens werden vom Client bei users/{uid}/profile.pushToken abgelegt
// (siehe App.jsx PushNotifications.addListener('registration', ...)). Dieser
// Endpunkt ist der generische Baustein zum tatsaechlichen Versenden — welche
// Ereignisse eine Push ausloesen (z.B. Multiplayer-Einladung, neue Themen),
// ist noch nicht verdrahtet und folgt als eigener Schritt.
//
// Provider-Token ist anders als der MusicKit-Token kurzlebig (Apple: max. 1h
// gueltig, Neuerstellung max. alle ~20min empfohlen) — daher kuerzeres Caching.
// APNs erfordert zwingend HTTP/2 (kein HTTP/1.1), daher Node's eingebautes
// http2-Modul statt fetch().
// =====================================================================
let _apnsTokenCache = { token: null, expiresAt: 0 };

const getApnsProviderToken = () => {
  const now = Date.now();
  if (_apnsTokenCache.token && _apnsTokenCache.expiresAt - now > 5 * 60 * 1000) {
    return _apnsTokenCache.token;
  }
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_PUSH_KEY_ID;
  const privateKeyRaw = process.env.APPLE_PUSH_PRIVATE_KEY;
  if (!teamId || !keyId || !privateKeyRaw) {
    throw new Error('APPLE_TEAM_ID/APPLE_PUSH_KEY_ID/APPLE_PUSH_PRIVATE_KEY fehlen');
  }
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n');
  const expiresInSeconds = 50 * 60; // 50 Minuten — unter Apples 1h-Maximum
  const token = jwt.sign({ iss: teamId, iat: Math.floor(now / 1000) }, privateKey, {
    algorithm: 'ES256',
    keyid: keyId,
  });
  _apnsTokenCache = { token, expiresAt: now + expiresInSeconds * 1000 };
  return token;
};

// Sandbox (Xcode-Debug-Builds/TestFlight-Entwicklung) vs. Production (App
// Store) sind bei APNs getrennte Endpunkte — der Key selbst deckt laut
// Portal-Konfiguration beide ab, die Umgebung wird hier ueber eine Env-Var
// gewaehlt, bis die App tatsaechlich im App Store ist (dann auf 'production'
// umstellen).
const sendApplePush = (deviceToken, { title, body }) => new Promise((resolve, reject) => {
  const host = process.env.APNS_ENVIRONMENT === 'production'
    ? 'https://api.push.apple.com'
    : 'https://api.sandbox.push.apple.com';
  const bundleId = process.env.APPLE_BUNDLE_ID || 'com.hitlines.songflow';

  let providerToken;
  try {
    providerToken = getApnsProviderToken();
  } catch (e) {
    reject(e);
    return;
  }

  const client = http2.connect(host);
  client.on('error', reject);

  const req = client.request({
    ':method': 'POST',
    ':path': `/3/device/${deviceToken}`,
    'authorization': `bearer ${providerToken}`,
    'apns-topic': bundleId,
    'apns-push-type': 'alert',
    'content-type': 'application/json',
  });

  let responseBody = '';
  let statusCode = null;
  req.setEncoding('utf8');
  req.on('response', (headers) => { statusCode = headers[':status']; });
  req.on('data', (chunk) => { responseBody += chunk; });
  req.on('end', () => {
    client.close();
    if (statusCode === 200) resolve({ success: true });
    else resolve({ success: false, status: statusCode, error: responseBody });
  });
  req.on('error', (err) => { client.close(); reject(err); });

  req.write(JSON.stringify({ aps: { alert: { title, body }, sound: 'default' } }));
  req.end();
});

// POST /api/send-push — { uid, title, body }
app.post('/api/send-push', async (req, res) => {
  const { uid, title, body } = req.body || {};
  if (!uid || !title || !body) return res.status(400).json({ error: 'uid, title und body erforderlich' });
  if (!adminDb) return res.status(500).json({ error: 'Firebase Admin nicht konfiguriert' });

  try {
    const snap = await adminDb.ref(`users/${uid}/profile/pushToken`).once('value');
    const deviceToken = snap.val();
    if (!deviceToken) return res.status(404).json({ error: 'Kein Push-Token fuer diesen Nutzer hinterlegt' });

    const result = await sendApplePush(deviceToken, { title, body });
    if (result.success) return res.json({ success: true });
    return res.status(502).json({ error: 'APNs lehnte die Zustellung ab', status: result.status, detail: result.error });
  } catch (e) {
    console.error('❌ Push-Versand Fehler:', e.message);
    res.status(500).json({ error: 'Push-Versand fehlgeschlagen' });
  }
});

// Hilfsfunktion: Pakete aus Firebase laden (oder Fallback)
const getCoinPackages = async () => {
  if (adminDb) {
    try {
      const snap = await adminDb.ref('config/coinPackages').once('value');
      const data = snap.val();
      if (data && Array.isArray(data) && data.length > 0) return data;
    } catch (e) { /* Fallback */ }
  }
  return COIN_PACKAGES;
};

// GET /api/coin-packages — Pakete für Frontend abrufen
app.get('/api/coin-packages', async (req, res) => {
  res.json(await getCoinPackages());
});

// POST /api/create-checkout — Stripe Checkout Session erstellen
app.post('/api/create-checkout', async (req, res) => {
  const { packageId, uid, successUrl, cancelUrl } = req.body;
  if (!packageId || !uid) return res.status(400).json({ error: 'packageId und uid erforderlich' });

  const packages = await getCoinPackages();
  const pkg = packages.find(p => p.id === packageId);
  if (!pkg) return res.status(400).json({ error: 'Unbekanntes Paket' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(500).json({ error: 'Stripe nicht konfiguriert' });

  try {
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(stripeKey);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: pkg.currency,
          product_data: { name: `Hitlines: ${pkg.name}`, description: `${pkg.coins} Noten für Hitlines: Songflow` },
          unit_amount: pkg.price,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: successUrl || 'https://hitlines-song2flow-fri3nds.netlify.app?payment=success',
      cancel_url: cancelUrl || 'https://hitlines-song2flow-fri3nds.netlify.app?payment=cancelled',
      metadata: { uid, packageId, coins: String(pkg.coins) },
    });

    console.log(`💳 Checkout erstellt: ${pkg.name} für uid=${uid}`);
    res.json({ url: session.url });
  } catch (e) {
    console.error('❌ Stripe Fehler:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// =====================================================================
// STRIPE: Hitlines Premium (Apple Music Premium Playlists) — Abo
// =====================================================================
// Reverse-Lookup Stripe-Customer-ID -> Firebase-uid. Noetig, weil die
// Subscription-Lifecycle-Events (customer.subscription.*) keine Checkout-
// Session-Metadata mehr mittragen, nur Customer-/Subscription-ID.
const linkStripeCustomer = async (customerId, uid) => {
  if (!adminDb || !customerId || !uid) return;
  await adminDb.ref(`stripeCustomerLinks/${customerId}`).set(uid);
};

const resolveUidByStripeCustomer = async (customerId) => {
  if (!adminDb || !customerId) return null;
  const snap = await adminDb.ref(`stripeCustomerLinks/${customerId}`).once('value');
  return snap.val();
};

const PREMIUM_PRICE_IDS = {
  monthly: () => process.env.STRIPE_PRICE_MONTHLY,
  yearly: () => process.env.STRIPE_PRICE_YEARLY,
};

// POST /api/create-subscription-checkout — Stripe Checkout Session fürs Abo erstellen
app.post('/api/create-subscription-checkout', async (req, res) => {
  const { plan, uid, email, successUrl, cancelUrl } = req.body || {};
  if (!plan || !uid) return res.status(400).json({ error: 'plan und uid erforderlich' });

  const priceId = PREMIUM_PRICE_IDS[plan]?.();
  if (!priceId) return res.status(400).json({ error: 'Unbekannter oder nicht konfigurierter Plan' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(500).json({ error: 'Stripe nicht konfiguriert' });
  if (!adminDb) return res.status(500).json({ error: 'Firebase nicht verfügbar' });

  try {
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(stripeKey);

    // Bestehenden Stripe-Customer für diesen uid wiederverwenden statt jedes Mal neu
    // anzulegen — wichtig fürs Billing Portal und für spätere Plan-Wechsel.
    const existingSnap = await adminDb.ref(`users/${uid}/profile/premiumSubscription/stripeCustomerId`).once('value');
    let customerId = existingSnap.val();
    if (!customerId) {
      const customer = await stripe.customers.create({ email: email || undefined, metadata: { uid } });
      customerId = customer.id;
      await linkStripeCustomer(customerId, uid);
    } else {
      // Verhindert doppelte Abos für denselben Kunden — Stripe erlaubt technisch beliebig
      // viele parallele Subscriptions pro Customer, das wuerde hier aber zu doppelter
      // Abrechnung fuehren. status:'all' + manuelle Filterung, da die List-API keine
      // Mehrfachauswahl von Status in einem Aufruf unterstuetzt.
      const existingSubs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
      const stillRelevant = existingSubs.data.some(s => ['active', 'trialing', 'past_due', 'unpaid'].includes(s.status));
      if (stillRelevant) {
        return res.status(409).json({ error: 'already_subscribed' });
      }
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: successUrl || 'https://hitlines-song2flow-fri3nds.netlify.app?subscription=success',
      cancel_url: cancelUrl || 'https://hitlines-song2flow-fri3nds.netlify.app?subscription=cancelled',
      metadata: { uid },
      subscription_data: { metadata: { uid } },
    });

    console.log(`💳 Abo-Checkout erstellt: ${plan} für uid=${uid}`);
    res.json({ url: session.url });
  } catch (e) {
    console.error('❌ Stripe Abo-Checkout Fehler:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/create-billing-portal-session — Stripe Customer Portal (Kündigung/Zahlungsmethode).
// Erfüllt die §312k-BGB-Pflicht zum leicht auffindbaren Kündigungsbutton über Stripes
// gehostete Oberfläche, ohne ein eigenes Kündigungs-UI bauen zu müssen.
app.post('/api/create-billing-portal-session', async (req, res) => {
  const { uid, returnUrl } = req.body || {};
  if (!uid) return res.status(400).json({ error: 'uid erforderlich' });
  if (!adminDb) return res.status(500).json({ error: 'Firebase nicht verfügbar' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(500).json({ error: 'Stripe nicht konfiguriert' });

  try {
    const snap = await adminDb.ref(`users/${uid}/profile/premiumSubscription/stripeCustomerId`).once('value');
    const customerId = snap.val();
    if (!customerId) return res.status(404).json({ error: 'Kein Stripe-Kunde für diesen Nutzer gefunden' });

    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(stripeKey);
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl || 'https://hitlines-song2flow-fri3nds.netlify.app',
    });
    res.json({ url: portalSession.url });
  } catch (e) {
    console.error('❌ Billing Portal Fehler:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/grant-complimentary — Familien-Befreiung vom Abo-Zwang (Admin-only).
// Client schickt sein Firebase-ID-Token mit; wird hier serverseitig verifiziert und auf
// die Admin-E-Mail geprüft (identische Regel wie die bestehenden Security-Rules für
// config/themes) — clientseitiges Schreiben auf ein fremdes users/{uid}/profile ist laut
// database.rules.json nicht erlaubt, daher zwingend über einen Admin-SDK-Endpoint.
app.post('/api/admin/grant-complimentary', async (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'Kein Auth-Token' });

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email erforderlich' });

  try {
    const { default: admin } = await import('firebase-admin');
    const decoded = await admin.auth().verifyIdToken(idToken);
    if (decoded.email !== 'carstenwmartin@gmail.com') {
      return res.status(403).json({ error: 'Nicht berechtigt' });
    }
    const targetUser = await admin.auth().getUserByEmail(email);
    if (!adminDb) return res.status(500).json({ error: 'Firebase nicht verfügbar' });
    const grant = !req.body?.revoke;
    await adminDb.ref(`users/${targetUser.uid}/profile`).update({ appleMusicComplimentary: grant });
    console.log(`${grant ? '🎁 Komplementär-Zugriff gewährt' : '🚫 Komplementär-Zugriff entzogen'}: ${email} (uid=${targetUser.uid})`);
    res.json({ success: true, uid: targetUser.uid, granted: grant });
  } catch (e) {
    console.error('❌ grant-complimentary Fehler:', e.message);
    if (e.code === 'auth/user-not-found') return res.status(404).json({ error: 'Kein Nutzer mit dieser E-Mail gefunden' });
    res.status(401).json({ error: 'Token ungültig oder abgelaufen' });
  }
});

// POST /api/account/delete — Konto vollständig löschen (Apple Guideline 5.1.1(v) / DSGVO Art. 17).
// Jeder eingeloggte Nutzer darf nur sein EIGENES Konto löschen — uid kommt ausschließlich aus dem
// verifizierten ID-Token, niemals aus dem Request-Body (sonst könnte ein Nutzer fremde Konten löschen).
// Reihenfolge bewusst: erst Stripe-Abo kündigen (sonst zahlt der Nutzer nach Löschung weiter, ohne
// Zugriff auf die App zu haben, um es selbst zu kündigen), dann Firebase-Daten, zuletzt der Auth-User
// selbst (erst nach erfolgreichem Datenaufräumen — verifyIdToken würde sonst bei einem Retry ins Leere laufen).
app.post('/api/account/delete', async (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'Kein Auth-Token' });

  try {
    const { default: admin } = await import('firebase-admin');
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    if (adminDb) {
      const customerId = (await adminDb.ref(`users/${uid}/profile/premiumSubscription/stripeCustomerId`).once('value')).val();
      const subscriptionId = (await adminDb.ref(`users/${uid}/profile/premiumSubscription/stripeSubscriptionId`).once('value')).val();
      const stripeKey = process.env.STRIPE_SECRET_KEY;

      if (subscriptionId && stripeKey) {
        try {
          const { default: Stripe } = await import('stripe');
          const stripe = new Stripe(stripeKey);
          await stripe.subscriptions.cancel(subscriptionId);
          console.log(`🗑️ Abo ${subscriptionId} wegen Konto-Löschung gekündigt (uid=${uid})`);
        } catch (e) {
          // Abo evtl. schon gekündigt/ausgelaufen — Löschung trotzdem fortsetzen
          console.warn(`⚠️ Abo-Kündigung bei Konto-Löschung fehlgeschlagen (uid=${uid}):`, e.message);
        }
      }

      if (customerId) {
        await adminDb.ref(`stripeCustomerLinks/${customerId}`).remove();
      }
      await adminDb.ref(`users/${uid}`).remove();
    }

    await admin.auth().deleteUser(uid);
    console.log(`🗑️ Konto gelöscht: uid=${uid}`);
    res.json({ success: true });
  } catch (e) {
    console.error('❌ Konto-Löschung Fehler:', e.message);
    res.status(401).json({ error: 'Token ungültig oder abgelaufen' });
  }
});

// POST /api/stripe-webhook — Zahlung bestätigen + Coins gutschreiben
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return res.status(500).json({ error: 'Webhook Secret fehlt' });

  let event;
  try {
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (e) {
    console.error('❌ Webhook Verifikation fehlgeschlagen:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    // Abo-Checkout: der eigentliche Status kommt gleich per customer.subscription.created
    // nach — hier reicht es, den Customer-Link sicherzustellen (falls create-subscription-
    // checkout ihn aus irgendeinem Grund noch nicht gesetzt hat). Kein Coins-Metadata-Pfad.
    if (session.mode === 'subscription') {
      const { uid } = session.metadata || {};
      if (uid && session.customer) await linkStripeCustomer(session.customer, uid);
      return res.json({ received: true });
    }

    const { uid, coins } = session.metadata || {};

    if (!uid || !coins) {
      console.error('❌ Fehlende Metadata in Session:', session.id);
      return res.status(400).json({ error: 'Fehlende Metadata' });
    }

    if (!adminDb) {
      console.error('❌ Firebase Admin nicht verfügbar');
      return res.status(500).json({ error: 'Firebase nicht verfügbar' });
    }

    try {
      const coinsToAdd = parseInt(coins, 10);
      const profileRef = adminDb.ref(`users/${uid}/profile`);
      await profileRef.transaction(profile => {
        if (!profile) return { coins: coinsToAdd, totalEarned: coinsToAdd };
        return {
          ...profile,
          coins: (profile.coins || 0) + coinsToAdd,
          totalEarned: (profile.totalEarned || 0) + coinsToAdd,
        };
      });
      console.log(`✅ ${coinsToAdd} Coins für uid=${uid} gutgeschrieben`);
      res.json({ received: true });
    } catch (e) {
      console.error('❌ Firebase Schreib-Fehler:', e.message);
      res.status(500).json({ error: e.message });
    }
  } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    const sub = event.data.object;
    const uid = sub.metadata?.uid || await resolveUidByStripeCustomer(sub.customer);
    if (!uid || !adminDb) return res.json({ received: true });

    try {
      const ref = adminDb.ref(`users/${uid}/profile/premiumSubscription`);
      // Kein lastEventCreated-Wächter mehr hier (frühere Version blockierte damit auch
      // manuelle Webhook-Resends aus dem Stripe-Dashboard — ein erneut zugestelltes Event
      // behält seinen ursprünglichen, alten event.created-Zeitstempel bei, sah für den
      // Wächter also fälschlich wie ein verspätetes altes Event aus und wurde ignoriert.
      // Der eigentliche Grund für den Wächter — mehrere parallele Subscriptions desselben
      // Kunden — ist inzwischen durch den 409-Schutz in create-subscription-checkout an der
      // Quelle verhindert; für den verbleibenden Deleted-Fall schützt stattdessen der
      // sub.id-Abgleich weiter unten.
      await ref.set({
        status: sub.status,
        provider: 'stripe',
        priceId: sub.items?.data?.[0]?.price?.id || null,
        currentPeriodEnd: sub.current_period_end ? sub.current_period_end * 1000 : null,
        willRenew: !sub.cancel_at_period_end,
        billingIssue: sub.status === 'past_due',
        stripeCustomerId: sub.customer,
        stripeSubscriptionId: sub.id,
        lastEventCreated: event.created,
      });
      console.log(`✅ Abo-Status aktualisiert: uid=${uid} status=${sub.status}`);
      res.json({ received: true });
    } catch (e) {
      console.error('❌ Abo-Sync Fehler:', e.message);
      res.status(500).json({ error: e.message });
    }
  } else if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const uid = sub.metadata?.uid || await resolveUidByStripeCustomer(sub.customer);
    if (!uid || !adminDb) return res.json({ received: true });

    try {
      const ref = adminDb.ref(`users/${uid}/profile/premiumSubscription`);
      const existing = (await ref.once('value')).val();
      // Falls der Kunde (z.B. durch den fruehereren Doppel-Abo-Bug) mehrere Subscriptions
      // hatte: nur die Kuendigung der Subscription anwenden, die aktuell als "die aktive"
      // hinterlegt ist. Sonst wuerde das Kuendigen einer alten Karteileiche faelschlich ein
      // noch aktives, anderes Abo desselben Kunden verdecken.
      if (existing?.stripeSubscriptionId && existing.stripeSubscriptionId !== sub.id) {
        console.log(`⏭️ Kuendigungs-Event fuer alte/andere Subscription ignoriert: uid=${uid}, event-sub=${sub.id}, aktuell hinterlegt=${existing.stripeSubscriptionId}`);
        return res.json({ received: true });
      }
      // Gesperrt statt gelöscht: bestehende Premium-Playlist-Einträge im Setlist Studio
      // bleiben sichtbar, nur der Spielstart mit ihnen wird ab jetzt wieder blockiert.
      await ref.update({
        status: 'canceled',
        willRenew: false,
        lastEventCreated: event.created,
      });
      console.log(`🔒 Abo beendet/gekündigt: uid=${uid}`);
      res.json({ received: true });
    } catch (e) {
      console.error('❌ Abo-Sync Fehler:', e.message);
      res.status(500).json({ error: e.message });
    }
  } else if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    const uid = await resolveUidByStripeCustomer(invoice.customer);
    if (uid && adminDb) {
      await adminDb.ref(`users/${uid}/profile/premiumSubscription`).update({ billingIssue: true }).catch(() => {});
      console.warn(`⚠️ Abo-Zahlung fehlgeschlagen: uid=${uid}`);
    }
    res.json({ received: true });
  } else {
    res.json({ received: true });
  }
});

// RevenueCat-Abo-Events (Hitlines Premium, iOS/Android) → dasselbe Firebase-Schema wie der
// Stripe-Webhook (users/{uid}/profile.premiumSubscription), damit hasAppleMusicPremiumAccess()
// im Frontend providerunabhaengig funktioniert. CANCELLATION heisst bei Apple/RevenueCat nur
// "Auto-Renew aus" — der Nutzer behaelt Zugriff bis currentPeriodEnd, deshalb bleibt status
// dabei 'active' und nur willRenew wird false. Erst EXPIRATION (nach Ablauf der Laufzeit) setzt
// status auf 'canceled', analog zu Stripes customer.subscription.deleted. app_user_id ist direkt
// die Firebase-uid (siehe ensureRevenueCatConfigured im Frontend) — kein Reverse-Lookup noetig.
const handleRevenueCatSubscriptionEvent = async (event, res) => {
  const uid = event.app_user_id;
  if (!uid || !adminDb) return res.json({ received: true });

  const ref = adminDb.ref(`users/${uid}/profile/premiumSubscription`);
  try {
    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'PRODUCT_CHANGE':
      case 'UNCANCELLATION':
        await ref.set({
          status: 'active',
          provider: 'revenuecat',
          priceId: event.product_id || null,
          currentPeriodEnd: event.expiration_at_ms || null,
          willRenew: true,
          billingIssue: false,
          store: event.store || null,
        });
        break;
      case 'CANCELLATION':
        await ref.update({ willRenew: false });
        break;
      case 'EXPIRATION':
        await ref.update({ status: 'canceled', willRenew: false });
        break;
      case 'BILLING_ISSUE':
        await ref.update({ billingIssue: true });
        break;
      default:
        // andere Event-Typen (TRANSFER, SUBSCRIPTION_PAUSED, ...) bewusst ignoriert
        break;
    }
    console.log(`✅ RevenueCat-Abo-Event ${event.type} verarbeitet (uid=${uid})`);
    res.json({ received: true });
  } catch (e) {
    console.error('❌ RevenueCat-Abo-Webhook Fehler:', e.message);
    res.status(500).json({ error: e.message });
  }
};

// POST /api/revenuecat-webhook — In-App-Kauf (iOS/Android) bestätigen: Coins (Einmalkauf) oder
// Hitlines-Premium-Abo. Auth per Authorization-Header (im RevenueCat-Dashboard selbst
// festgelegter Wert), kein HMAC noetig wie bei Stripe — RevenueCat sendet den Header-Wert 1:1 mit.
app.post('/api/revenuecat-webhook', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const webhookSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!webhookSecret) return res.status(500).json({ error: 'Webhook Secret fehlt' });
  if (authHeader !== webhookSecret) {
    console.error('❌ RevenueCat-Webhook: ungültiger Authorization-Header');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const event = req.body?.event;
  if (!event) return res.json({ received: true });

  if (PREMIUM_SUBSCRIPTION_PRODUCT_IDS.includes(event.product_id)) {
    return handleRevenueCatSubscriptionEvent(event, res);
  }

  if (event.type !== 'NON_RENEWING_PURCHASE') {
    // Andere Event-Typen (Abo-Lifecycle fuer unbekannte Produkte etc.) betreffen uns nicht.
    return res.json({ received: true });
  }

  const uid = event.app_user_id;
  const productId = event.product_id;
  const transactionId = event.transaction_id || event.id;
  if (!uid || !productId) {
    console.error('❌ RevenueCat-Webhook: fehlende uid/product_id im Event');
    return res.status(400).json({ error: 'Fehlende Event-Daten' });
  }

  const packages = await getCoinPackages();
  const pkg = packages.find(p => p.id === productId);
  if (!pkg) {
    console.error(`❌ RevenueCat-Webhook: unbekannte product_id "${productId}"`);
    return res.status(400).json({ error: 'Unbekanntes Produkt' });
  }

  if (!adminDb) {
    console.error('❌ Firebase Admin nicht verfügbar');
    return res.status(500).json({ error: 'Firebase nicht verfügbar' });
  }

  try {
    const coinsToAdd = pkg.coins;
    const profileRef = adminDb.ref(`users/${uid}/profile`);
    let alreadyProcessed = false;
    await profileRef.transaction(profile => {
      // RevenueCat stellt Events at-least-once zu — dieselbe Kauf-Transaktion kann
      // mehrfach ankommen. transaction_id gegen bereits verarbeitete IDs prüfen,
      // damit dieselbe Zahlung nicht doppelt gutgeschrieben wird (anders als beim
      // Stripe-Webhook, wo Redelivery in der Praxis kein Problem war).
      const processed = profile?.processedRevenueCatTransactions || {};
      if (transactionId && processed[transactionId]) {
        alreadyProcessed = true;
        return profile; // unverändert lassen
      }
      const nextProcessed = transactionId ? { ...processed, [transactionId]: true } : processed;
      if (!profile) return { coins: coinsToAdd, totalEarned: coinsToAdd, processedRevenueCatTransactions: nextProcessed };
      return {
        ...profile,
        coins: (profile.coins || 0) + coinsToAdd,
        totalEarned: (profile.totalEarned || 0) + coinsToAdd,
        processedRevenueCatTransactions: nextProcessed,
      };
    });
    if (alreadyProcessed) {
      console.log(`↩️ RevenueCat-Webhook: Transaktion ${transactionId} bereits verarbeitet, übersprungen`);
    } else {
      console.log(`✅ ${coinsToAdd} Coins (RevenueCat) für uid=${uid} gutgeschrieben`);
    }
    res.json({ received: true });
  } catch (e) {
    console.error('❌ Firebase Schreib-Fehler (RevenueCat-Webhook):', e.message);
    res.status(500).json({ error: e.message });
  }
});

// =====================================================================
// PROMO-CODES: Einmalige Noten-Gutschrift pro Account
// =====================================================================

// POST /api/redeem-promo — Promo-Code einlösen
app.post('/api/redeem-promo', async (req, res) => {
  const { uid, code } = req.body;
  if (!uid || !code) return res.status(400).json({ error: 'uid und code erforderlich' });
  if (!adminDb) return res.status(500).json({ error: 'Firebase nicht verfügbar' });

  const normalizedCode = String(code).trim().toUpperCase();

  try {
    const codeRef = adminDb.ref(`config/promoCodes/${normalizedCode}`);
    const snap = await codeRef.once('value');
    const promo = snap.val();

    if (!promo || !promo.active) {
      return res.status(404).json({ error: 'Code ungültig oder nicht mehr aktiv' });
    }
    if (promo.expiresAt && Date.now() > promo.expiresAt) {
      return res.status(400).json({ error: 'Code abgelaufen' });
    }
    if (promo.maxRedemptions && (promo.redeemedCount || 0) >= promo.maxRedemptions) {
      return res.status(400).json({ error: 'Code bereits ausgeschöpft' });
    }

    const coinsToAdd = promo.coins || 0;

    // Coins gutschreiben + Einlösung markieren — Check-and-Set ATOMAR innerhalb der Transaction,
    // damit zwei gleichzeitige Anfragen mit demselben Code nicht doppelt gutgeschrieben werden können.
    let alreadyRedeemed = false;
    const profileRef = adminDb.ref(`users/${uid}/profile`);
    await profileRef.transaction(profile => {
      const p = profile || {};
      const redeemed = p.redeemedPromoCodes || {};
      if (redeemed[normalizedCode]) {
        alreadyRedeemed = true;
        return; // abbrechen, nichts ändern
      }
      return {
        ...p,
        coins: (p.coins || 0) + coinsToAdd,
        totalEarned: (p.totalEarned || 0) + coinsToAdd,
        redeemedPromoCodes: { ...redeemed, [normalizedCode]: Date.now() },
      };
    });

    if (alreadyRedeemed) {
      return res.status(400).json({ error: 'Code wurde bereits eingelöst' });
    }

    // Globalen Einlösungszähler erhöhen (unkritisch, kein exaktes Atomic-Cap nötig)
    await codeRef.child('redeemedCount').transaction(n => (n || 0) + 1);

    console.log(`🎁 Promo-Code ${normalizedCode} eingelöst von uid=${uid} (+${coinsToAdd} Noten)`);
    res.json({ success: true, coinsAdded: coinsToAdd });
  } catch (e) {
    console.error('❌ Promo-Code Fehler:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend läuft auf Port ${PORT}`);
  console.log('📡 Endpoints:');
  console.log('   POST /api/hitline-playlist');
  console.log('   POST /api/hitline-playlist-large');
  console.log('   POST /api/hitline-playlist-tracks');
  console.log('   GET  /api/config');
  console.log('   GET  /api/lastfm-similar');
  console.log('   GET  /health');
});
