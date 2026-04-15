import express from 'express';
import cors from 'cors';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// API Key (einheitlich für alle Routen)
const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VITE_CLAUDE_API_KEY;

if (!apiKey) {
  console.error('❌ API Key nicht gefunden! Setze ANTHROPIC_API_KEY Environment Variable.');
  process.exit(1);
}

console.log('✅ API Key geladen:', apiKey.substring(0, 20) + '...');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Hilfsfunktion: Prompt bereinigen (Umlaute etc.)
const sanitizePrompt = (prompt) => prompt
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
  .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
  .replace(/ß/g, 'ss')
  .replace(/[^\x00-\x7F]/g, '');

// Hilfsfunktion: Claude API aufrufen
const callClaude = async (system, userContent, maxTokens = 2000) => {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userContent }]
    })
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Claude API ${response.status}: ${JSON.stringify(err)}`);
  }
  const data = await response.json();
  return data.content[0].text
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
const callClaudeHaiku = async (system, userContent, maxTokens = 400) => {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userContent }]
    })
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Claude API ${response.status}: ${JSON.stringify(err)}`);
  }
  const data = await response.json();
  return data.content[0].text
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

    // ── Variante 4: Once Upon a Time ──────────────────────────────────
    } else if (variant === 'once-upon') {
      content = await callClaudeHaiku(
        'Du bist ein Musik-Quiz-Experte. Antworte NUR mit validem JSON, keine Markdown-Bloecke.',
        `Jahr: ${year}. Song: "${title}" von "${artist}".
Erstelle ein Quiz: Drei bekannte Kuenstler, die ${year} tatsaechlich einen Hit hatten (mit echtem Song-Titel aus ${year}), und einen Kuenstler, der in ${year} KEINEN grossen Hit hatte (mit einem echten Song dieses Kuenstlers, aber aus einem anderen Jahr).
Format: {"hits": [{"artist": "Name", "song": "Titel", "year": ${year}}, {"artist": "Name", "song": "Titel", "year": ${year}}, {"artist": "Name", "song": "Titel", "year": ${year}}], "fake": {"artist": "Name", "song": "Titel", "realYear": 1999}, "explanation": "Kurze Erklaerung (1 Satz)."}`,
        500
      );

    // ── Variante 5: More Hits ──────────────────────────────────────────
    } else if (variant === 'more-hits') {
      content = await callClaudeHaiku(
        'Du bist ein Musik-Quiz-Experte. Antworte NUR mit validem JSON, keine Markdown-Bloecke.',
        `Kuenstler: "${artist}", Song: "${title}" (${year}).
Aufgabe: Welcher Song stammt von ${artist}?
Gib einen echten weiteren bekannten Song von "${artist}" (nicht "${title}") und drei bekannte Songs von ANDEREN Kuenstlern.
Format: {"realSong": {"title": "Anderer Song von ${artist}", "artist": "${artist}", "year": 2000}, "fakeSongs": [{"title": "Titel", "artist": "Anderer Kuenstler", "year": 2001}, {"title": "Titel", "artist": "Anderer Kuenstler", "year": 2002}, {"title": "Titel", "artist": "Anderer Kuenstler", "year": 2003}], "explanation": "Kurze Erklaerung (1 Satz)."}`,
        500
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
