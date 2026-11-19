// =====================================================================
// db.js: PostgreSQL connection pool (node-postgres)
// =====================================================================

import pg from 'pg';
import { resolveTimezone } from './timezone.mjs';

// Return NUMERIC and BIGINT (COUNT) as JS numbers instead of strings
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

const globalForDb = globalThis;

async function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured');
  }

  // Resolve a time zone Postgres actually knows, then bake it into every connection
  const probe = new pg.Client({ connectionString });
  await probe.connect();
  let timezone = 'UTC';
  try {
    timezone = await resolveTimezone(probe);
  } finally {
    await probe.end().catch(() => {});
  }

  const pool = new pg.Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX || 10),
    options: `-c TimeZone=${timezone}`
  });
  pool.on('error', (err) => console.error('[DB] Idle client error:', err.message));
  return pool;
}

// Reuse one pool across hot reloads in development
function getPool() {
  if (!globalForDb.__workloadPool) {
    globalForDb.__workloadPool = createPool().catch((err) => {
      globalForDb.__workloadPool = null;
      throw err;
    });
  }
  return globalForDb.__workloadPool;
}

export async function query(text, params = []) {
  const pool = await getPool();
  return pool.query(text, params);
}

export async function one(text, params = []) {
  const { rows } = await query(text, params);
  return rows[0] || null;
}

export async function many(text, params = []) {
  const { rows } = await query(text, params);
  return rows;
}

export async function withTransaction(fn) {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
