'use strict';

class AppError extends Error {
  constructor(code, message, { status = 400, details = undefined, cause = undefined } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isAppError(error) {
  return error instanceof AppError || (error && error.name === 'AppError' && typeof error.code === 'string');
}

function assert(condition, code, message, options) {
  if (!condition) throw new AppError(code, message, options);
}

module.exports = { AppError, isAppError, assert };
