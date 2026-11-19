// =====================================================================
// facultyService.js: Courses, tasks, dependencies, cohort risk and the
// what-if deadline simulator
// =====================================================================

import { z } from 'zod';
import { many, one, query, withTransaction } from '../db';
import { badRequest, notFound, parseDate } from '../http';

// Recompute workload + collisions for students affected by a task change
// (the original only invalidated a Redis cache; recomputing keeps faculty
// risk views current too).
async function refreshStudents(studentIds, client) {
  const runner = client || { query };
  for (const id of new Set(studentIds)) {
    await runner.query('SELECT sp_refresh_student($1)', [id]);
  }
}

async function studentsForTask(taskId, client) {
  const { rows } = await (client || { query }).query(
    'SELECT DISTINCT student_id FROM student_tasks WHERE task_id = $1',
    [taskId]
  );
  return rows.map((r) => r.student_id);
}

// ---------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------
export async function getCourses(facultyId) {
  return many(
    `SELECT c.*,
            COUNT(DISTINCT t.task_id)::int    AS total_tasks,
            COUNT(DISTINCT s.student_id)::int AS total_enrolled_students,
            COALESCE(ROUND(AVG(st.completion_percentage), 2), 0) AS avg_completion_percentage
     FROM courses c
     LEFT JOIN tasks t          ON c.course_id = t.course_id
     LEFT JOIN students s       ON s.semester = c.semester
     LEFT JOIN student_tasks st ON st.task_id = t.task_id AND st.student_id = s.student_id
     WHERE c.faculty_id = $1
     GROUP BY c.course_id
     ORDER BY c.course_code ASC`,
    [facultyId]
  );
}

export const courseSchema = z.object({
  course_code: z.string().trim().min(1, 'Course code is required').max(50),
  course_name: z.string().trim().min(1, 'Course name is required').max(150),
  semester: z.coerce.number({ message: 'Semester must be between 1 and 8' }).int().min(1, 'Semester must be between 1 and 8').max(8, 'Semester must be between 1 and 8'),
  credits: z.coerce.number().int().min(1, 'Credits must be an integer').max(10, 'Credits must be an integer').optional()
});

export const courseUpdateSchema = courseSchema.partial();

export async function createCourse(facultyId, { course_code, course_name, credits, semester }) {
  return one(
    `INSERT INTO courses (course_code, course_name, faculty_id, credits, semester)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [course_code.toUpperCase(), course_name, facultyId, credits || 3, semester]
  );
}

export async function getCourseById(facultyId, courseId) {
  const course = await one('SELECT * FROM courses WHERE course_id = $1 AND faculty_id = $2', [courseId, facultyId]);
  if (!course) throw notFound('Course not found or access unauthorized');
  return course;
}

export async function updateCourse(facultyId, courseId, { course_code, course_name, credits, semester }) {
  await getCourseById(facultyId, courseId);
  return one(
    `UPDATE courses
     SET course_code = COALESCE($1, course_code),
         course_name = COALESCE($2, course_name),
         credits     = COALESCE($3, credits),
         semester    = COALESCE($4, semester)
     WHERE course_id = $5 AND faculty_id = $6
     RETURNING *`,
    [course_code?.toUpperCase() ?? null, course_name ?? null, credits ?? null, semester ?? null, courseId, facultyId]
  );
}

export async function deleteCourse(facultyId, courseId) {
  await getCourseById(facultyId, courseId);
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT DISTINCT st.student_id
       FROM tasks t JOIN student_tasks st ON t.task_id = st.task_id
       WHERE t.course_id = $1`,
      [courseId]
    );
    await client.query('DELETE FROM courses WHERE course_id = $1 AND faculty_id = $2', [courseId, facultyId]);
    await refreshStudents(rows.map((r) => r.student_id), client);
  });
  return { message: 'Course and associated tasks deleted successfully' };
}

// ---------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------
export async function getTasks(facultyId, courseId = null) {
  return many(
    `SELECT t.*, c.course_code, c.course_name, c.semester,
            COUNT(DISTINCT st.student_id)::int AS assigned_students,
            COALESCE(ROUND(AVG(st.completion_percentage), 2), 0) AS avg_completion_percentage
     FROM tasks t
     JOIN courses c ON t.course_id = c.course_id
     LEFT JOIN student_tasks st ON t.task_id = st.task_id
     WHERE c.faculty_id = $1
       AND ($2::int IS NULL OR t.course_id = $2)
     GROUP BY t.task_id, c.course_id
     ORDER BY t.deadline_datetime ASC`,
    [facultyId, courseId]
  );
}

const optionalNumber = (schema) => z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());

export const taskSchema = z.object({
  course_id: z.coerce.number({ message: 'Valid course_id is required' }).int().positive('Valid course_id is required'),
  title: z.string().trim().min(1, 'Task title is required').max(200),
  description: z.string().optional(),
  task_type: z.string().trim().max(50).optional(),
  release_datetime: z.any().optional(),
  deadline_datetime: z.any().refine((v) => v !== undefined && v !== null && v !== '', 'deadline_datetime is required'),
  estimated_hours: optionalNumber(z.coerce.number().min(0, 'Estimated hours must be positive').max(99999)),
  difficulty_level: optionalNumber(z.coerce.number().int().min(1, 'Difficulty level must be 1 to 5').max(5, 'Difficulty level must be 1 to 5')),
  cognitive_load: optionalNumber(z.coerce.number().int().min(1, 'Cognitive load must be 1 to 10').max(10, 'Cognitive load must be 1 to 10')),
  assessment_weight: optionalNumber(z.coerce.number().min(0, 'Assessment weight must be between 0 and 100').max(100, 'Assessment weight must be between 0 and 100')),
  is_team_task: z.boolean().optional()
});

export const taskUpdateSchema = taskSchema
  .omit({ course_id: true })
  .partial()
  .extend({ status: z.string().trim().max(50).optional() });

export async function createTask(facultyId, input) {
  await getCourseById(facultyId, input.course_id);

  const release = parseDate(input.release_datetime, 'release_datetime') || new Date();
  const deadline = parseDate(input.deadline_datetime, 'deadline_datetime', { required: true });
  if (deadline <= release) throw badRequest('Deadline datetime must be strictly after release datetime');

  const taskId = await withTransaction(async (client) => {
    const { rows: [task] } = await client.query(
      `INSERT INTO tasks (
         course_id, title, description, task_type,
         release_datetime, deadline_datetime, estimated_hours,
         difficulty_level, cognitive_load, assessment_weight,
         is_team_task, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active')
       RETURNING task_id`,
      [
        input.course_id,
        input.title,
        input.description || '',
        input.task_type || 'assignment',
        release,
        deadline,
        input.estimated_hours ?? 5.0,
        input.difficulty_level ?? 3,
        input.cognitive_load ?? 5,
        input.assessment_weight ?? 10.0,
        Boolean(input.is_team_task)
      ]
    );
    // Assigns to the semester cohort; the student_tasks trigger recomputes each student's workload
    await client.query('SELECT sp_assign_task_to_students($1)', [task.task_id]);
    return task.task_id;
  });

  return one(
    `SELECT t.*, c.course_code, c.course_name
     FROM tasks t JOIN courses c ON t.course_id = c.course_id
     WHERE t.task_id = $1`,
    [taskId]
  );
}

export async function getTaskById(facultyId, taskId) {
  const task = await one(
    `SELECT t.*, c.course_code, c.course_name, c.semester, c.faculty_id
     FROM tasks t JOIN courses c ON t.course_id = c.course_id
     WHERE t.task_id = $1 AND c.faculty_id = $2`,
    [taskId, facultyId]
  );
  if (!task) throw notFound('Task not found or unauthorized');

  task.prerequisites = await many(
    `SELECT td.dependency_id, td.prerequisite_task_id, td.dependency_type,
            pt.title AS prerequisite_title, pt.deadline_datetime AS prerequisite_deadline
     FROM task_dependencies td
     JOIN tasks pt ON td.prerequisite_task_id = pt.task_id
     WHERE td.task_id = $1
     ORDER BY pt.deadline_datetime`,
    [taskId]
  );
  return task;
}

export async function updateTask(facultyId, taskId, fields) {
  await getTaskById(facultyId, taskId);

  const release = parseDate(fields.release_datetime, 'release_datetime');
  const deadline = parseDate(fields.deadline_datetime, 'deadline_datetime');

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE tasks
       SET title             = COALESCE($1, title),
           description       = COALESCE($2, description),
           task_type         = COALESCE($3, task_type),
           release_datetime  = COALESCE($4, release_datetime),
           deadline_datetime = COALESCE($5, deadline_datetime),
           estimated_hours   = COALESCE($6, estimated_hours),
           difficulty_level  = COALESCE($7, difficulty_level),
           cognitive_load    = COALESCE($8, cognitive_load),
           assessment_weight = COALESCE($9, assessment_weight),
           is_team_task      = COALESCE($10, is_team_task),
           status            = COALESCE($11, status)
       WHERE task_id = $12`,
      [
        fields.title ?? null,
        fields.description ?? null,
        fields.task_type ?? null,
        release,
        deadline,
        fields.estimated_hours ?? null,
        fields.difficulty_level ?? null,
        fields.cognitive_load ?? null,
        fields.assessment_weight ?? null,
        fields.is_team_task ?? null,
        fields.status ?? null,
        taskId
      ]
    );
    await refreshStudents(await studentsForTask(taskId, client), client);
  });

  return getTaskById(facultyId, taskId);
}

export async function deleteTask(facultyId, taskId) {
  await getTaskById(facultyId, taskId);
  await withTransaction(async (client) => {
    const studentIds = await studentsForTask(taskId, client);
    await client.query('DELETE FROM tasks WHERE task_id = $1', [taskId]);
    await refreshStudents(studentIds, client);
  });
  return { message: 'Task deleted successfully' };
}

// ---------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------
export const dependencySchema = z.object({
  prerequisite_task_id: z.coerce.number({ message: 'prerequisite_task_id is required' }).int().positive('prerequisite_task_id is required'),
  dependency_type: z.string().trim().max(50).optional()
});

export async function addDependency(facultyId, taskId, { prerequisite_task_id, dependency_type }) {
  await getTaskById(facultyId, taskId);
  if (taskId === prerequisite_task_id) throw badRequest('A task cannot depend on itself');

  const prereq = await one('SELECT task_id FROM tasks WHERE task_id = $1', [prerequisite_task_id]);
  if (!prereq) throw notFound('Prerequisite task does not exist');

  return withTransaction(async (client) => {
    // trg_prevent_circular_dependencies rejects cycles with SQLSTATE P0001
    const { rows: [dep] } = await client.query(
      `INSERT INTO task_dependencies (task_id, prerequisite_task_id, dependency_type)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [taskId, prerequisite_task_id, dependency_type || 'hard_prerequisite']
    );
    await refreshStudents(await studentsForTask(taskId, client), client);
    return dep;
  });
}

export async function deleteDependency(facultyId, taskId, prerequisiteTaskId) {
  await getTaskById(facultyId, taskId);
  await withTransaction(async (client) => {
    await client.query(
      'DELETE FROM task_dependencies WHERE task_id = $1 AND prerequisite_task_id = $2',
      [taskId, prerequisiteTaskId]
    );
    await refreshStudents(await studentsForTask(taskId, client), client);
  });
  return { message: 'Dependency removed successfully' };
}

export async function getTaskStudents(facultyId, taskId) {
  await getTaskById(facultyId, taskId);
  return many(
    `SELECT st.student_task_id, st.student_id, s.roll_no, u.username AS student_name,
            u.email AS student_email, s.section, s.program,
            st.assigned_at, st.status, st.actual_hours, st.completion_percentage,
            st.submitted_at, st.score
     FROM student_tasks st
     JOIN students s ON st.student_id = s.student_id
     JOIN users u    ON s.user_id = u.user_id
     WHERE st.task_id = $1
     ORDER BY s.roll_no ASC`,
    [taskId]
  );
}

// ---------------------------------------------------------------------
// Simulator
// ---------------------------------------------------------------------
export const simulationSchema = z.object({
  task_id: z.coerce.number({ message: 'Valid task_id is required' }).int().positive('Valid task_id is required'),
  proposed_deadline: z.any().refine((v) => v !== undefined && v !== null && v !== '', 'proposed_deadline is required')
});

const SIMULATION_SELECT = `
  SELECT s.*, t.title AS task_title, c.course_code, c.course_name
  FROM simulations s
  JOIN tasks t   ON s.task_id = t.task_id
  JOIN courses c ON t.course_id = c.course_id`;

export async function runSimulation(facultyId, { task_id, proposed_deadline }) {
  await getTaskById(facultyId, task_id);
  const proposed = parseDate(proposed_deadline, 'proposed_deadline', { required: true });

  const sim = await one('SELECT * FROM sp_simulate_deadline_change($1, $2, $3)', [task_id, proposed, facultyId]);
  return one(`${SIMULATION_SELECT} WHERE s.simulation_id = $1`, [sim.simulation_id]);
}

export async function getSimulations(facultyId) {
  return many(`${SIMULATION_SELECT} WHERE s.faculty_id = $1 ORDER BY s.created_at DESC, s.simulation_id DESC`, [facultyId]);
}

// ---------------------------------------------------------------------
// Cohort risk
// ---------------------------------------------------------------------
export async function getCourseRiskSummary(facultyId, courseId) {
  await getCourseById(facultyId, courseId);

  const course = await one('SELECT * FROM v_course_risk_summary WHERE course_id = $1', [courseId]);
  const enrolledStudents = await many(
    `SELECT s.student_id, s.roll_no, u.username AS student_name, u.email,
            s.section, s.semester,
            COALESCE(lw.overall_risk_score, 0)  AS overall_risk_score,
            COALESCE(lw.risk_level, 'LOW')      AS risk_level,
            COALESCE(lw.temporal_pressure, 0)   AS temporal_pressure,
            COALESCE(lw.workload_pressure, 0)   AS workload_pressure,
            COALESCE(lw.cognitive_pressure, 0)  AS cognitive_pressure,
            COALESCE(lw.assessment_pressure, 0) AS assessment_pressure,
            COALESCE(lw.dependency_pressure, 0) AS dependency_pressure,
            (SELECT COUNT(*) FROM collisions col
              WHERE col.student_id = s.student_id AND col.resolved = FALSE)::int AS active_collisions
     FROM courses c
     JOIN students s ON c.semester = s.semester
     JOIN users u    ON s.user_id = u.user_id
     LEFT JOIN v_latest_workload lw ON lw.student_id = s.student_id
     WHERE c.course_id = $1
     ORDER BY lw.overall_risk_score DESC NULLS LAST, s.roll_no`,
    [courseId]
  );

  return { course, enrolled_students: enrolledStudents };
}
