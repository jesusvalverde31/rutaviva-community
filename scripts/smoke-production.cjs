'use strict';

const DEFAULT_ORIGIN = 'https://rutaviva-community-sevilla-jv31.onrender.com';
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const EXPECTED_READY_CHECKS = ['database', 'role', 'postgis', 'migrations', 'relations', 'functions'];

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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
        headers: { accept: pathname === '/' ? 'text/html' : 'application/json' }
      });
      if (!RETRYABLE_STATUS.has(response.status)) return response;
      lastError = new Error(`${pathname} respondió ${response.status}`);
      if (attempt === attempts) throw lastError;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    } finally {
      clearTimeout(timer);
    }
    if (options.deadlineAt) {
      const remainingAfterAttempt = options.deadlineAt - Date.now();
      if (remainingAfterAttempt <= 0) throw new Error('Se agotó el presupuesto global del smoke');
      await (options.delayImpl || delay)(Math.min(retryDelayMs, remainingAfterAttempt));
    } else {
      await (options.delayImpl || delay)(retryDelayMs);
    }
  }
  throw lastError || new Error(`${pathname} no respondió`);
}

async function jsonBody(response, pathname) {
  if (response.status !== 200) throw new Error(`${pathname} respondió ${response.status}`);
  if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error(`${pathname} no devolvió JSON`);
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

async function runSmoke(options = {}) {
  const origin = options.origin || DEFAULT_ORIGIN;
  const deadlineAt = Date.now() + (options.budgetMs ?? 240000);
  const requestOptions = { fetchImpl: options.fetchImpl, attempts: options.attempts, retryDelayMs: options.retryDelayMs, timeoutMs: options.timeoutMs, delayImpl: options.delayImpl, deadlineAt };
  const steps = [
    ['/api/v1/health', async response => validateHealth(await jsonBody(response, '/api/v1/health'))],
    ['/api/v1/ready', async response => validateReady(await jsonBody(response, '/api/v1/ready'))],
    ['/api/v1/bootstrap', async response => validateBootstrap(await jsonBody(response, '/api/v1/bootstrap'))],
    ['/', async response => { if (response.status !== 200) throw new Error(`/ respondió ${response.status}`); validateHtml(await response.text()); }]
  ];
  for (const [pathname, validate] of steps) {
    await validate(await request(origin, pathname, requestOptions));
    if (!options.silent) console.log(`[OK] ${pathname}`);
  }
  return { ok: true, origin };
}

if (require.main === module) runSmoke().catch(error => { console.error(`[ERROR] ${error.message}`); process.exitCode = 1; });

module.exports = { DEFAULT_ORIGIN, EXPECTED_READY_CHECKS, jsonBody, request, runSmoke, validateBootstrap, validateHealth, validateHtml, validateReady };
