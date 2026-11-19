import { requireFaculty } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/http';
import { courseSchema, createCourse, getCourses } from '@/lib/services/facultyService';

export const GET = route(async (request) => {
  const user = await requireFaculty(request);
  return ok(await getCourses(user.user_id), 'Faculty courses retrieved');
});

export const POST = route(async (request) => {
  const user = await requireFaculty(request);
  const input = courseSchema.parse(await readJson(request));
  return ok(await createCourse(user.user_id, input), 'Course created successfully', 201);
});
