'use strict';

const { AppError } = require('./errors');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

function fail(message) {
  throw new AppError('validation_error', message, { status: 400 });
}

function object(value, name = 'payload') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} 必须是对象`);
  return value;
}

function text(value, name, { min = 1, max = 1000, trim = true } = {}) {
  if (typeof value !== 'string') fail(`${name} 必须是字符串`);
  const output = trim ? value.trim() : value;
  if (output.length < min) fail(`${name} 至少 ${min} 个字符`);
  if (output.length > max) fail(`${name} 不能超过 ${max} 个字符`);
  return output;
}

function optionalText(value, name, options = {}) {
  if (value === undefined || value === null || value === '') return '';
  return text(value, name, options);
}

function uuid(value, name) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) fail(`${name} 不是有效 UUID`);
  return value.toLowerCase();
}

function integer(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`${name} 必须是 ${min} 到 ${max} 的整数`);
  }
  return value;
}

function boolean(value, name) {
  if (typeof value !== 'boolean') fail(`${name} 必须是布尔值`);
  return value;
}

function email(value) {
  const output = text(value, 'email', { max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(output)) fail('邮箱格式不正确');
  return output;
}

function slug(value) {
  const output = text(value, 'slug', { max: 32 }).toLowerCase();
  if (!SLUG_RE.test(output)) fail('slug 只能包含小写字母、数字和连字符，长度 2-32');
  return output;
}

function oneOf(value, name, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) fail(`${name} 取值无效`);
  return value;
}

function stripUndefined(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

module.exports = {
  object,
  text,
  optionalText,
  uuid,
  integer,
  boolean,
  email,
  slug,
  oneOf,
  stripUndefined,
};
