import { requireStudent } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/http';
import { getWorkloadAnalysis } from '@/lib/services/studentService';

export const POST = route(async (request) => {
  const user = await requireStudent(request);
  const { start_date, end_date } = await readJson(request);
  const data = await getWorkloadAnalysis(user.student_id, { startDate: start_date, endDate: end_date, force: true });
  return ok(data, 'Workload analysis recalculated');
});
