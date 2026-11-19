import { setAuthCookie } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/http';
import { registerSchema, registerUser } from '@/lib/services/authService';

export const POST = route(async (request) => {
  const input = registerSchema.parse(await readJson(request));
  const result = await registerUser(input);
  return setAuthCookie(ok(result, 'Registration successful', 201), result.token);
});
