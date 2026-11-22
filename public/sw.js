/**
 * SignClear service worker — cache-first app shell (plain script, no build step).
 *
 * Registered by ./js/ui/install.js. Policy:
 *   - GET only; everything else passes through untouched.
 *   - '/api/' is NEVER cached and never intercepted — server functions stay live.
 *   - Same-origin navigations/assets: cache-first, then network (successful
 *     responses are cloned into the cache), with './index.html' as the offline
 *     navigation fallback so a cold launch still boots the app.
 */

'use strict';

var CACHE_NAME = 'signclear-v1';

// Small, explicit shell list. './' and './index.html' are both cached so a
// navigation can be answered with either key.
var SHELL = [
  './',
  './index.html',
  './styles/tokens.css',
  './styles/app.css',
  './js/main.js',
  './mock-audit.json',
  './manifest.webmanifest',
  './icons/icon.svg',
];

var SW = self;

/* ── install: precache, tolerating individual failures ───────────────────── */

function precache() {
  return caches.open(CACHE_NAME).then(function (cache) {
    // addAll is atomic-ish and fast; if any single URL 404s it rejects wholesale,
    // so fall back to per-entry adds and keep whatever succeeded.
    return cache.addAll(SHELL).catch(function () {
      return Promise.allSettled(
        SHELL.map(function (url) {
          return cache.add(url);
        })
      );
    });
  });
}

SW.addEventListener('install', function (event) {
  event.waitUntil(
    precache()
      .catch(function () {
        /* a cache miss at install time must never block activation */
      })
      .then(function () {
        return SW.skipWaiting();
      })
  );
});

/* ── activate: drop stale cache versions, take over open clients ─────────── */

SW.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names.map(function (name) {
            return name === CACHE_NAME ? null : caches.delete(name);
          })
        );
      })
      .then(function () {
        return SW.clients.claim();
      })
  );
});

/* ── fetch: cache-first for the shell, straight to network for the API ───── */

function isApiRequest(url) {
  return url.pathname.indexOf('/api/') === 0;
}

function cachePut(cache, request, response) {
  // Never fail the response because the cache fill failed (quota, opaque, etc.).
  var copy = response.clone();
  var put = cache.put(request, copy);
  if (put && typeof put.catch === 'function') put.catch(function () {});
}

function offlineFallback(cache) {
  return cache.match('./index.html').then(function (hit) {
    return hit || cache.match('./');
  });
}

function handle(request) {
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(request).then(function (cached) {
      if (cached) return cached;

      return fetch(request).then(
        function (response) {
          if (response && response.ok) cachePut(cache, request, response);
          return response;
        },
        function (error) {
          if (request.mode === 'navigate') {
            return offlineFallback(cache).then(function (fallback) {
              if (fallback) return fallback;
              throw error;
            });
          }
          throw error;
        }
      );
    });
  });
}

SW.addEventListener('fetch', function (event) {
  var request = event.request;

  if (request.method !== 'GET') return;

  var url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }

  // Live server functions: let the browser talk to the network directly.
  if (isApiRequest(url)) return;

  // Third-party origins are none of this worker's business.
  if (url.origin !== SW.location.origin) return;

  event.respondWith(handle(request));
});
