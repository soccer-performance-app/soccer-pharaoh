// Pitch Condition — Service Worker
// Caches the app shell for offline access.
// Never caches API calls, auth, payment, or AI generation.

const CACHE_NAME = 'pitch-condition-v1';

// URLs that should never be served from cache — must hit the network.
const NETWORK_ONLY = [
  '/api/',
  'supabase.co',
  'stripe.com',
  'openrouter.ai',
  'api.stripe.com',
  'checkout.stripe.com'
];

// CDN origins to cache on first fetch.
const CACHE_CDN = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com'
];

// ── INSTALL ─────────────────────────────────────────────────────────────────
// Pre-cache the app shell so it loads instantly on repeat visits.
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(['/', '/index.html']);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE ────────────────────────────────────────────────────────────────
// Delete old caches when a new service worker takes over.
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(k) { return k !== CACHE_NAME; })
          .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── FETCH ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Always go to network for API calls, auth, and payment.
  if (NETWORK_ONLY.some(function(s) { return url.includes(s); })) {
    return; // let the browser handle it normally
  }

  // Cache-first for CDN assets (fonts, supabase-js, html2canvas).
  if (CACHE_CDN.some(function(o) { return url.includes(o); })) {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        if (cached) return cached;
        return fetch(e.request).then(function(response) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(c) { c.put(e.request, clone); });
          return response;
        });
      })
    );
    return;
  }

  // Network-first for everything else (HTML, icons, manifest).
  // Falls back to cache if offline.
  e.respondWith(
    fetch(e.request).then(function(response) {
      if (response.ok && e.request.method === 'GET') {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(c) { c.put(e.request, clone); });
      }
      return response;
    }).catch(function() {
      return caches.match(e.request).then(function(cached) {
        return cached || caches.match('/');
      });
    })
  );
});
