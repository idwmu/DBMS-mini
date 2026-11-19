import { query } from '@/lib/db';
import { ok, route } from '@/lib/http';

export const GET = route(async () => {
  let database = 'connected';
  try {
    await query('SELECT 1');
  } catch {
    database = 'unreachable';
  }
  return ok(
    {
      status: database === 'connected' ? 'UP' : 'DEGRADED',
      timestamp: new Date().toISOString(),
      service: 'Student Workload & Deadline Collision Analyzer API',
      database
    },
    database === 'connected' ? 'System operational' : 'Database unreachable',
    database === 'connected' ? 200 : 503
  );
});
