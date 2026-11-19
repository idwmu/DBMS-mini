import { requireFaculty } from '@/lib/auth';
import { ok, parseId, readJson, route } from '@/lib/http';
import { courseUpdateSchema, deleteCourse, getCourseById, updateCourse } from '@/lib/services/facultyService';

export const GET = route(async (request, { id }) => {
  const user = await requireFaculty(request);
  return ok(await getCourseById(user.user_id, parseId(id, 'Course ID')), 'Course retrieved');
});

export const PUT = route(async (request, { id }) => {
  const user = await requireFaculty(request);
  const input = courseUpdateSchema.parse(await readJson(request));
  return ok(await updateCourse(user.user_id, parseId(id, 'Course ID'), input), 'Course updated successfully');
});

export const DELETE = route(async (request, { id }) => {
  const user = await requireFaculty(request);
  return ok(await deleteCourse(user.user_id, parseId(id, 'Course ID')), 'Course deleted');
});
