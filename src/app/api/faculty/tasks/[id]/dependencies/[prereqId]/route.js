import { requireFaculty } from '@/lib/auth';
import { ok, parseId, route } from '@/lib/http';
import { deleteDependency } from '@/lib/services/facultyService';

export const DELETE = route(async (request, { id, prereqId }) => {
  const user = await requireFaculty(request);
  const result = await deleteDependency(user.user_id, parseId(id, 'Task ID'), parseId(prereqId, 'Prerequisite ID'));
  return ok(result, 'Dependency removed');
});
