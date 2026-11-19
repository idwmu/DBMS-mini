import { requireStudent } from '@/lib/auth';
import { ok, parseId, route } from '@/lib/http';
import { resolveCollision } from '@/lib/services/studentService';

export const PATCH = route(async (request, { id }) => {
  const user = await requireStudent(request);
  return ok(await resolveCollision(user.student_id, parseId(id, 'Collision ID')), 'Collision marked as resolved');
});
