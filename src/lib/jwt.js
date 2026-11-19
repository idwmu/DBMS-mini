// =====================================================================
// jwt.js: Token signing/verification (jose, works in proxy and routes)
// =====================================================================

import { SignJWT, jwtVerify } from 'jose';

export const AUTH_COOKIE = 'wa_token';
const DEV_FALLBACK_SECRET = 'dev_only_secret_student_workload_analyzer_change_me';

function secretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  return new TextEncoder().encode(secret || DEV_FALLBACK_SECRET);
}

export async function signToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_EXPIRES_IN || '7d')
    .sign(secretKey());
}

export async function verifyToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload;
  } catch {
    return null;
  }
}
