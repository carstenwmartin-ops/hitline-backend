import express from 'express';
import cors from 'cors';


// Lese API Key aus Environment Variables
const apiKey = process.env.VITE_CLAUDE_API_KEY;

if (!apiKey) {
  console.error('❌ API Key nicht gefunden! Setze VITE_CLAUDE_API_KEY Environment Variable.');
  process.exit(1);
}

console.log('✅ API Key geladen:', apiKey.substring(0, 20) + '...');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// ROUTE 1: HITLINE Playlist (Standard - 20-30 Künstler)
app.post('/api/hitline-playlist', async (req, res) => {
  const { prompt, songCount } = req.body;
  
  console.log('🎵 Generiere HITLINE-Playlist für:', prompt);
  
  try {
    // Sanitize prompt
    const cleanPrompt = prompt
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
      .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
      .replace(/ß/g, 'ss')
      .replace(/[^\x00-\x7F]/g, '');
    
    console.log('🎵 Bereinigt:', cleanPrompt);
    
    const requestBody = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: 'Du bist ein Musik-Experte. Erstelle eine Playlist als JSON-Objekt. WICHTIG: Antworte NUR mit JSON, keine Markdown-Bloecke! Format: {"playlistName": "Name", "description": "Beschreibung", "artists": ["Kuenstler1", "Kuenstler2", "Kuenstler3"], "difficulty": "medium", "tags": ["tag1"]}. Gib NUR Kuenstlernamen zurueck, KEINE Song-Titel. Waehle bekannte Kuenstler die zum Thema passen.',
      messages: [
        {
          role: 'user',
          content: `Erstelle eine Liste mit ${songCount} Kuenstlern fuer: ${cleanPrompt}`
        }
      ]
    };

    console.log('📤 Sende Request an Claude API...');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.log('❌ API Antwort:', JSON.stringify(errorData, null, 2));
      throw new Error(`API Error: ${response.status}`);
    }

    const data = await response.json();
    let content = data.content[0].text;
    
    console.log('📥 Rohe Antwort:', content.substring(0, 100) + '...');
    
    // Entferne Markdown Code-Blöcke
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    console.log('🧹 Bereinigt:', content.substring(0, 100) + '...');
    
    const aiPlaylist = JSON.parse(content);
    
    console.log('✅ Playlist generiert:', aiPlaylist.playlistName);
    console.log('   Künstler:', aiPlaylist.artists?.length || 0);
    
    // Konvertiere zu HITLINE Custom Playlist Format
    const hitlinePlaylist = {
      name: aiPlaylist.playlistName,
      description: aiPlaylist.description,
      type: 'artists',
      artists: aiPlaylist.artists || [],
      aiGenerated: true,
      tags: aiPlaylist.tags || [],
      difficulty: aiPlaylist.difficulty || 'medium'
    };
    
    console.log('✅ HITLINE-Format erstellt mit', hitlinePlaylist.artists.length, 'Künstlern');
    
    res.json({
      success: true,
      playlist: hitlinePlaylist
    });

  } catch (error) {
    console.error('❌ Fehler:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ROUTE 2: Große Playlists (100+ Künstler in Batches)
app.post('/api/hitline-playlist-large', async (req, res) => {
  const { prompt, totalCount } = req.body;
  
  console.log(`🎵 Generiere GROSSE Playlist für: ${prompt} (Ziel: ${totalCount} Künstler)`);
  
  try {
    // Sanitize prompt
    const cleanPrompt = prompt
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
      .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
      .replace(/ß/g, 'ss')
      .replace(/[^\x00-\x7F]/g, '');
    
    const allArtists = [];
    const batchSize = 30;
    const batches = Math.ceil(totalCount / batchSize);
    
    console.log(`📦 Generiere in ${batches} Batches (je ${batchSize} Künstler)...`);
    
    for (let i = 0; i < batches; i++) {
      const remaining = totalCount - allArtists.length;
      const currentBatchSize = Math.min(batchSize, remaining);
      
      console.log(`📤 Batch ${i + 1}/${batches}: Fordere ${currentBatchSize} Künstler an...`);
      
      const excludeList = allArtists.length > 0 
        ? `\n\nBereits verwendet (NICHT wiederholen): ${allArtists.join(', ')}`
        : '';
      
      const requestBody = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: 'Du bist ein Musik-Experte. Erstelle eine Liste von Kuenstlern als JSON-Objekt. WICHTIG: Antworte NUR mit JSON, keine Markdown-Bloecke! Format: {"artists": ["Kuenstler1", "Kuenstler2"]}. Gib NUR Kuenstlernamen zurueck, KEINE Song-Titel. Waehle bekannte, unterschiedliche Kuenstler. KEINE Duplikate!',
        messages: [
          {
            role: 'user',
            content: `Erstelle eine Liste mit ${currentBatchSize} verschiedenen Kuenstlern fuer: ${cleanPrompt}${excludeList}`
          }
        ]
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

      if (!response.ok) {
        const errorData = await response.json();
        console.log('❌ API Antwort:', JSON.stringify(errorData, null, 2));
        throw new Error(`API Error: ${response.status}`);
      }

      const data = await response.json();
      let content = data.content[0].text;
      
      content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      const batch = JSON.parse(content);
      
      if (batch.artists && Array.isArray(batch.artists)) {
        const newArtists = batch.artists.filter(a => !allArtists.includes(a));
        allArtists.push(...newArtists);
        console.log(`✅ Batch ${i + 1}: ${newArtists.length} neue Künstler (Gesamt: ${allArtists.length})`);
      }
      
      if (i < batches - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.log(`✅ Playlist komplett mit ${allArtists.length} Künstlern!`);
    
    const playlistName = `${cleanPrompt.charAt(0).toUpperCase() + cleanPrompt.slice(1)} Megamix`;
    
    const hitlinePlaylist = {
      name: playlistName,
      description: `Eine umfassende Sammlung von ${allArtists.length} Künstlern zum Thema: ${cleanPrompt}`,
      type: 'artists',
      artists: allArtists,
      aiGenerated: true,
      tags: [cleanPrompt.split(' ')[0]],
      difficulty: 'medium'
    };
    
    res.json({
      success: true,
      playlist: hitlinePlaylist
    });

  } catch (error) {
    console.error('❌ Fehler:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend läuft' });
});

// Last.fm Proxy Route
app.get('/api/lastfm-similar', async (req, res) => {
  const { artist } = req.query;
  
  const lastfmApiKey = process.env.LASTFM_API_KEY;
  
  if (!lastfmApiKey) {
    return res.status(500).json({ error: 'Last.fm API Key nicht konfiguriert' });
  }
  
  try {
    const response = await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(artist)}&api_key=${lastfmApiKey}&format=json&limit=10`
    );
    
    const data = await response.json();
    res.json(data);
    
  } catch (error) {
    console.error('Last.fm Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Firebase Route
app.get('/api/config', (req, res) => {
  res.json({ firebaseApiKey: process.env.FIREBASE_API_KEY });
});

app.listen(PORT, () => {
  console.log('🚀 Backend läuft auf http://localhost:' + PORT);
  console.log('📡 Endpoints:');
  console.log('   POST /api/hitline-playlist');
  console.log('   POST /api/hitline-playlist-large');
  console.log('   GET  /health');
});