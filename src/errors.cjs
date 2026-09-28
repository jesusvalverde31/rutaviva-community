'use strict';

class AppError extends Error {
  constructor(status, code, title, options = {}) {
    super(title, options);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.title = title;
    this.errors = options.errors;
    this.retryAfter = options.retryAfter;
  }
}

function classifyError(error) {
  if (error instanceof AppError) return error;
  if (error?.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return new AppError(413, 'PAYLOAD_TOO_LARGE', 'El cuerpo de la solicitud es demasiado grande.');
  if (error?.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') return new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'El tipo de contenido no está permitido.');
  if (error?.code === 'FST_ERR_CTP_INVALID_JSON_BODY' || error?.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || (error instanceof SyntaxError && error.statusCode === 400)) return new AppError(400, 'INVALID_JSON', 'El JSON de la solicitud no es válido.');
  if (error?.validation) return new AppError(422, 'VALIDATION_ERROR', 'No se pudo validar la solicitud.');
  return new AppError(500, 'INTERNAL_ERROR', 'No se pudo completar la operación.');
}

function problem(error, requestId) {
  const body = { type: 'about:blank', title: error.title, status: error.status, code: error.code, requestId };
  if (Array.isArray(error.errors) && error.errors.length) body.errors = error.errors;
  return body;
}

module.exports = { AppError, classifyError, problem };
