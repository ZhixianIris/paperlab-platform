import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { TEST_USERS, resetAndSeed, testPool } from './seed.mjs';

const require = createRequire(import.meta.url);
const { loadConfig } = require('../../functions/platform-api/src/config.js');
const { createPool } = require('../../functions/platform-api/src/db.js');
const { createApp } = require('../../functions/platform-api/src/app.js');

const PORT = Number(process.env.E2E_PORT || 8788);
const SECRET = process.env.TEST_AUTH_SECRET || 'local-e2e-secret-not-for-production';
process.env.APP_ENV = 'test';

const pool = createPool(testPoolConfig(), { max: 6 });
const appConfig = loadConfig({
  ...process.env,
  APP_ENV: 'test',
  AI_PROVIDER: 'fixture',
  AI_TEXT_PROVIDER: 'fixture',
  DATABASE_URL:
    process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/paperlab',
  AI_USER_RATE_PER_MINUTE: '50',
  AI_TENANT_RATE_PER_MINUTE: '200',
});
const app = createApp({ pool, config: appConfig, logger: { error() {} } });

function testPoolConfig() {
  return {
    connectionString:
      process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/paperlab',
  };
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signToken(user) {
  const payload = base64url(
    JSON.stringify({ sub: user.id, email: user.email, exp: Date.now() + 60 * 60 * 1000 }),
  );
  const signature = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyToken(header) {
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded.sub || !decoded.exp || decoded.exp < Date.now()) return null;
    return decoded;
  } catch {
    return null;
  }
}

function corsHeaders(request) {
  return {
    'Access-Control-Allow-Origin': request.headers.origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function json(response, status, body, request) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders(request),
  });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('body too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function handle(request, response) {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders(request));
    response.end();
    return;
  }
  if (request.method === 'GET' && request.url === '/health') {
    json(response, 200, { ok: true, service: 'paperlab-e2e', database: 'up' }, request);
    return;
  }
  if (request.method === 'POST' && request.url === '/e2e/reset') {
    if (process.env.APP_ENV !== 'test') {
      json(response, 403, { ok: false, error: { message: 'disabled' } }, request);
      return;
    }
    await resetAndSeed(pool);
    json(response, 200, { ok: true }, request);
    return;
  }
  if (request.method === 'POST' && request.url === '/auth/login') {
    let body;
    try {
      body = await readBody(request);
    } catch {
      json(response, 400, { ok: false, error: { message: '请求格式错误' } }, request);
      return;
    }
    const email = String(body.email || '').toLowerCase();
    const user = Object.values(TEST_USERS).find(
      (candidate) => candidate.email.toLowerCase() === email && candidate.password === body.password,
    );
    if (!user) {
      json(response, 401, { ok: false, error: { message: '邮箱或密码不正确' } }, request);
      return;
    }
    json(
      response,
      200,
      { ok: true, data: { token: signToken(user), user: { id: user.id, email: user.email } } },
      request,
    );
    return;
  }
  if (request.method === 'POST' && request.url === '/platform-api') {
    let body;
    try {
      body = await readBody(request);
      if (typeof body.action !== 'string') throw new Error('missing action');
    } catch {
      json(response, 400, { ok: false, error: { code: 'bad_request', message: '请求格式错误' } }, request);
      return;
    }
    const claims = verifyToken(request.headers.authorization);
    const identity = claims
      ? { authenticated: true, uid: claims.sub, isAnonymous: false }
      : { authenticated: false, uid: '', isAnonymous: true };
    const result = await app.handle(body, { identity, requestId: crypto.randomUUID() });
    json(response, 200, result, request);
    return;
  }
  json(response, 404, { ok: false, error: { message: 'not found' } }, request);
}

export async function startHarness({ port = PORT, reset = true } = {}) {
  if (reset) await resetAndSeed(pool);
  const server = http.createServer((request, response) => {
    handle(request, response).catch((error) => {
      console.error('[e2e] request failed', error.code || error.name);
      if (!response.headersSent) {
        json(response, 500, { ok: false, error: { message: 'e2e server error' } }, request);
      } else {
        response.end();
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    server,
    closing: new Promise((resolve) => {
      server.on('close', resolve);
    }),
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    },
  };
}
