'use strict';

const DEFAULT_ORIGIN = 'https://rutaviva-community-sevilla-jv31.onrender.com';

function parseMagicLink(raw, expectedOrigin) {
  const link = new URL(raw);
  const origin = new URL(expectedOrigin);
  if (link.origin !== origin.origin || link.pathname !== '/auth/verify') throw new Error('El enlace mágico no pertenece al origen autorizado.');
  const marker = '#token=';
  if (!link.hash.startsWith(marker)) throw new Error('El enlace mágico no contiene un token válido.');
  const token = decodeURIComponent(link.hash.slice(marker.length));
  if (token.length !== 80) throw new Error('El token del enlace mágico no tiene el formato esperado.');
  return token;
}

function cookieJar() {
  const values = new Map();
  return {
    header() { return [...values].map(([name, value]) => `${name}=${value}`).join('; '); },
    update(headers) {
      const setCookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie')].filter(Boolean);
      for (const source of setCookies) {
        const [pair, ...attributes] = source.split(';').map(part => part.trim());
        const separator = pair.indexOf('=');
        if (separator < 1) continue;
        const name = pair.slice(0, separator), value = pair.slice(separator + 1);
        const removed = !value || attributes.some(attribute => /^max-age=0$/i.test(attribute));
        if (removed) values.delete(name); else values.set(name, value);
      }
    }
  };
}

async function request(fetchImpl, origin, pathname, options = {}, jar = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
  const headers = { accept: 'application/json', ...(options.headers || {}) };
  const cookies = jar?.header();
  if (cookies) headers.cookie = cookies;
  try {
    const response = await fetchImpl(new URL(pathname, origin), { method: options.method || 'GET', redirect: 'error', signal: controller.signal, headers, body: options.body });
    jar?.update(response.headers);
    return response;
  } finally { clearTimeout(timer); }
}

async function requireJson(response, status, label) {
  if (response.status !== status) throw new Error(`${label} respondió ${response.status}`);
  const type = response.headers.get('content-type') || '';
  if (!type.toLowerCase().startsWith('application/json')) throw new Error(`${label} no devolvió JSON`);
  return response.json();
}

async function runSessionSmoke(options = {}) {
  if (options.confirm !== 'SI') throw new Error('Falta SESSION_SMOKE_CONFIRM=SI para consumir el enlace de un solo uso.');
  const origin = options.origin || DEFAULT_ORIGIN;
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(parsedOrigin.hostname)) throw new Error('El smoke de sesión exige HTTPS o un origen local.');
  const token = parseMagicLink(options.magicLink, origin);
  const fetchImpl = options.fetchImpl || fetch;
  const primary = cookieJar(), otherDevice = cookieJar();

  let response = await request(fetchImpl, origin, '/api/v1/users/me', {}, otherDevice);
  if (response.status !== 401) throw new Error('El navegador alternativo ya tenía una sesión; usa un contexto aislado.');

  response = await request(fetchImpl, origin, '/api/v1/auth/verify', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token })
  }, primary);
  const verified = await requireJson(response, 200, 'La verificación');
  if (verified?.authenticated !== true || typeof verified?.user?.id !== 'string') throw new Error('La verificación no devolvió una sesión válida.');

  response = await request(fetchImpl, origin, '/api/v1/users/me', {}, primary);
  const profile = await requireJson(response, 200, 'La sesión recargada');
  if (profile?.user?.id !== verified.user.id) throw new Error('La sesión recargada no pertenece a la cuenta verificada.');

  response = await request(fetchImpl, origin, '/api/v1/users/me', {}, otherDevice);
  if (response.status !== 401) throw new Error('La sesión apareció en un navegador que no consumió el enlace.');

  response = await request(fetchImpl, origin, '/api/v1/auth/verify', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token })
  }, otherDevice);
  if (response.status !== 401) throw new Error(`El enlace de un solo uso pudo reutilizarse (${response.status}).`);

  response = await request(fetchImpl, origin, '/api/v1/auth/csrf', {}, primary);
  const csrf = await requireJson(response, 200, 'La protección CSRF');
  if (typeof csrf?.csrfToken !== 'string' || csrf.csrfToken.length < 16) throw new Error('No se obtuvo una protección CSRF válida.');

  response = await request(fetchImpl, origin, '/api/v1/auth/logout', {
    method: 'POST', headers: { origin, 'x-csrf-token': csrf.csrfToken }
  }, primary);
  if (response.status !== 204) throw new Error(`El cierre respondió ${response.status}`);

  response = await request(fetchImpl, origin, '/api/v1/users/me', {}, primary);
  if (response.status !== 401) throw new Error('La sesión continúa activa después del cierre.');
  return { ok:true, origin, checks:7 };
}

if (require.main === module) {
  runSessionSmoke({ magicLink:process.env.SESSION_SMOKE_MAGIC_LINK, confirm:process.env.SESSION_SMOKE_CONFIRM, origin:process.env.SMOKE_ORIGIN })
    .then(result => console.log(`[OK] sesión real verificada (${result.checks}/7)`))
    .catch(error => { console.error(`[ERROR] ${error.message}`); process.exitCode=1; });
}

module.exports = { DEFAULT_ORIGIN, cookieJar, parseMagicLink, request, runSessionSmoke };
