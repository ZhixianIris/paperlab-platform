#!/usr/bin/env node
/* Trusted, explicit platform-admin bootstrap. Never called by the web app and
 * never auto-promotes the first signup. */
import pg from 'pg';

const args = process.argv.slice(2);
function arg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const userIdArg = arg('--user-id');
const emailArg = arg('--email');
const note = arg('--note') || 'trusted operator grant';

if (!userIdArg && !emailArg) {
  console.error('Usage: DATABASE_URL=... npm run admin:grant -- --user-id <CloudBase Auth uid> [--note "..."]');
  console.error('   or: DATABASE_URL=... npm run admin:grant -- --email <verified email> [--note "..."]');
  process.exit(2);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

try {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  await client.connect();
  let userId = userIdArg;
  if (!userId && emailArg) {
    const { rows } = await client.query(
      'select id from auth.users where lower(email) = lower($1)',
      [emailArg]
    );
    if (!rows[0]) throw new Error('No CloudBase Auth user with that email. The person must sign up first.');
    userId = rows[0].id;
  }
  await client.query(
    `insert into public.platform_admins (user_id, note)
     values ($1, $2)
     on conflict (user_id) do update set note = excluded.note`,
    [userId, note]
  );
  console.log(`platform admin granted: ${userId}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
