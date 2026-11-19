import { requireStudent } from '@/lib/auth';
import { badRequest, ok, route } from '@/lib/http';
import { getDeadlinesPriority } from '@/lib/services/studentService';

export const GET = route(async (request) => {
  const user = await requireStudent(request);
  const params = request.nextUrl.searchParams;

  let withinDays = null;
  if (params.has('withinDays')) {
    withinDays = Number(params.get('withinDays'));
    if (!Number.isInteger(withinDays) || withinDays < 1) throw badRequest('withinDays must be a positive integer');
  }
  let limit = 10;
  if (params.has('limit')) {
    limit = Number(params.get('limit'));
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw badRequest('limit must be between 1 and 100');
  }

  const result = await getDeadlinesPriority(user.student_id, { withinDays, limit });
  return ok(result, 'Priority deadlines retrieved successfully');
});
