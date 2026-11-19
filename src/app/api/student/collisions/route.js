import { requireStudent } from '@/lib/auth';
import { ok, route } from '@/lib/http';
import { getCollisions } from '@/lib/services/studentService';

export const GET = route(async (request) => {
  const user = await requireStudent(request);
  return ok(await getCollisions(user.student_id), 'Detected collisions retrieved');
});
