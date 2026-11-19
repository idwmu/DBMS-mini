// Server-side session lookup for Server Components (layout)
import { cookies } from 'next/headers';
import { AUTH_COOKIE, verifyToken } from './jwt';
import { getCurrentUser } from './services/authService';

export async function getSessionUser() {
  const store = await cookies();
  const payload = await verifyToken(store.get(AUTH_COOKIE)?.value);
  if (!payload?.user_id) return null;
  try {
    const user = await getCurrentUser(payload.user_id);
    // Plain JSON for the client provider
    return JSON.parse(JSON.stringify(user));
  } catch {
    return null;
  }
}
