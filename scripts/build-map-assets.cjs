'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'node_modules', 'maplibre-gl', 'dist');
const target = path.join(root, 'public', 'vendor', 'maplibre');
const files = ['maplibre-gl.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl.css'];

fs.mkdirSync(target, { recursive: true });
for (const file of files) fs.copyFileSync(path.join(source, file), path.join(target, file));
process.stdout.write(`MapLibre ${files.length}/${files.length} assets preparados.\n`);
