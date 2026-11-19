// =====================================================================
// studentService.js: Student profile, availability, tasks, workload,
// collisions and the deadline priority queue
// =====================================================================

import { z } from 'zod';
import { many, one, query, withTransaction } from '../db';
import { badRequest, notFound, parseDate } from '../http';
import { rGetJSON, rSet, rDelPattern } from '../redis';

// Deadline-priority responses are cached in Redis for this many seconds.
// Short TTL plus explicit invalidation on task writes keeps it fresh.
const DEADLINES_CACHE_SECONDS = Number(process.env.DEADLINES_CACHE_SECONDS || 60);
const deadlinesCacheKey = (studentId, withinDays, limit) =>
  `cache:deadlines:${studentId}:${withinDays ?? 'all'}:${limit}`;

// A fresh analysis for the default 14-day window is reused for this many
// seconds (replaces the Redis cache of the original). Every mutation that
// affects a student already writes a new analysis row, so reuse is safe.
const WORKLOAD_REUSE_SECONDS = Number(process.env.WORKLOAD_REUSE_SECONDS || 300);

const refreshStudent = (studentId, client) =>
  (client || { query }).query('SELECT sp_refresh_student($1)', [studentId]);

// ---------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------
export async function getStudentProfile(studentId) {
  const profile = await one(
    `SELECT s.student_id, s.user_id, u.username, u.email, s.roll_no,
            s.program, s.semester, s.section, s.advisor_id,
            adv.username AS advisor_name, adv.email AS advisor_email
     FROM students s
     JOIN users u ON s.user_id = u.user_id
     LEFT JOIN users adv ON s.advisor_id = adv.user_id
     WHERE s.student_id = $1`,
    [studentId]
  );
  if (!profile) throw notFound('Student profile not found');
  return profile;
}

export const profileSchema = z.object({
  program: z.string().trim().max(100).optional(),
  section: z.string().trim().max(20).optional(),
  semester: z.coerce.number().int().min(1).max(8).optional(),
  advisor_id: z.coerce.number().int().positive().optional()
});

export async function updateStudentProfile(studentId, { program, section, semester, advisor_id }) {
  await query(
    `UPDATE students
     SET program    = COALESCE($1, program),
         section    = COALESCE($2, section),
         semester   = COALESCE($3, semester),
         advisor_id = COALESCE($4, advisor_id)
     WHERE student_id = $5`,
    [program ?? null, section ?? null, semester ?? null, advisor_id ?? null, studentId]
  );
  return getStudentProfile(studentId);
}

// ---------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------
export async function getAvailability(studentId) {
  return many(
    `SELECT availability_id, student_id, start_datetime, end_datetime, available_hours, availability_type
     FROM availability
     WHERE student_id = $1
     ORDER BY start_datetime ASC`,
    [studentId]
  );
}

function hoursBetween(start, end) {
  return Math.round(((end - start) / 3_600_000) * 100) / 100;
}

async function assertNoOverlap(client, studentId, start, end, excludeId = null) {
  const { rowCount } = await client.query(
    `SELECT 1 FROM availability
     WHERE student_id = $1
       AND ($4::int IS NULL OR availability_id <> $4)
       AND start_datetime < $2
       AND end_datetime   > $3`,
    [studentId, end, start, excludeId]
  );
  if (rowCount > 0) {
    throw badRequest(
      excludeId
        ? 'Availability slot conflicts with another existing slot'
        : 'Availability slot conflicts with an existing logged block for this student'
    );
  }
}

export async function createAvailability(studentId, body) {
  const start = parseDate(body.start_datetime, 'start_datetime', { required: true });
  const end = parseDate(body.end_datetime, 'end_datetime', { required: true });
  if (end <= start) throw badRequest('End datetime must be strictly after start datetime');

  const hours = body.available_hours ? Number(body.available_hours) : hoursBetween(start, end);
  if (!(hours > 0) || hours > 999) throw badRequest('available_hours must be a positive number');

  return withTransaction(async (client) => {
    // Serialize concurrent writes for the same student so the overlap check holds
    await client.query('SELECT 1 FROM students WHERE student_id = $1 FOR UPDATE', [studentId]);
    await assertNoOverlap(client, studentId, start, end);

    const { rows: [created] } = await client.query(
      `INSERT INTO availability (student_id, start_datetime, end_datetime, available_hours, availability_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [studentId, start, end, hours, body.availability_type || 'study_block']
    );

    await refreshStudent(studentId, client);
    return created;
  });
}

export async function updateAvailability(studentId, availabilityId, body) {
  return withTransaction(async (client) => {
    await client.query('SELECT 1 FROM students WHERE student_id = $1 FOR UPDATE', [studentId]);
    const { rows: [existing] } = await client.query(
      'SELECT * FROM availability WHERE availability_id = $1 AND student_id = $2',
      [availabilityId, studentId]
    );
    if (!existing) throw notFound('Availability slot not found or not owned by student');

    const start = parseDate(body.start_datetime, 'start_datetime') || existing.start_datetime;
    const end = parseDate(body.end_datetime, 'end_datetime') || existing.end_datetime;
    if (end <= start) throw badRequest('End datetime must be strictly after start datetime');

    await assertNoOverlap(client, studentId, start, end, availabilityId);

    let hours = body.available_hours ? Number(body.available_hours) : null;
    if (!hours && (body.start_datetime || body.end_datetime)) hours = hoursBetween(start, end);

    const { rows: [updated] } = await client.query(
      `UPDATE availability
       SET start_datetime    = $1,
           end_datetime      = $2,
           available_hours   = COALESCE($3, available_hours),
           availability_type = COALESCE($4, availability_type)
       WHERE availability_id = $5 AND student_id = $6
       RETURNING *`,
      [start, end, hours, body.availability_type || null, availabilityId, studentId]
    );

    await refreshStudent(studentId, client);
    return updated;
  });
}

export async function deleteAvailability(studentId, availabilityId) {
  const { rowCount } = await query(
    'DELETE FROM availability WHERE availability_id = $1 AND student_id = $2',
    [availabilityId, studentId]
  );
  if (rowCount === 0) throw notFound('Availability slot not found');
  await refreshStudent(studentId);
  return { message: 'Availability slot deleted successfully' };
}

// ---------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------
export async function getStudentTasks(studentId) {
  return many(
    `SELECT * FROM v_student_task_overview
     WHERE student_id = $1
     ORDER BY deadline_datetime ASC`,
    [studentId]
  );
}

export const progressSchema = z.object({
  completion_percentage: z.coerce.number().min(0, 'Completion percentage must be between 0 and 100').max(100, 'Completion percentage must be between 0 and 100').optional(),
  actual_hours: z.coerce.number().min(0, 'Actual hours must be a positive number').optional(),
  status: z.enum(['assigned', 'in_progress', 'completed']).optional()
});

export async function updateTaskProgress(studentId, studentTaskId, { actual_hours, completion_percentage, status }) {
  const existing = await one(
    'SELECT * FROM student_tasks WHERE student_task_id = $1 AND student_id = $2',
    [studentTaskId, studentId]
  );
  if (!existing) throw notFound('Task assignment record not found');

  const newCompletion = completion_percentage ?? Number(existing.completion_percentage);
  let newStatus = status || existing.status;
  let submittedAt = existing.submitted_at;

  if (newCompletion >= 100) {
    newStatus = 'completed';
    if (!submittedAt) submittedAt = new Date();
  } else if (newCompletion > 0 && newStatus === 'assigned') {
    newStatus = 'in_progress';
  }

  await query(
    `UPDATE student_tasks
     SET actual_hours          = COALESCE($1, actual_hours),
         completion_percentage = $2,
         status                = $3,
         submitted_at          = $4
     WHERE student_task_id = $5 AND student_id = $6`,
    [actual_hours ?? null, newCompletion, newStatus, submittedAt, studentTaskId, studentId]
  );
  await refreshStudent(studentId);
  await rDelPattern(`cache:deadlines:${studentId}:*`); // invalidate stale cache

  return one('SELECT * FROM v_student_task_overview WHERE student_task_id = $1', [studentTaskId]);
}

export async function submitTask(studentId, studentTaskId, { actual_hours } = {}) {
  const hours = actual_hours === undefined || actual_hours === null || actual_hours === '' ? null : Number(actual_hours);
  if (hours !== null && !(hours >= 0)) throw badRequest('Actual hours must be a positive number');

  const { rowCount } = await query(
    `UPDATE student_tasks
     SET status = 'completed',
         completion_percentage = 100.00,
         submitted_at = NOW(),
         actual_hours = COALESCE($1, actual_hours)
     WHERE student_task_id = $2 AND student_id = $3`,
    [hours, studentTaskId, studentId]
  );
  if (rowCount === 0) throw notFound('Task assignment not found');
  await refreshStudent(studentId);
  await rDelPattern(`cache:deadlines:${studentId}:*`); // invalidate stale cache

  return one('SELECT * FROM v_student_task_overview WHERE student_task_id = $1', [studentTaskId]);
}

// ---------------------------------------------------------------------
// Workload analysis
// ---------------------------------------------------------------------
async function workloadHistory(studentId) {
  const rows = await many(
    `SELECT analysis_id, total_estimated_hours, available_hours,
            temporal_pressure, workload_pressure, cognitive_pressure,
            assessment_pressure, dependency_pressure, overall_risk_score,
            risk_level, calculated_at
     FROM workload_analysis
     WHERE student_id = $1
     ORDER BY analysis_id DESC
     LIMIT 7`,
    [studentId]
  );
  return rows.reverse();
}

/**
 * Returns the latest analysis plus the last 7 runs.
 * force=false reuses a recent default-window analysis instead of inserting a
 * new row on every page view; force=true always runs sp_calculate_workload.
 */
export async function getWorkloadAnalysis(studentId, { startDate, endDate, force = false } = {}) {
  const start = parseDate(startDate, 'start_date');
  const end = parseDate(endDate, 'end_date');
  if (start && end && end <= start) throw badRequest('end_date must be after start_date');
  const customWindow = Boolean(start || end);

  if (!force && !customWindow) {
    const recent = await one(
      `SELECT * FROM workload_analysis
       WHERE student_id = $1
         AND calculated_at > NOW() - make_interval(secs => $2)
         AND end_datetime - start_datetime = INTERVAL '14 days'
       ORDER BY analysis_id DESC
       LIMIT 1`,
      [studentId, WORKLOAD_REUSE_SECONDS]
    );
    if (recent) {
      return { latest: recent, history: await workloadHistory(studentId), source: 'reused' };
    }
  }

  const latest = await one('SELECT * FROM sp_calculate_workload($1, $2, $3)', [studentId, start, end]);
  return { latest, history: await workloadHistory(studentId), source: 'computed' };
}

// ---------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------
export async function getCollisions(studentId) {
  await query('SELECT sp_detect_collisions($1)', [studentId]);
  return many(
    `SELECT c.*, wa.overall_risk_score, wa.risk_level
     FROM collisions c
     LEFT JOIN workload_analysis wa ON c.analysis_id = wa.analysis_id
     WHERE c.student_id = $1
     ORDER BY c.resolved ASC, c.detected_at DESC, c.collision_id DESC`,
    [studentId]
  );
}

export async function resolveCollision(studentId, collisionId) {
  const updated = await one(
    `UPDATE collisions SET resolved = TRUE
     WHERE collision_id = $1 AND student_id = $2
     RETURNING *`,
    [collisionId, studentId]
  );
  if (!updated) throw notFound('Collision record not found');
  return updated;
}

// ---------------------------------------------------------------------
// Deadline priority queue (indexed ORDER BY deadline replaces Redis ZSET)
// ---------------------------------------------------------------------
function enrichUrgency(task) {
  const deadlineMs = new Date(task.deadline_datetime).getTime();
  const diffHours = Math.round((deadlineMs - Date.now()) / 3_600_000);
  const isOverdue = diffHours < 0;

  let urgency = 'UPCOMING';
  if (isOverdue) urgency = 'OVERDUE';
  else if (diffHours <= 24) urgency = 'DUE_TODAY';
  else if (diffHours <= 72) urgency = 'DUE_SOON';

  return {
    ...task,
    deadline_ms: deadlineMs,
    hours_until_deadline: diffHours,
    is_overdue: isOverdue,
    urgency_status: urgency
  };
}

export async function getDeadlinesPriority(studentId, { withinDays = null, limit = 10 } = {}) {
  const cacheKey = deadlinesCacheKey(studentId, withinDays, limit);

  // 1. Try Redis first (cache hit -> skip Postgres entirely)
  const cached = await rGetJSON(cacheKey);
  if (cached) return { ...cached, source: 'redis' };

  // 2. Cache miss -> query Postgres
  const rows = await many(
    `SELECT st.student_task_id, st.task_id, st.student_id,
            st.completion_percentage, st.actual_hours, st.status AS submission_status,
            t.title AS task_title, t.description, t.task_type,
            t.deadline_datetime, t.estimated_hours, t.difficulty_level,
            t.cognitive_load, t.assessment_weight,
            c.course_code, c.course_name
     FROM student_tasks st
     JOIN tasks t   ON st.task_id = t.task_id
     JOIN courses c ON t.course_id = c.course_id
     WHERE st.student_id = $1
       AND st.status <> 'completed'
       AND st.completion_percentage < 100
       AND ($2::int IS NULL OR t.deadline_datetime <= NOW() + make_interval(days => $2))
     ORDER BY t.deadline_datetime ASC
     LIMIT $3`,
    [studentId, withinDays, limit]
  );

  const tasks = rows.map((t, i) => ({ ...enrichUrgency(t), priority_rank: i + 1 }));
  const result = { tasks, total: tasks.length, source: 'postgres' };

  // 3. Store in Redis for the next request within the TTL
  await rSet(cacheKey, result, DEADLINES_CACHE_SECONDS);
  return result;
}
