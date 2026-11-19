import { requireStudent } from '@/lib/auth';
import { ok, route } from '@/lib/http';
import { getWorkloadAnalysis } from '@/lib/services/studentService';

export const GET = route(async (request) => {
  const user = await requireStudent(request);
  const params = request.nextUrl.searchParams;
  const data = await getWorkloadAnalysis(user.student_id, {
    startDate: params.get('start_date'),
    endDate: params.get('end_date')
  });
  return ok(data, 'Workload analysis calculated');
});
