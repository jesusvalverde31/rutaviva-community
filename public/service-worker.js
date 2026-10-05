'use strict';

const CACHE_PREFIX = 'rutaviva-shell-';
const CACHE_NAME = 'rutaviva-shell-v2';
const NETWORK_TIMEOUT_MS = 4000;
const SHELL_ASSETS = [
  '/offline.html',
  '/manifest.webmanifest',
  '/styles.css',
  '/app.js',
  '/contribution-recovery.mjs',
  '/map.js',
  '/vendor/maplibre/maplibre-gl.css',
  '/vendor/maplibre/maplibre-gl.mjs',
  '/vendor/maplibre/maplibre-gl-worker.mjs',
  '/vendor/maplibre/maplibre-gl-shared.mjs',
  '/icon-192.png',
  '/icon-512.png'
];
const CACHEABLE_PATHS = new Set(SHELL_ASSETS);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)))));
});

async function networkFirst(request, cacheKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (!response.ok) return response;
    if (cacheKey && response.type === 'basic') {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(cacheKey, response.clone());
    }
    return response;
  } catch {
    const fallback = await caches.match(cacheKey || '/offline.html');
    return fallback || Response.error();
  } finally {
    clearTimeout(timeout);
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, null));
    return;
  }

  if (url.pathname.startsWith('/auth/')) return;
  if (!CACHEABLE_PATHS.has(url.pathname) || url.search) return;
  event.respondWith(networkFirst(request, request));
});
