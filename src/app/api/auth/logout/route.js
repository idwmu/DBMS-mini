import { clearAuthCookie } from '@/lib/auth';
import { ok, route } from '@/lib/http';

export const POST = route(async () => clearAuthCookie(ok(null, 'Signed out')));
