import { requireStudent } from '@/lib/auth';
import { ok, parseId, readJson, route } from '@/lib/http';
import { deleteAvailability, updateAvailability } from '@/lib/services/studentService';

export const PUT = route(async (request, { id }) => {
  const user = await requireStudent(request);
  const slotId = parseId(id, 'Availability ID');
  return ok(await updateAvailability(user.student_id, slotId, await readJson(request)), 'Availability block updated successfully');
});

export const DELETE = route(async (request, { id }) => {
  const user = await requireStudent(request);
  return ok(await deleteAvailability(user.student_id, parseId(id, 'Availability ID')), 'Availability block deleted');
});
