import { requireFaculty } from '@/lib/auth';
import { ok, parseId, readJson, route } from '@/lib/http';
import { deleteTask, getTaskById, taskUpdateSchema, updateTask } from '@/lib/services/facultyService';

export const GET = route(async (request, { id }) => {
  const user = await requireFaculty(request);
  return ok(await getTaskById(user.user_id, parseId(id, 'Task ID')), 'Task details retrieved');
});

export const PUT = route(async (request, { id }) => {
  const user = await requireFaculty(request);
  const input = taskUpdateSchema.parse(await readJson(request));
  return ok(await updateTask(user.user_id, parseId(id, 'Task ID'), input), 'Task updated successfully');
});

export const DELETE = route(async (request, { id }) => {
  const user = await requireFaculty(request);
  return ok(await deleteTask(user.user_id, parseId(id, 'Task ID')), 'Task deleted');
});
