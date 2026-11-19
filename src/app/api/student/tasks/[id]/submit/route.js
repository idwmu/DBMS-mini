import { requireStudent } from '@/lib/auth';
import { ok, parseId, readJson, route } from '@/lib/http';
import { submitTask } from '@/lib/services/studentService';

export const POST = route(async (request, { id }) => {
  const user = await requireStudent(request);
  return ok(await submitTask(user.student_id, parseId(id, 'Task ID'), await readJson(request)), 'Task successfully submitted');
});
