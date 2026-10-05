'use strict';

const DEFAULT_ORIGIN = 'https://rutaviva-community-sevilla-jv31.onrender.com';
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const EXPECTED_READY_CHECKS = ['database', 'role', 'postgis', 'migrations', 'relations', 'functions'];
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PWA_ICONS = [
  { path: '/icon-192.png', size: 192 },
  { path: '/icon-512.png', size: 512 }
];
const MAX_RESPONSE_BYTES = 1024 * 1024;

class SmokeResponseError extends Error {}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function cancelResponseBody(response, reason) {
  if (response.body && !response.body.locked) void response.body.cancel(reason).catch(() => {});
}

async function readBodyWithinLimit(response, signal, pathname) {
  const maxBytes = pathname.endsWith('.png') ? 128 * 1024 : MAX_RESPONSE_BYTES;
  const limitLabel = pathname.endsWith('.png') ? '128 KiB' : '1 MiB';
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    const error = new SmokeResponseError(`${pathname} supera ${limitLabel}`);
    cancelResponseBody(response, error);
    throw error;
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason || new Error('Se agotó el tiempo de lectura del smoke'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new SmokeResponseError(`${pathname} supera ${limitLabel}`);
      chunks.push(Buffer.from(value));
    }
    reader.releaseLock();
    return Buffer.concat(chunks, total);
  } catch (error) {
    void reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function bufferedResponse(response, body) {
  return {
    status: response.status,
    headers: response.headers,
    text: async () => body.toString('utf8'),
    json: async () => JSON.parse(body.toString('utf8')),
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
  };
}

async function request(origin, pathname, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const attempts = options.attempts ?? 8;
  const retryDelayMs = options.retryDelayMs ?? 15000;
  const timeoutMs = options.timeoutMs ?? 15000;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const remainingMs = options.deadlineAt ? options.deadlineAt - Date.now() : timeoutMs;
    if (remainingMs <= 0) throw new Error('Se agotó el presupuesto global del smoke');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, remainingMs));
    try {
      const response = await fetchImpl(new URL(pathname, origin), {
        method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { accept: pathname === '/' || pathname === '/offline.html' ? 'text/html' : pathname === '/manifest.webmanifest' ? 'application/manifest+json, application/json' : pathname === '/service-worker.js' ? 'text/javascript, application/javascript' : pathname.endsWith('.png') ? 'image/png' : 'application/json' }
      });
      if (!RETRYABLE_STATUS.has(response.status)) {
        const body = await readBodyWithinLimit(response, controller.signal, pathname);
        return bufferedResponse(response, body);
      }
      lastError = new Error(`${pathname} respondió ${response.status}`);
      controller.abort(lastError);
      cancelResponseBody(response, lastError);
      if (attempt === attempts) throw lastError;
    } catch (error) {
      lastError = error;
      if (error instanceof SmokeResponseError) {
        controller.abort(error);
        throw error;
      }
      if (attempt === attempts) throw error;
    } finally {
      clearTimeout(timer);
    }
    const remainingAfterAttempt = options.deadlineAt ? options.deadlineAt - Date.now() : retryDelayMs;
    if (options.deadlineAt && remainingAfterAttempt <= 0) throw new Error('Se agotó el presupuesto global del smoke');
    await (options.delayImpl || delay)(Math.min(retryDelayMs, remainingAfterAttempt));
  }
  throw lastError || new Error(`${pathname} no respondió`);
}

function requireStatus(response, pathname) {
  if (response.status !== 200) throw new Error(`${pathname} respondió ${response.status}`);
}

function requireMime(response, pathname, expected) {
  const actual = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (!expected.includes(actual)) throw new Error(`${pathname} no devolvió el tipo de contenido esperado`);
}

async function jsonBody(response, pathname) {
  requireStatus(response, pathname);
  requireMime(response, pathname, ['application/json', 'application/manifest+json']);
  try { return await response.json(); } catch { throw new Error(`${pathname} devolvió JSON inválido`); }
}

function validateHealth(body) {
  if (body?.status !== 'ok' || body?.service !== 'rutaviva-community' || typeof body?.requestId !== 'string') throw new Error('/api/v1/health no cumple el contrato público');
}

function validateReady(body) {
  if (body?.status !== 'ready' || typeof body?.requestId !== 'string') throw new Error('/api/v1/ready no está listo');
  for (const name of EXPECTED_READY_CHECKS) if (body?.checks?.[name] !== 'ok') throw new Error(`/api/v1/ready falla en ${name}`);
}

function validateBootstrap(body) {
  if (body?.service !== 'rutaviva-community' || body?.pilot?.slug !== 'sevilla' || body?.capabilities?.routes !== true) throw new Error('/api/v1/bootstrap no representa el piloto de Sevilla con rutas');
  if (!/ruta orientativa/i.test(body?.advertencia || '') || typeof body?.requestId !== 'string') throw new Error('/api/v1/bootstrap no contiene la advertencia obligatoria');
}

function validateHtml(html) {
  if (!/<meta[^>]+name=["']viewport["']/i.test(html) || !/<main(?:\s|>)/i.test(html) || !/ruta orientativa/i.test(html)) throw new Error('/ no contiene los marcadores semánticos y de seguridad esperados');
}

function validateManifest(manifest) {
  if (manifest?.start_url !== '/' || manifest?.scope !== '/' || manifest?.display !== 'standalone') throw new Error('/manifest.webmanifest no cumple el contrato de instalación');
  for (const icon of PWA_ICONS) {
    if (!Array.isArray(manifest?.icons) || !manifest.icons.some(item => item?.src === icon.path && item?.sizes === `${icon.size}x${icon.size}` && item?.type === 'image/png')) throw new Error(`/manifest.webmanifest no declara correctamente ${icon.path}`);
  }
}

function validateServiceWorker(response, source) {
  requireStatus(response, '/service-worker.js');
  requireMime(response, '/service-worker.js', ['application/javascript', 'text/javascript']);
  if (!/\bno-cache\b/i.test(response.headers.get('cache-control') || '')) throw new Error('/service-worker.js no declara Cache-Control no-cache');
  if (!/addEventListener\s*\(/.test(source)) throw new Error('/service-worker.js no parece contener un worker válido');
}

function validateOfflineHtml(response, html) {
  requireStatus(response, '/offline.html');
  requireMime(response, '/offline.html', ['text/html']);
  if (!/<main(?:\s|>)/i.test(html) || !/<h1(?:\s|>)/i.test(html) || !/\b(reintenta|inténtalo de nuevo|vuelve a intentarlo|no pudo responder)\b/i.test(html) || /internet (?:no está|no esta) disponible/i.test(html)) throw new Error('/offline.html no conserva semántica y mensaje neutral');
}

async function validatePng(response, pathname, expectedSize) {
  requireStatus(response, pathname);
  requireMime(response, pathname, ['image/png']);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 128 * 1024) throw new Error(`${pathname} supera 128 KiB`);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error(`${pathname} no tiene una firma PNG válida`);
  if (bytes.readUInt32BE(16) !== expectedSize || bytes.readUInt32BE(20) !== expectedSize) throw new Error(`${pathname} no tiene dimensiones ${expectedSize}x${expectedSize}`);
}

async function runSmoke(options = {}) {
  const origin = options.origin || DEFAULT_ORIGIN;
  const deadlineAt = Date.now() + (options.budgetMs ?? 240000);
  const requestOptions = { fetchImpl: options.fetchImpl, attempts: options.attempts, retryDelayMs: options.retryDelayMs, timeoutMs: options.timeoutMs, delayImpl: options.delayImpl, deadlineAt };
  const steps = [
    ['/api/v1/health', async response => validateHealth(await jsonBody(response, '/api/v1/health'))],
    ['/api/v1/ready', async response => validateReady(await jsonBody(response, '/api/v1/ready'))],
    ['/api/v1/bootstrap', async response => validateBootstrap(await jsonBody(response, '/api/v1/bootstrap'))],
    ['/', async response => { requireStatus(response, '/'); requireMime(response, '/', ['text/html']); validateHtml(await response.text()); }],
    ['/manifest.webmanifest', async response => validateManifest(await jsonBody(response, '/manifest.webmanifest'))],
    ['/service-worker.js', async response => validateServiceWorker(response, await response.text())],
    ['/offline.html', async response => validateOfflineHtml(response, await response.text())],
    ['/icon-192.png', async response => validatePng(response, '/icon-192.png', 192)],
    ['/icon-512.png', async response => validatePng(response, '/icon-512.png', 512)]
  ];
  for (const [pathname, validate] of steps) {
    if (Date.now() >= deadlineAt) throw new Error('Se agotó el presupuesto global del smoke');
    await validate(await request(origin, pathname, requestOptions));
    if (!options.silent) console.log(`[OK] ${pathname}`);
  }
  return { ok: true, origin };
}

if (require.main === module) runSmoke().catch(error => { console.error(`[ERROR] ${error.message}`); process.exitCode = 1; });

module.exports = { DEFAULT_ORIGIN, EXPECTED_READY_CHECKS, PWA_ICONS, jsonBody, request, runSmoke, validateBootstrap, validateHealth, validateHtml, validateManifest, validateOfflineHtml, validatePng, validateReady, validateServiceWorker };

