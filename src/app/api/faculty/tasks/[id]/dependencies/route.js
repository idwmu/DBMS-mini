import { requireFaculty } from '@/lib/auth';
import { ok, parseId, readJson, route } from '@/lib/http';
import { addDependency, dependencySchema } from '@/lib/services/facultyService';

export const POST = route(async (request, { id }) => {
  const user = await requireFaculty(request);
  const input = dependencySchema.parse(await readJson(request));
  return ok(await addDependency(user.user_id, parseId(id, 'Task ID'), input), 'Prerequisite dependency created', 201);
});
