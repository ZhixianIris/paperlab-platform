'use strict';

const DEFAULTS = Object.freeze({
  appEnv: 'production',
  aiProvider: 'openai',
  aiTimeoutMs: 45000,
  aiResultMaxBytes: 5_000_000,
  userRatePerMinute: 10,
  tenantRatePerMinute: 40,
  paymentsEnabled: false,
  paymentProvider: '',
});

function asInt(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function asBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function loadConfig(env = process.env) {
  const pgSsl = asBool(env.PGSSL, false);
  const config = {
    appEnv: env.APP_ENV || DEFAULTS.appEnv,
    appOrigin: env.APP_ORIGIN || '',
    ai: {
      provider: (env.AI_PROVIDER || DEFAULTS.aiProvider).trim().toLowerCase(),
      openaiKey: env.OPENAI_API_KEY || '',
      openaiBaseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      timeoutMs: asInt(env.AI_TIMEOUT_MS, DEFAULTS.aiTimeoutMs, { min: 1000, max: 55000 }),
      resultMaxBytes: asInt(env.AI_RESULT_MAX_BYTES, DEFAULTS.aiResultMaxBytes, {
        min: 100_000,
        max: 8_000_000,
      }),
      userRatePerMinute: asInt(env.AI_USER_RATE_PER_MINUTE, DEFAULTS.userRatePerMinute, {
        min: 1,
        max: 1000,
      }),
      tenantRatePerMinute: asInt(env.AI_TENANT_RATE_PER_MINUTE, DEFAULTS.tenantRatePerMinute, {
        min: 1,
        max: 10000,
      }),
    },
    payments: {
      enabled: asBool(env.PAYMENTS_ENABLED, DEFAULTS.paymentsEnabled),
      provider: env.PAYMENT_PROVIDER || DEFAULTS.paymentProvider,
      merchantId: env.PAYMENT_MERCHANT_ID || '',
      apiV3Key: env.PAYMENT_API_V3_KEY || '',
    },
    pg: env.DATABASE_URL
      ? {
          connectionString: env.DATABASE_URL,
          ssl: pgSsl ? { rejectUnauthorized: false } : undefined,
        }
      : {
          host: env.PGHOST || '',
          port: asInt(env.PGPORT, 5432, { min: 1, max: 65535 }),
          database: env.PGDATABASE || 'postgres',
          user: env.PGUSER || '',
          password: env.PGPASSWORD || '',
          ssl: pgSsl ? { rejectUnauthorized: false } : undefined,
        },
    version: '1.0.0',
  };
  return config;
}

function assertDatabaseConfigured(config) {
  const pgConfig = config.pg;
  if (pgConfig.connectionString) return;
  if (!pgConfig.host || !pgConfig.user) {
    throw new Error('PostgreSQL is not configured (set DATABASE_URL or PGHOST/PGUSER/PGPASSWORD)');
  }
}

module.exports = { loadConfig, assertDatabaseConfigured };
