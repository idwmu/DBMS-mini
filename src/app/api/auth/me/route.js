import { getAuthUser } from '@/lib/auth';
import { ok, route } from '@/lib/http';
import { getCurrentUser } from '@/lib/services/authService';

export const GET = route(async (request) => {
  const user = await getAuthUser(request);
  return ok(await getCurrentUser(user.user_id), 'Current profile retrieved');
});
