import { useState } from 'react'
import AIMixMode from './components/AIMixMode'
import './App.css'

// Mock Spotify API für ersten Test
const mockSpotifyAPI = {
  search: async (query, type, limit) => {
    console.log('Spotify Mock Search:', query);
    
    // Simuliere Spotify Response
    return {
      tracks: {
        items: [{
          id: 'mock-' + Math.random(),
          name: 'Test Song',
          artists: [{ name: 'Test Artist' }],
          album: { 
            images: [{ url: 'https://via.placeholder.com/300' }] 
          },
          preview_url: 'https://example.com/preview.mp3'
        }]
      }
    };
  }
};

const mockLastfmAPI = {};

function App() {
  const [showAIMode, setShowAIMode] = useState(false);

  if (showAIMode) {
    return (
      <AIMixMode
        spotifyAPI={mockSpotifyAPI}
        lastfmAPI={mockLastfmAPI}
        onStartGame={(config) => {
          console.log('Quiz würde starten mit:', config);
          alert(`Playlist "${config.playlist.name}" erstellt!\n${config.playlist.songs.length} Songs bereit.`);
        }}
        onBack={() => setShowAIMode(false)}
      />
    );
  }

  return (
    <div style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      flexDirection: 'column',
      gap: '2rem',
      background: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)',
      color: 'white'
    }}>
      <h1 style={{ fontSize: '3rem', margin: 0 }}>🎵 HITLINE</h1>
      <p style={{ fontSize: '1.2rem', opacity: 0.8 }}>Jeder Song hat seine Zeit</p>
      
      <button
        onClick={() => setShowAIMode(true)}
        style={{
          padding: '1.5rem 3rem',
          fontSize: '1.5rem',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          border: 'none',
          borderRadius: '15px',
          color: 'white',
          cursor: 'pointer',
          fontWeight: 'bold',
          boxShadow: '0 10px 30px rgba(102, 126, 234, 0.4)',
          transition: 'transform 0.3s'
        }}
        onMouseOver={(e) => e.target.style.transform = 'translateY(-5px)'}
        onMouseOut={(e) => e.target.style.transform = 'translateY(0)'}
      >
        🤖 KI-Mix testen
      </button>
      
      <p style={{ fontSize: '0.9rem', opacity: 0.6, marginTop: '2rem' }}>
        Beschreibe deine Traumplaylist - KI erstellt sie
      </p>
    </div>
  );
}

export default App;