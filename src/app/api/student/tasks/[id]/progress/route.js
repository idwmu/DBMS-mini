import { requireStudent } from '@/lib/auth';
import { ok, parseId, readJson, route } from '@/lib/http';
import { updateTaskProgress } from '@/lib/services/studentService';

export const PATCH = route(async (request, { id }) => {
  const user = await requireStudent(request);
  return ok(
    await updateTaskProgress(user.student_id, parseId(id, 'Task ID'), await readJson(request)),
    'Task progress updated'
  );
});
