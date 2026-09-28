'use strict';

const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');

function encryptText(value, key, options = {}) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new TypeError('Se requiere una clave AES-256 de 32 bytes.');
  const nonce = (options.randomBytes || randomBytes)(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { ciphertext, nonce, tag: cipher.getAuthTag() };
}

function decryptText(encrypted, key) {
  const decipher = createDecipheriv('aes-256-gcm', key, encrypted.nonce);
  decipher.setAuthTag(encrypted.tag);
  return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]).toString('utf8');
}

function createEncryptedMagicLink(email, link, key, options = {}) {
  return encryptText(JSON.stringify({ to: email, template: 'auth.magic_link', link }), key, options);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function magicLinkEmail(payload) {
  if (!payload || payload.template !== 'auth.magic_link' || typeof payload.to !== 'string' || typeof payload.link !== 'string') {
    throw new TypeError('Payload de correo no válido.');
  }
  const url = new URL(payload.link);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError('Enlace de acceso no válido.');
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
  const localNotice = loopback
    ? '\nEste enlace solo funciona en el mismo ordenador donde está abierta RutaViva.'
    : '';
  const safeLink = escapeHtml(url.href);
  return {
    to: payload.to,
    subject: 'Tu enlace para entrar en RutaViva',
    textContent: `Entra en RutaViva con este enlace de un solo uso:\n\n${url.href}\n\nCaduca en 15 minutos.${localNotice}\n\nSi no lo solicitaste, ignora este mensaje.`,
    htmlContent: `<!doctype html><html lang="es"><body><main><h1>Entra en RutaViva</h1><p><a href="${safeLink}">Entrar en RutaViva</a></p><p>Este enlace es de un solo uso y caduca en 15 minutos.</p>${loopback ? '<p>Este enlace solo funciona en el mismo ordenador donde está abierta RutaViva.</p>' : ''}<p>Si no lo solicitaste, ignora este mensaje.</p></main></body></html>`
  };
}

module.exports = { createEncryptedMagicLink, decryptText, encryptText, escapeHtml, magicLinkEmail };
