import { requireFaculty } from '@/lib/auth';
import { ok, parseId, readJson, route } from '@/lib/http';
import { createTask, getTasks, taskSchema } from '@/lib/services/facultyService';

export const GET = route(async (request) => {
  const user = await requireFaculty(request);
  const courseId = request.nextUrl.searchParams.get('course_id');
  return ok(await getTasks(user.user_id, courseId ? parseId(courseId, 'course_id') : null), 'Tasks retrieved');
});

export const POST = route(async (request) => {
  const user = await requireFaculty(request);
  const input = taskSchema.parse(await readJson(request));
  return ok(await createTask(user.user_id, input), 'Task created and automatically assigned to semester cohort', 201);
});
