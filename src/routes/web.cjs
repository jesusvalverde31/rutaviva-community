'use strict';

const fs = require('node:fs');
const path = require('node:path');

const publicDirectory = path.resolve(__dirname, '..', '..', 'public');
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/auth/verify', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json; charset=utf-8']],
  ['/service-worker.js', ['service-worker.js', 'text/javascript; charset=utf-8']],
  ['/offline.html', ['offline.html', 'text/html; charset=utf-8']],
  ['/icon-192.png', ['icon-192.png', 'image/png']],
  ['/icon-512.png', ['icon-512.png', 'image/png']],
  ['/contribution-recovery.mjs', ['contribution-recovery.mjs', 'text/javascript; charset=utf-8']],
  ['/map.js', ['map.js', 'text/javascript; charset=utf-8']],
  ['/vendor/maplibre/maplibre-gl.mjs', ['vendor/maplibre/maplibre-gl.mjs', 'text/javascript; charset=utf-8']],
  ['/vendor/maplibre/maplibre-gl-worker.mjs', ['vendor/maplibre/maplibre-gl-worker.mjs', 'text/javascript; charset=utf-8']],
  ['/vendor/maplibre/maplibre-gl-shared.mjs', ['vendor/maplibre/maplibre-gl-shared.mjs', 'text/javascript; charset=utf-8']],
  ['/vendor/maplibre/maplibre-gl.css', ['vendor/maplibre/maplibre-gl.css', 'text/css; charset=utf-8']]
].map(([route, [file, type]]) => [route, { body: fs.readFileSync(path.join(publicDirectory, file)), type }]));

function webRoutes(app) {
  for (const [route, asset] of assets) {
    app.get(route, async (_request, reply) => {
      reply.type(asset.type);
      if (route === '/manifest.webmanifest' || route === '/service-worker.js') reply.header('cache-control', 'no-cache');
      return reply.send(asset.body);
    });
  }
}

module.exports = { assets, webRoutes };
