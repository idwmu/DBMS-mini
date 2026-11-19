import { requireStudent } from '@/lib/auth';
import { ok, route } from '@/lib/http';
import { getStudentTasks } from '@/lib/services/studentService';

export const GET = route(async (request) => {
  const user = await requireStudent(request);
  return ok(await getStudentTasks(user.student_id), 'Assigned tasks retrieved');
});
