import { setAuthCookie } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/http';
import { loginSchema, loginUser } from '@/lib/services/authService';
import { rateLimit } from '@/lib/redis';

// Max login attempts per IP within the rolling window
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 10);
const LOGIN_WINDOW_SECONDS = Number(process.env.LOGIN_WINDOW_SECONDS || 15 * 60); // 15 min

function getClientIp(request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1'
  );
}

export const POST = route(async (request) => {
  // ── Rate limiting: max LOGIN_MAX_ATTEMPTS per IP per LOGIN_WINDOW_SECONDS ──
  const ip = getClientIp(request);
  const { allowed, count } = await rateLimit(
    `ratelimit:login:${ip}`,
    LOGIN_MAX_ATTEMPTS,
    LOGIN_WINDOW_SECONDS
  );
  if (!allowed) {
    return new Response(
      JSON.stringify({
        error: `Too many login attempts (${count}/${LOGIN_MAX_ATTEMPTS}). Try again in ${Math.ceil(LOGIN_WINDOW_SECONDS / 60)} minutes.`,
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const input = loginSchema.parse(await readJson(request));
  const result = await loginUser(input);
  return setAuthCookie(ok(result, 'Login successful'), result.token);
});
