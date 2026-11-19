import { requireFaculty } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/http';
import { getSimulations, runSimulation, simulationSchema } from '@/lib/services/facultyService';

export const GET = route(async (request) => {
  const user = await requireFaculty(request);
  return ok(await getSimulations(user.user_id), 'Simulation history retrieved');
});

export const POST = route(async (request) => {
  const user = await requireFaculty(request);
  const input = simulationSchema.parse(await readJson(request));
  return ok(await runSimulation(user.user_id, input), 'Simulation executed successfully', 201);
});
