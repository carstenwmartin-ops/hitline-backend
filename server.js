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

      const requestBody = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: 'Du bist ein Musik-Experte. Erstelle eine Liste von Kuenstlern als JSON-Objekt. WICHTIG: Antworte NUR mit JSON, keine Markdown-Bloecke! Format: {"artists": ["Kuenstler1", "Kuenstler2"]}. Gib NUR Kuenstlernamen zurueck, KEINE Song-Titel. Waehle bekannte, unterschiedliche Kuenstler. KEINE Duplikate!',
        messages: [{
          role: 'user',
          content: `Erstelle eine Liste mit ${currentBatchSize} Kuenstlern die klanglich aehnlich sind wie: ${seedsFormatted}

Die Kuenstler sollen:
- Aehnlichen Stil, Genre oder Sound haben wie die genannten Kuenstler
- Real und bekannt sein (auf Streamingdiensten verfuegbar)
- Abwechslungsreich sein (nicht nur sehr offensichtliche Aehnlichkeiten)
- Die Seed-Kuenstler selbst NICHT enthalten${excludeList}`
        }]
      };

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) throw new Error(`Claude API ${response.status}`);

      const claudeData = await response.json();
      let responseText = claudeData.content[0].text
        .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

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
  { id: 'coins_90',  coins: 90,  price: 599,  name: '90 Noten',  currency: 'eur' },
  { id: 'coins_150', coins: 150, price: 899,  name: '150 Noten', currency: 'eur' },
  { id: 'coins_220', coins: 220, price: 1199, name: '220 Noten', currency: 'eur' },
  { id: 'coins_300', coins: 300, price: 1499, name: '300 Noten', currency: 'eur' },
];

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
  } else {
    res.json({ received: true });
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
