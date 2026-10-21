#!/usr/bin/env node
/* Local/CI migration runner. CloudBase production migrations are executed by
 * `tcb deploy` from the same cloudbase/migrations directory. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root, 'cloudbase', 'migrations');
const bootstrapFile = path.join(root, 'tests', 'db', 'bootstrap.sql');
const withBootstrap = process.argv.includes('--bootstrap');

function connectionConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
    };
  }
  if (!process.env.PGHOST) {
    throw new Error('Set DATABASE_URL or PGHOST/PGUSER/PGPASSWORD/PGDATABASE');
  }
  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'postgres',
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  };
}

async function main() {
  const client = new pg.Client(connectionConfig());
  await client.connect();
  try {
    if (withBootstrap) {
      const bootstrap = await fs.readFile(bootstrapFile, 'utf8');
      await client.query(bootstrap);
      console.log('bootstrap: local auth compatibility installed');
    }

    await client.query(`create schema if not exists cloudbase_migrations`);
    await client.query(`
      create table if not exists cloudbase_migrations.schema_migrations (
        version text primary key,
        name text not null,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);
    await client.query(`select pg_advisory_lock(hashtext('paperlab_migrations'))`);

    const files = (await fs.readdir(migrationsDir))
      .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))
      .sort();
    if (files.length === 0) throw new Error('No migrations found');

    for (const file of files) {
      const version = file.slice(0, 14);
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const { rows } = await client.query(
        'select checksum from cloudbase_migrations.schema_migrations where version = $1',
        [version]
      );
      if (rows[0]) {
        if (rows[0].checksum !== checksum) {
          throw new Error(`Migration ${file} was modified after being applied; add a new migration instead`);
        }
        console.log(`skip    ${file}`);
        continue;
      }
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query(
          'insert into cloudbase_migrations.schema_migrations (version, name, checksum) values ($1, $2, $3)',
          [version, file, checksum]
        );
        await client.query('commit');
        console.log(`applied ${file}`);
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${error.message}`, { cause: error });
      }
    }
    await client.query(`select pg_advisory_unlock(hashtext('paperlab_migrations'))`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
