import { requireStudent } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/http';
import { createAvailability, getAvailability } from '@/lib/services/studentService';

export const GET = route(async (request) => {
  const user = await requireStudent(request);
  return ok(await getAvailability(user.student_id), 'Availability slots retrieved');
});

export const POST = route(async (request) => {
  const user = await requireStudent(request);
  const slot = await createAvailability(user.student_id, await readJson(request));
  return ok(slot, 'Availability block added successfully', 201);
});
