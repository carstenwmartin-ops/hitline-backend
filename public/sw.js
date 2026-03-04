// Hitline Service Worker
// Strategie: Cache-First für Assets, Network-First für API-Calls

const CACHE_NAME = 'hitline-v1';
const STATIC_CACHE = 'hitline-static-v1';
const API_CACHE = 'hitline-api-v1';

// Externe Libraries die gecacht werden
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js',
];

// ===== INSTALL: Statische Assets vorcachen =====
self.addEventListener('install', (event) => {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      // Graceful: schlägt einzelne fehl → trotzdem installieren
      return Promise.allSettled(
        PRECACHE_URLS.map(url => cache.add(url).catch(() => null))
      );
    }).then(() => self.skipWaiting())
  );
});

// ===== ACTIVATE: Alte Caches aufräumen =====
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate');
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== API_CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ===== FETCH: Intelligente Cache-Strategie =====
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Firebase & externe APIs: immer Network, kein Cache
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('firebaseio') ||
    url.hostname.includes('googleapis') ||
    url.pathname.includes('/api/') ||
    url.hostname.includes('last.fm') ||
    url.hostname.includes('musicbrainz') ||
    event.request.method !== 'GET'
  ) {
    return; // Browser übernimmt (kein Cache)
  }

  // Audio-Streams: nie cachen (zu groß, dynamisch)
  if (
    url.pathname.match(/\.(mp3|m4a|ogg|aac|wav)$/i) ||
    url.hostname.includes('audio') ||
    url.hostname.includes('stream')
  ) {
    return;
  }

  // Cover-Bilder: Cache-First mit Fallback
  if (
    url.hostname.includes('lastfm') ||
    url.hostname.includes('coverartarchive') ||
    url.pathname.match(/\.(jpg|jpeg|png|webp|gif)$/i)
  ) {
    event.respondWith(
      caches.open(API_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          }).catch(() => cached || new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  // Statische Assets (JS, CSS, Fonts): Cache-First
  if (
    url.pathname.match(/\.(js|css|woff|woff2|ttf)$/i) ||
    url.hostname.includes('cdn.') ||
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('jsdelivr') ||
    url.hostname.includes('fonts.googleapis') ||
    url.hostname.includes('fonts.gstatic')
  ) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  // Hauptseite (/): Network-First, Fallback auf Cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          caches.open(STATIC_CACHE).then(cache =>
            cache.put(event.request, response.clone())
          );
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(cached =>
          cached || caches.match('/') // Fallback auf gecachte Startseite
        )
      )
  );
});

// ===== UPDATE-Benachrichtigung an App =====
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
