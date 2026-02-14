import React, { useState } from 'react';
import { AIPlaylistGenerator, HITLINEWithAI } from "../utils/ai-playlist-generator.js";
import './AIMixMode.css';

const AIMixMode = ({ 
  spotifyAPI, 
  lastfmAPI, 
  onStartGame, 
  onBack 
}) => {
  const [step, setStep] = useState('input'); // 'input', 'generating', 'preview', 'playing'
  const [userPrompt, setUserPrompt] = useState('');
  const [songCount, setSongCount] = useState(20);
  const [playlist, setPlaylist] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [suggestions] = useState([
    '🎸 Rock-Klassiker der 70er und 80er',
    '💃 Tanzbare Pop-Hits aus den 2000ern',
    '🌙 Melancholische Indie-Songs für regnerische Tage',
    '⚡ Energiegeladene Workout-Musik',
    '🎭 Soundtrack-Highlights aus Filmen',
    '🌈 Pride Anthems durch die Jahrzehnte',
    '🎹 Piano-Balladen die berühren',
    '🔥 Hip-Hop Klassiker der 90er',
    '🌊 Sommerlieder mit guter Laune',
    '🎺 Jazz-Standards für Kenner',
    '🤘 Metal-Hymnen die rocken',
    '🎤 Girlpower Anthems'
  ]);

  // Initialize AI - In production würde der API Key aus env kommen
  const claudeAPIKey = import.meta?.env?.VITE_CLAUDE_API_KEY || '';
console.log('🔑 API Key Check:', claudeAPIKey ? 'KEY GEFUNDEN ✅' : 'KEY FEHLT ❌');
console.log('🔑 Full env:', import.meta.env);

  const handleGenerate = async () => {
    if (!userPrompt.trim()) {
      setError('Bitte beschreibe deine gewünschte Playlist');
      return;
    }

    if (!claudeAPIKey) {
      setError('Claude API Key fehlt. Bitte in .env setzen: VITE_CLAUDE_API_KEY');
      return;
    }

    setLoading(true);
    setError(null);
    setStep('generating');

    try {
      const hitlineAI = new HITLINEWithAI(
        spotifyAPI,
        lastfmAPI,
        claudeAPIKey
      );

      const result = await hitlineAI.createAIPlaylist(userPrompt, songCount);
      
      if (result.error) {
        throw new Error(result.error);
      }

      if (result.songs.length < 10) {
        throw new Error('Zu wenige Songs gefunden. Versuche eine andere Beschreibung.');
      }

      setPlaylist(result);
      setStep('preview');
      
    } catch (err) {
      console.error('Playlist generation error:', err);
      setError(err.message || 'Fehler bei der Playlist-Generierung');
      setStep('input');
    } finally {
      setLoading(false);
    }
  };

  const handleStartQuiz = () => {
    setStep('playing');
    onStartGame({
      mode: 'ai-mix',
      playlist: playlist,
      settings: {
        songCount: playlist.songs.length,
        difficulty: playlist.difficulty,
        aiGenerated: true,
        originalPrompt: userPrompt
      }
    });
  };

  const handleUseSuggestion = (suggestion) => {
    setUserPrompt(suggestion.replace(/^[🎸💃🌙⚡🎭🌈🎹🔥🌊🎺🤘🎤]\s*/, ''));
  };

  const handleBack = () => {
    if (step === 'preview') {
      setStep('input');
      setPlaylist(null);
    } else {
      onBack();
    }
  };

  return (
    <div className="ai-mix-mode">
      {/* Header */}
      <div className="mode-header rainbow-glow-border">
        <button onClick={handleBack} className="back-btn">
          ← Zurück
        </button>
        <div className="header-content">
          <h1 className="mode-title">
            <span className="mode-icon">🤖</span>
            KI-Mix
          </h1>
          <p className="mode-tagline">Deine Musik, von KI kuratiert</p>
        </div>
      </div>

      {/* Input Step */}
      {step === 'input' && (
        <div className="input-container">
          <div className="input-card rainbow-glow-border">
            <div className="input-card-content">
              <h2>Beschreibe deine Traumplaylist</h2>
              
              <textarea
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                placeholder="z.B.: Energiegeladene Rock-Songs der 90er mit weiblichen Vocals und Gitarren-Soli"
                className="ai-input"
                rows="4"
                maxLength="300"
              />
              
              <div className="char-counter">
                {userPrompt.length}/300 Zeichen
              </div>

              <div className="song-count-selector">
                <label>Anzahl Songs:</label>
                <div className="count-buttons">
                  {[10, 15, 20, 25, 30].map(count => (
                    <button
                      key={count}
                      className={`count-btn ${songCount === count ? 'active' : ''}`}
                      onClick={() => setSongCount(count)}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div className="error-message">
                  ⚠️ {error}
                </div>
              )}

              <button 
                onClick={handleGenerate}
                disabled={loading || !userPrompt.trim()}
                className="generate-btn"
              >
                {loading ? (
                  <>
                    <span className="spinner">🎵</span>
                    Generiere Playlist...
                  </>
                ) : (
                  <>✨ Playlist erstellen</>
                )}
              </button>
            </div>
          </div>

          {/* Suggestions */}
          <div className="suggestions-section">
            <h3>💡 Inspirationen</h3>
            <div className="suggestions-grid">
              {suggestions.map((suggestion, idx) => (
                <button
                  key={idx}
                  className="suggestion-card"
                  onClick={() => handleUseSuggestion(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Generating Step */}
      {step === 'generating' && (
        <div className="generating-container">
          <div className="generating-animation">
            <div className="music-notes">
              <span className="note">🎵</span>
              <span className="note">🎶</span>
              <span className="note">🎵</span>
            </div>
            <h2>KI erstellt deine Playlist...</h2>
            <p>Durchsuche Millionen von Songs</p>
            <div className="progress-bar">
              <div className="progress-fill"></div>
            </div>
          </div>
        </div>
      )}

      {/* Preview Step */}
      {step === 'preview' && playlist && (
        <div className="preview-container">
          <div className="playlist-header">
            <h2 className="playlist-name">{playlist.name}</h2>
            <p className="playlist-description">{playlist.description}</p>
            
            <div className="playlist-meta">
              <span className="meta-item">
                🎵 {playlist.totalSongs} Songs
              </span>
              <span className="meta-item difficulty">
                {playlist.difficulty === 'easy' && '⭐ Leicht'}
                {playlist.difficulty === 'medium' && '⭐⭐ Mittel'}
                {playlist.difficulty === 'hard' && '⭐⭐⭐ Schwer'}
              </span>
            </div>

            {playlist.tags && (
              <div className="tags">
                {playlist.tags.map((tag, idx) => (
                  <span key={idx} className="tag">{tag}</span>
                ))}
              </div>
            )}
          </div>

          <div className="song-list-preview">
            {playlist.songs.slice(0, 10).map((song, idx) => (
              <div key={idx} className="song-preview-card">
                {song.albumArt && (
                  <img 
                    src={song.albumArt} 
                    alt={song.title}
                    className="album-art"
                  />
                )}
                <div className="song-info">
                  <div className="song-title">{song.title}</div>
                  <div className="song-artist">{song.artist}</div>
                  <div className="song-year">{song.year}</div>
                  {song.aiReason && (
                    <div className="ai-reason">
                      💡 {song.aiReason}
                    </div>
                  )}
                </div>
              </div>
            ))}
            
            {playlist.songs.length > 10 && (
              <div className="more-songs">
                + {playlist.songs.length - 10} weitere Songs
              </div>
            )}
          </div>

          <div className="action-buttons">
            <button 
              onClick={() => setStep('input')}
              className="secondary-btn"
            >
              Neue Playlist
            </button>
            <button 
              onClick={handleStartQuiz}
              className="start-btn rainbow-glow"
            >
              Quiz starten 🎮
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AIMixMode;
