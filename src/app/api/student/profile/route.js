import { requireStudent } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/http';
import { getStudentProfile, profileSchema, updateStudentProfile } from '@/lib/services/studentService';

export const GET = route(async (request) => {
  const user = await requireStudent(request);
  return ok(await getStudentProfile(user.student_id), 'Student profile retrieved');
});

export const PUT = route(async (request) => {
  const user = await requireStudent(request);
  const input = profileSchema.parse(await readJson(request));
  return ok(await updateStudentProfile(user.student_id, input), 'Student profile updated successfully');
});
