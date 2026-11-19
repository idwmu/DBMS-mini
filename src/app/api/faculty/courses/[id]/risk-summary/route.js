import { requireFaculty } from '@/lib/auth';
import { ok, parseId, route } from '@/lib/http';
import { getCourseRiskSummary } from '@/lib/services/facultyService';

export const GET = route(async (request, { id }) => {
  const user = await requireFaculty(request);
  return ok(await getCourseRiskSummary(user.user_id, parseId(id, 'Course ID')), 'Course risk summary retrieved');
});
