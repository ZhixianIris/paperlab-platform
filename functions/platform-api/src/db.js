'use strict';

const pg = require('pg');

function createPool(pgConfig, options = {}) {
  const pool = new pg.Pool({
    ...pgConfig,
    max: options.max || Number(process.env.PGPOOL_MAX || 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    application_name: 'paperlab-platform-api',
  });
  pool.on('error', (error) => {
    console.error('[paperlab] idle pg client error', error.code || error.name);
  });
  return pool;
}

async function withTransaction(pool, callback, { isolation = 'read committed' } = {}) {
  const client = await pool.connect();
  try {
    await client.query(`begin isolation level ${isolation}`);
    const result = await callback(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { createPool, withTransaction };
