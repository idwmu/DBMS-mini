// =====================================================================
// redis.js: Upstash REST client singleton + typed helpers
// Uses @upstash/redis (HTTPS/REST, port 443) instead of ioredis (port 6379)
// so it works on networks that block outbound TCP to Redis's default port.
// All helpers swallow errors so a Redis outage never crashes the app.
// Set REDIS_URL in .env.local — required in production, optional in dev.
// =====================================================================

import { Redis } from '@upstash/redis';

const globalForRedis = globalThis;

/**
 * Parse a standard Redis URL into the REST credentials Upstash needs.
 * Input:  rediss://default:TOKEN@host.upstash.io:6379
 * Output: { restUrl: 'https://host.upstash.io', token: 'TOKEN' }
 */
function parseRedisUrl(url) {
  const match = url.match(/rediss?:\/\/[^:]*:([^@]+)@([^:/]+)/);
  if (!match) return null;
  return { token: match[1], restUrl: `https://${match[2]}` };
}

function createClient() {
  const url = process.env.REDIS_URL;
  if (!url) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('REDIS_URL is not configured');
    }
    console.warn('[Redis] REDIS_URL not set — caching disabled');
    return null;
  }
  const parsed = parseRedisUrl(url);
  if (!parsed) {
    console.error('[Redis] Could not parse REDIS_URL — expected rediss://default:TOKEN@host:port');
    return null;
  }
  console.log('[Redis] Connecting via REST to', parsed.restUrl);
  return new Redis({ url: parsed.restUrl, token: parsed.token });
}

/** Returns the shared Upstash REST client, or null if Redis is not configured. */
export function getRedis() {
  if (!('__redisClient' in globalForRedis)) {
    globalForRedis.__redisClient = createClient();
  }
  return globalForRedis.__redisClient;
}

// ── String helpers ────────────────────────────────────────────────────

export async function rGet(key) {
  try { return await getRedis()?.get(key) ?? null; } catch { return null; }
}

export async function rGetJSON(key) {
  const raw = await rGet(key);
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}

export async function rSet(key, value, ttlSeconds) {
  const r = getRedis();
  if (!r) return;
  try {
    const v = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttlSeconds) await r.set(key, v, { ex: ttlSeconds });
    else await r.set(key, v);
  } catch {}
}

export async function rDel(...keys) {
  const r = getRedis();
  if (!r || !keys.length) return 0;
  try { return await r.del(...keys); } catch { return 0; }
}

/** Delete all keys matching a glob pattern (uses KEYS — dev/small datasets only). */
export async function rDelPattern(pattern) {
  const r = getRedis();
  if (!r) return;
  try {
    const keys = await r.keys(pattern);
    if (keys.length) await r.del(...keys);
  } catch {}
}

// ── Sorted set (ZSET) helpers ─────────────────────────────────────────

/**
 * Add a single member to a sorted set.
 * @param {string} key
 * @param {number} score   Numeric priority — use Unix-ms for deadline ordering
 * @param {string} member  Unique identifier (e.g. String(student_task_id))
 * @param {number} [ttlSeconds]
 */
export async function zAdd(key, score, member, ttlSeconds) {
  const r = getRedis();
  if (!r) return;
  try {
    await r.zadd(key, { score, member });
    if (ttlSeconds) await r.expire(key, ttlSeconds);
  } catch {}
}

/**
 * Bulk-add entries to a sorted set in one ZADD call.
 * @param {string} key
 * @param {Array<{ score: number, member: string }>} entries
 * @param {number} [ttlSeconds]
 */
export async function zAddBulk(key, entries, ttlSeconds) {
  const r = getRedis();
  if (!r || !entries.length) return;
  try {
    await r.zadd(key, ...entries.map(({ score, member }) => ({ score, member })));
    if (ttlSeconds) await r.expire(key, ttlSeconds);
  } catch {}
}

/**
 * Range query: returns members whose score falls in [min, max].
 * Use '+inf' / '-inf' (strings) for open bounds.
 * @param {string} key
 * @param {number|string} min
 * @param {number|string} max
 * @param {number} [limit]
 * @returns {Promise<string[]>}
 */
export async function zRangeByScore(key, min, max, limit) {
  const r = getRedis();
  if (!r) return [];
  try {
    return limit !== undefined
      ? await r.zrangebyscore(key, min, max, { count: limit, offset: 0 })
      : await r.zrangebyscore(key, min, max);
  } catch { return []; }
}

/** Remove members with score in [min, max] from a sorted set. */
export async function zRemRangeByScore(key, min, max) {
  const r = getRedis();
  if (!r) return 0;
  try { return await r.zremrangebyscore(key, min, max); } catch { return 0; }
}

// ── Rate limiter (INCR + EXPIRE) ──────────────────────────────────────

/**
 * Sliding-window counter rate limiter.
 * Increments a counter key; on first increment sets expiry to windowSeconds.
 * Fails open (allows request) on Redis error so the app stays up.
 *
 * @param {string} key           e.g. `ratelimit:login:${ip}`
 * @param {number} maxRequests   Max allowed requests in the window
 * @param {number} windowSeconds Rolling window length
 * @returns {Promise<{ count: number, allowed: boolean }>}
 */
export async function rateLimit(key, maxRequests, windowSeconds) {
  const r = getRedis();
  if (!r) return { count: 0, allowed: true };
  try {
    const count = await r.incr(key);
    if (count === 1) await r.expire(key, windowSeconds);
    return { count, allowed: count <= maxRequests };
  } catch { return { count: 0, allowed: true }; }
}
