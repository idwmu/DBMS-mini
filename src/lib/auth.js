// =====================================================================
// auth.js: Request authentication & role-based access control
// Accepts the httpOnly session cookie (browser) or a Bearer token (API clients)
// =====================================================================

import { one } from './db';
import { HttpError } from './http';
import { AUTH_COOKIE, verifyToken } from './jwt';
import { rDelPattern, rGetJSON, rSet } from './redis';

function readToken(request) {
  const header = request.headers.get('authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return request.cookies?.get(AUTH_COOKIE)?.value || null;
}

// Cache key: auth:user:{user_id}:{fingerprint}
// Fingerprint = last 20 chars of the JWT (signature bytes) — unique per issuance.
function authCacheKey(userId, token) {
  return `auth:user:${userId}:${token.slice(-20)}`;
}

export async function getAuthUser(request) {
  const token = readToken(request);
  if (!token) {
    throw new HttpError(401, 'Please sign in, or provide a valid Bearer token in the Authorization header', 'Authentication token missing or invalid');
  }

  const payload = await verifyToken(token);
  if (!payload?.user_id) {
    throw new HttpError(401, 'Your session is invalid or has expired', 'Invalid or expired token');
  }

  // ── Redis cache: skip DB round-trips on repeated requests ─────────────
  const cacheKey = authCacheKey(payload.user_id, token);
  const cached = await rGetJSON(cacheKey);
  if (cached) return cached;

  // ── Cache miss: fetch from DB ─────────────────────────────────────────
  const user = await one(
    'SELECT user_id, username, email, role, created_at FROM users WHERE user_id = $1',
    [payload.user_id]
  );
  if (!user) {
    throw new HttpError(401, 'The user account associated with this token no longer exists', 'User not found');
  }

  if (user.role === 'student') {
    const student = await one(
      'SELECT student_id, roll_no, program, semester, section, advisor_id FROM students WHERE user_id = $1',
      [user.user_id]
    );
    if (student) Object.assign(user, student);
  }

  // Cache until token expiry, capped at 120 s to prevent stale roles sitting too long
  const ttl = payload.exp
    ? Math.min(payload.exp - Math.floor(Date.now() / 1000), 120)
    : 120;
  if (ttl > 0) await rSet(cacheKey, user, ttl);

  return user;
}

/**
 * Invalidate all cached auth entries for a user.
 * Call on logout, role change, or account deletion.
 */
export async function invalidateAuthCache(userId) {
  await rDelPattern(`auth:user:${userId}:*`);
}

export async function requireRole(request, ...roles) {
  const user = await getAuthUser(request);
  if (!roles.includes(user.role)) {
    throw new HttpError(
      403,
      `Access denied. Requires one of the following roles: [${roles.join(', ')}]. Current role: "${user.role}"`,
      'Forbidden'
    );
  }
  if (user.role === 'student' && !user.student_id) {
    throw new HttpError(403, 'No student profile is linked to this account', 'Forbidden');
  }
  return user;
}

export const requireStudent = (request) => requireRole(request, 'student');
export const requireFaculty = (request) => requireRole(request, 'faculty', 'admin');

export function setAuthCookie(response, token) {
  response.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7
  });
  return response;
}

export function clearAuthCookie(response) {
  response.cookies.set(AUTH_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return response;
}
