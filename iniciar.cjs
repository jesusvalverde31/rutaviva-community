'use strict';

const { activateRuntimeEnvironment } = require('./src/runtime-env.cjs');
const directEnvironment = require.main === module ? activateRuntimeEnvironment() : null;
const path = require('node:path');
const { spawn } = require('node:child_process');
const { loadConfig } = require('./src/config.cjs');

function start(options = {}) {
  const environment = options.env || directEnvironment || activateRuntimeEnvironment(options.runtimeEnvironmentOptions);
  const config = loadConfig(environment);
  if (config.nodeEnv !== 'production' && (config.host !== '127.0.0.1' || config.publicOrigin !== `http://127.0.0.1:${config.port}`)) {
    throw new Error('El inicio local solo admite 127.0.0.1 y HTTP local.');
  }
  const spawnProcess = options.spawn || spawn;
  const children = [];
  let closing = false;
  const launch = relative => {
    const child = spawnProcess(process.execPath, [path.resolve(__dirname, relative)], { cwd: __dirname, env: environment, stdio: 'inherit', windowsHide: true });
    children.push(child);
    child.once('exit', code => { if (!closing) shutdown(code === 0 ? 1 : (code || 1)); });
    return child;
  };
  function shutdown(code = 0) {
    if (closing) return;
    closing = true;
    for (const child of children) if (!child.killed) child.kill('SIGTERM');
    process.exitCode = code;
  }
  launch('src/server.cjs');
  if (config.emailDeliveryEnabled) launch('scripts/run-outbox-worker.cjs');
  const signalTarget = options.signalTarget === undefined ? process : options.signalTarget;
  signalTarget?.once('SIGINT', () => shutdown(0));
  signalTarget?.once('SIGTERM', () => shutdown(0));
  return { children, shutdown };
}

if (require.main === module) {
  try { start(); } catch (error) {
    process.stderr.write(`No se pudo iniciar RutaViva Community: ${error.name}.\n`);
    process.exitCode = 1;
  }
}

module.exports = { start };
