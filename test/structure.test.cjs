'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  expectedEnvironment,
  filesIn,
  inspect,
  parseEnvironment,
  privatePathPatterns,
  required
} = require('../tools/check-structure.cjs');

const root = path.resolve(__dirname, '..');

test('el proyecto contiene exactamente los archivos obligatorios declarados', () => {
  assert.equal(required.length, 97);
  for (const file of required) assert.equal(fs.existsSync(path.join(root, file)), true, file);
  assert.deepEqual(filesIn(root), [...required].sort());
});

test('la estructura cumple Node 24, dependencias exactas y seguridad documental', () => {
  assert.deepEqual(inspect(), []);
  const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  assert.deepEqual(parseEnvironment(env), Object.entries(expectedEnvironment));
  assert.equal(parseEnvironment(env).length, 26);
  assert.equal(privatePathPatterns.some(pattern => pattern.test('M' + ':/private/file')), true);
  assert.equal(privatePathPatterns.some(pattern => pattern.test('C' + ':/Users/example/file')), true);
  assert.equal(privatePathPatterns.some(pattern => pattern.test('C' + ':\\Users\\example\\file')), true);
});

test('el proyecto no depende del directorio local histórico', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(JSON.stringify(pkg).includes('rutaviva-local'), false);
  assert.equal(pkg.scripts.start, 'node iniciar.cjs');
  assert.equal(pkg.scripts['start:server'], 'node src/server.cjs');
  assert.equal(pkg.scripts.worker, 'node scripts/run-outbox-worker.cjs');
  assert.match(pkg.scripts.migrate, /--env-file-if-exists=\.env/);
  assert.match(pkg.scripts['test:integration'], /--env-file-if-exists=\.env/);
  assert.equal(fs.existsSync(path.join(root, 'data')), false);
});

test('la ayuda accesible forma parte de la portada pública', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.match(html, /href="#ayuda"/);
  assert.match(html, /id="ayuda"/);
  assert.match(html, /<details>/);
  assert.match(html, /<summary>/);
  assert.match(html, /<dl class="help-glossary">/);
});

test('el verificador ignora entornos privados pero conserva la plantilla', () => {
  const temporary = fs.mkdtempSync(path.join(root, '.structure-env-'));
  try {
    fs.writeFileSync(path.join(temporary, '.env'), 'PRIVATE_VALUE=synthetic\n');
    fs.writeFileSync(path.join(temporary, '.env.local'), 'PRIVATE_VALUE=synthetic\n');
    fs.writeFileSync(path.join(temporary, '.env.example'), 'SAFE=example\n');
    fs.writeFileSync(path.join(temporary, 'visible.txt'), 'visible\n');
    assert.deepEqual(filesIn(temporary), ['.env.example', 'visible.txt']);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('OpenAPI documenta contratos de autenticación sin tokens de ejemplo', () => {
  const document = JSON.parse(fs.readFileSync(path.join(root, 'openapi', 'openapi.json'), 'utf8'));
  const requestLink = document.paths['/api/v1/auth/request-link'].post;
  const verify = document.paths['/api/v1/auth/verify'].post;
  assert.deepEqual(Object.keys(requestLink.responses).sort(), ['202', '400', '403', '409', '413', '415', '422', '429', '503']);
  assert.deepEqual(Object.keys(verify.responses).sort(), ['200', '400', '401', '403', '413', '415', '422', '429', '503']);
  assert.ok(requestLink.responses['202'].content['application/json'].schema.$ref);
  assert.ok(verify.responses['200'].content['application/json'].schema.$ref);
  assert.equal(document.components.securitySchemes.sessionCookie.name, '__Host-rv_session');
  assert.equal(document.components.parameters.Origin.required, true);
  assert.equal(document.components.parameters.IdempotencyKey.required, true);
  assert.equal(document.components.parameters.Csrf.required, true);
  assert.equal(document.components.parameters.CsrfOptional.required, false);
  assert.equal(document.paths['/api/v1/auth/logout'].post.parameters[1].$ref, '#/components/parameters/CsrfOptional');
  assert.equal(document.components.schemas.TokenRequest.properties.token.writeOnly, true);
  assert.equal(document.components.schemas.Csrf.properties.csrfToken.readOnly, true);
  assert.equal(Object.hasOwn(document.components.schemas.Csrf.properties.csrfToken, 'writeOnly'), false);
  assert.equal(document.components.schemas.User.required.includes('version'), true);
  assert.equal(document.components.schemas.User.required.includes('status'), true);
  assert.equal(document.components.schemas.User.properties.status.enum.includes('active'), true);
  assert.equal(document.components.schemas.User.properties.version.minimum, 1);
  assert.equal(Object.hasOwn(document.paths['/api/v1/auth/logout'].post.responses, '401'), false);
  assert.equal(Object.hasOwn(document.components.schemas.TokenRequest.properties.token, 'example'), false);
  for (const route of ['/api/v1/contributions','/api/v1/contributions/{id}','/api/v1/contributions/{id}/history','/api/v1/community/activity','/api/v1/moderation/cases','/api/v1/moderation/cases/{id}/publish']) assert.ok(document.paths[route], route);
  assert.equal(document.info.version, '0.5.0');
});
