/**
 * AI Playlist Generator für HITLINE Quiz Edition
 * Nutzt Claude API für intelligente Song-Auswahl
 */

class AIPlaylistGenerator {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.apiUrl = '/api/anthropic/v1/messages';
  }

  /**
   * Generiert Playlist basierend auf natürlichsprachiger Anfrage
   * @param {string} userPrompt - z.B. "80er Songs mit Saxophon"
   * @param {number} songCount - Anzahl gewünschter Songs
   * @returns {Promise<Object>} - Playlist mit Songs und Metadaten
   */
  async generatePlaylist(userPrompt, songCount = 20) {
  try {
    // Rufe Backend statt direkt API
    const response = await fetch('http://localhost:3001/api/generate-playlist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: userPrompt,
        songCount: songCount
      })
    });

    if (!response.ok) {
      throw new Error(`Backend Error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Unbekannter Fehler');
    }
    
    return {
      success: true,
      playlist: data.playlist,
      source: 'ai-generated'
    };

  } catch (error) {
    console.error('AI Playlist Generation Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

  /**
   * Erweitert bestehende Playlist mit ähnlichen Songs
   * @param {Array} existingArtists - Liste von Künstlern
   * @param {number} additionalCount - Anzahl neuer Songs
   */
  async expandPlaylist(existingArtists, additionalCount = 10) {
    const prompt = `Basierend auf diesen Künstlern: ${existingArtists.join(', ')}
    
Finde ${additionalCount} ähnliche Künstler/Songs die:
- Stilistisch passen
- Aus ähnlicher Ära stammen
- Für Musik-Quiz geeignet sind
- NICHT in der Original-Liste sind`;

    return this.generatePlaylist(prompt, additionalCount);
  }

  /**
   * Generiert Quiz-Hints für einen Song
   * @param {string} artist - Künstler
   * @param {string} track - Song-Titel
   * @param {number} year - Jahr
   */
  async generateHints(artist, track, year) {
    const prompt = `Erstelle 3 clevere Hints für diesen Song im Musik-Quiz:
Künstler: ${artist}
Song: ${track}
Jahr: ${year}

Antworte nur mit JSON:
{
  "hints": [
    {"level": "easy", "text": "Hint-Text"},
    {"level": "medium", "text": "Hint-Text"},
    {"level": "hard", "text": "Hint-Text"}
  ],
  "trivia": "Interessanter Fakt über den Song"
}

Hints sollten:
- Nicht den Titel oder Künstler nennen
- Progressiv schwieriger werden
- Kreativ und interessant sein`;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const data = await response.json();
      return JSON.parse(data.content[0].text);

    } catch (error) {
      console.error('Hint Generation Error:', error);
      return null;
    }
  }
}

// Integration in deine bestehende HITLINE-Architektur
class HITLINEWithAI {
  constructor(spotifyAPI, lastfmAPI, claudeAPIKey) {
    this.spotify = spotifyAPI;
    this.lastfm = lastfmAPI;
    this.aiGenerator = new AIPlaylistGenerator(claudeAPIKey);
  }

  /**
   * Kombiniert KI-Generierung mit Spotify-Validierung
   */
  async createAIPlaylist(userRequest, songCount = 20) {
    console.log('🤖 Generiere KI-Playlist...');
    
    // 1. KI generiert Song-Liste
    const aiResult = await this.aiGenerator.generatePlaylist(userRequest, songCount);
    
    if (!aiResult.success) {
      return { error: 'KI-Generierung fehlgeschlagen' };
    }

    const aiPlaylist = aiResult.playlist;
    console.log(`✅ KI hat "${aiPlaylist.playlistName}" erstellt`);

    // 2. Validiere Songs via Spotify
    const validatedSongs = [];
    
    for (const song of aiPlaylist.songs) {
      try {
        // Suche Song bei Spotify
        const spotifyResult = await this.spotify.search(
          `artist:${song.artist} track:${song.track}`,
          'track',
          1
        );

        if (spotifyResult.tracks.items.length > 0) {
          const track = spotifyResult.tracks.items[0];
          
          validatedSongs.push({
            artist: song.artist,
            title: song.track,
            year: song.year,
            spotifyId: track.id,
            previewUrl: track.preview_url,
            albumArt: track.album.images[0]?.url,
            aiReason: song.reason,
            validated: true
          });
        } else {
          console.warn(`⚠️ Song nicht gefunden: ${song.artist} - ${song.track}`);
        }
      } catch (error) {
        console.error(`Fehler bei: ${song.artist} - ${song.track}`, error);
      }
    }

    // 3. Erstelle HITLINE-kompatible Playlist
    return {
      name: aiPlaylist.playlistName,
      description: aiPlaylist.description,
      source: 'ai-generated',
      difficulty: aiPlaylist.difficulty,
      tags: aiPlaylist.tags,
      songs: validatedSongs,
      totalSongs: validatedSongs.length
    };
  }

  /**
   * Erweitere "My Favs" intelligent
   */
  async enhanceMyFavs(artistList) {
    console.log('🎵 Erweitere My Favs mit KI...');
    
    const expansion = await this.aiGenerator.expandPlaylist(artistList, 15);
    
    if (expansion.success) {
      return expansion.playlist.songs.map(s => s.artist);
    }
    
    return [];
  }
}

// Export für ES6 Module
export { AIPlaylistGenerator, HITLINEWithAI };
