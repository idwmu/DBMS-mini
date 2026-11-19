import { requireFaculty } from '@/lib/auth';
import { ok, parseId, route } from '@/lib/http';
import { getTaskStudents } from '@/lib/services/facultyService';

export const GET = route(async (request, { id }) => {
  const user = await requireFaculty(request);
  return ok(await getTaskStudents(user.user_id, parseId(id, 'Task ID')), 'Assigned students retrieved');
});
