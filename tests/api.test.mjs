// =====================================================================
// API integration tests (node:test). Run against a running server:
//   npm run db:setup && npm run dev      (in one terminal)
//   npm test                              (in another)
// BASE_URL defaults to http://localhost:3000
// =====================================================================

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://localhost:3000';

async function call(method, path, { token, body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, body: json, headers: res.headers };
}

async function login(email, password = 'password123') {
  const res = await call('POST', '/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, `login failed for ${email}: ${JSON.stringify(res.body)}`);
  return res.body.data.token;
}

const inDays = (d, hours = 0) => new Date(Date.now() + d * 86_400_000 + hours * 3_600_000).toISOString();

describe('Health', () => {
  test('GET /api/health reports database connectivity', async () => {
    const res = await call('GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.database, 'connected');
  });

  test('Unknown endpoints return a JSON 404', async () => {
    const res = await call('GET', '/does/not/exist');
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });
});

describe('Auth', () => {
  const uniq = Date.now();
  const user = {
    username: `test_student_${uniq}`,
    email: `test_${uniq}@university.edu`,
    password: 'password123',
    role: 'student',
    roll_no: `TEST-${uniq}`,
    semester: 4
  };

  test('POST /auth/register registers a new student, enrolls them and sets a cookie', async () => {
    const res = await call('POST', '/auth/register', { body: user });
    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.token);
    assert.equal(res.body.data.user.email, user.email);
    assert.equal(res.body.data.user.role, 'student');
    assert.match(res.headers.get('set-cookie') || '', /wa_token=.*HttpOnly/i);

    const tasks = await call('GET', '/student/tasks', { token: res.body.data.token });
    assert.ok(tasks.body.data.length >= 8, 'new semester-4 student is enrolled in existing tasks');
  });

  test('POST /auth/register rejects a duplicate email with 409', async () => {
    const res = await call('POST', '/auth/register', { body: user });
    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
  });

  test('POST /auth/register validates input', async () => {
    const res = await call('POST', '/auth/register', { body: { ...user, email: 'nope', username: 'x' } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Validation Error');
  });

  test('POST /auth/register refuses self-service admin accounts', async () => {
    const res = await call('POST', '/auth/register', {
      body: { ...user, username: `adm_${uniq}`, email: `adm_${uniq}@u.edu`, role: 'admin' }
    });
    assert.equal(res.status, 400);
  });

  test('POST /auth/login succeeds with valid credentials (case-insensitive email)', async () => {
    const res = await call('POST', '/auth/login', { body: { email: user.email.toUpperCase(), password: user.password } });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.token);
    assert.equal(res.body.data.user.email, user.email);
  });

  test('POST /auth/login rejects an invalid password', async () => {
    const res = await call('POST', '/auth/login', { body: { email: user.email, password: 'wrongpassword' } });
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  test('GET /auth/me works with a Bearer token and with the session cookie', async () => {
    const loginRes = await call('POST', '/auth/login', { body: { email: user.email, password: user.password } });
    const me = await call('GET', '/auth/me', { token: loginRes.body.data.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.data.email, user.email);

    const cookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];
    const meCookie = await call('GET', '/auth/me', { cookie });
    assert.equal(meCookie.status, 200);
  });

  test('GET /auth/me rejects requests without a token', async () => {
    const res = await call('GET', '/auth/me');
    assert.equal(res.status, 401);
  });

  test('Seeded demo password works (bcrypt $2b$ hash)', async () => {
    await login('alice@university.edu');
  });
});

describe('Student workflow', () => {
  let token;
  let studentTaskId;

  before(async () => {
    token = await login('alice@university.edu');
  });

  test('Students cannot reach faculty endpoints (403)', async () => {
    const res = await call('GET', '/faculty/courses', { token });
    assert.equal(res.status, 403);
  });

  test('GET /student/profile returns the academic profile', async () => {
    const res = await call('GET', '/student/profile', { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.roll_no, 'CS2024-001');
    assert.equal(res.body.data.semester, 4);
  });

  test('GET /student/tasks returns assigned tasks with numeric fields', async () => {
    const res = await call('GET', '/student/tasks', { token });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length > 0);
    const pending = res.body.data.find((t) => t.submission_status !== 'completed');
    assert.equal(typeof pending.estimated_hours, 'number');
    assert.equal(typeof pending.is_overdue, 'boolean');
    studentTaskId = pending.student_task_id;
  });

  test('PATCH /student/tasks/:id/progress updates completion', async () => {
    const res = await call('PATCH', `/student/tasks/${studentTaskId}/progress`, {
      token,
      body: { completion_percentage: 60, actual_hours: 4 }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.completion_percentage, 60);
    assert.equal(res.body.data.submission_status, 'in_progress');
  });

  test('PATCH progress rejects out-of-range values', async () => {
    const res = await call('PATCH', `/student/tasks/${studentTaskId}/progress`, { token, body: { completion_percentage: 140 } });
    assert.equal(res.status, 400);
  });

  test('POST /student/availability creates a slot, and overlapping slots are rejected', async () => {
    const start = inDays(20);
    const end = inDays(20, 3);
    const res = await call('POST', '/student/availability', {
      token,
      body: { start_datetime: start, end_datetime: end, availability_type: 'study_block' }
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.data.availability_id);
    assert.equal(res.body.data.available_hours, 3);

    const overlap = await call('POST', '/student/availability', {
      token,
      body: { start_datetime: inDays(20, 1), end_datetime: inDays(20, 5) }
    });
    assert.equal(overlap.status, 400);

    const del = await call('DELETE', `/student/availability/${res.body.data.availability_id}`, { token });
    assert.equal(del.status, 200);
  });

  test('POST /student/availability rejects end before start', async () => {
    const res = await call('POST', '/student/availability', {
      token,
      body: { start_datetime: inDays(30, 4), end_datetime: inDays(30) }
    });
    assert.equal(res.status, 400);
  });

  test('GET /student/workload returns the 5 pressures and a risk level', async () => {
    const res = await call('GET', '/student/workload', { token });
    assert.equal(res.status, 200);
    const a = res.body.data.latest;
    for (const k of ['temporal_pressure', 'workload_pressure', 'cognitive_pressure', 'assessment_pressure', 'dependency_pressure', 'overall_risk_score']) {
      assert.equal(typeof a[k], 'number', k);
    }
    assert.ok(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(a.risk_level));
  });

  test('GET /student/workload/current reuses a recent analysis instead of inserting a new row', async () => {
    const first = await call('GET', '/student/workload/current', { token });
    const second = await call('GET', '/student/workload/current', { token });
    assert.equal(second.status, 200);
    assert.ok(Array.isArray(second.body.data.history));
    assert.equal(second.body.data.source, 'reused');
    assert.equal(second.body.data.latest.analysis_id, first.body.data.latest.analysis_id);
  });

  test('POST /student/workload/calculate forces a new analysis', async () => {
    const before = await call('GET', '/student/workload/current', { token });
    const res = await call('POST', '/student/workload/calculate', { token, body: {} });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.source, 'computed');
    assert.ok(res.body.data.latest.analysis_id > before.body.data.latest.analysis_id);
  });

  test('GET /student/deadlines/priority returns deadline-ordered tasks with urgency', async () => {
    const res = await call('GET', '/student/deadlines/priority?withinDays=7&limit=5', { token });
    assert.equal(res.status, 200);
    const tasks = res.body.data.tasks;
    assert.ok(tasks.length > 0);
    for (let i = 1; i < tasks.length; i++) {
      assert.ok(new Date(tasks[i].deadline_datetime) >= new Date(tasks[i - 1].deadline_datetime));
    }
    assert.equal(tasks[0].priority_rank, 1);
    assert.ok(['OVERDUE', 'DUE_TODAY', 'DUE_SOON', 'UPCOMING'].includes(tasks[0].urgency_status));

    const bad = await call('GET', '/student/deadlines/priority?limit=500', { token });
    assert.equal(bad.status, 400);
  });

  test('GET /student/collisions returns detected collisions; resolve marks one resolved', async () => {
    const res = await call('GET', '/student/collisions', { token });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length > 0);
    const active = res.body.data.find((c) => !c.resolved);
    const resolved = await call('PATCH', `/student/collisions/${active.collision_id}/resolve`, { token });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.data.resolved, true);
  });

  test('POST /student/tasks/:id/submit completes a task', async () => {
    const res = await call('POST', `/student/tasks/${studentTaskId}/submit`, { token, body: { actual_hours: 6 } });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.submission_status, 'completed');
    assert.equal(res.body.data.completion_percentage, 100);

    const queue = await call('GET', '/student/deadlines/priority', { token });
    assert.ok(!queue.body.data.tasks.some((t) => t.student_task_id === studentTaskId), 'completed task leaves the priority queue');
  });

  test("Students cannot modify another student's records (404)", async () => {
    const bob = await login('bob@university.edu');
    const res = await call('PATCH', `/student/tasks/${studentTaskId}/progress`, { token: bob, body: { completion_percentage: 10 } });
    assert.equal(res.status, 404);
  });
});

describe('Faculty workflow', () => {
  let token;
  let courseId;
  let taskId;

  before(async () => {
    token = await login('sarah@university.edu');
  });

  test('Faculty cannot reach student endpoints (403)', async () => {
    const res = await call('GET', '/student/tasks', { token });
    assert.equal(res.status, 403);
  });

  test('GET /faculty/courses lists the faculty member’s courses', async () => {
    const res = await call('GET', '/faculty/courses', { token });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length > 0);
    const cs401 = res.body.data.find((c) => c.course_code === 'CS401');
    assert.ok(cs401);
    assert.equal(cs401.total_enrolled_students >= 4, true);
    courseId = cs401.course_id;
  });

  test('POST /faculty/courses creates a course; duplicate code returns 409', async () => {
    const code = `T${Date.now().toString().slice(-6)}`;
    const res = await call('POST', '/faculty/courses', { token, body: { course_code: code, course_name: 'Test Course', semester: 7, credits: 3 } });
    assert.equal(res.status, 201);
    const dup = await call('POST', '/faculty/courses', { token, body: { course_code: code, course_name: 'Dup', semester: 7 } });
    assert.equal(dup.status, 409);
    const del = await call('DELETE', `/faculty/courses/${res.body.data.course_id}`, { token });
    assert.equal(del.status, 200);
  });

  test('POST /faculty/tasks creates a task and auto-assigns the semester cohort', async () => {
    const res = await call('POST', '/faculty/tasks', {
      token,
      body: {
        course_id: courseId,
        title: 'Integration Test Assignment',
        description: 'Created by the test suite',
        task_type: 'assignment',
        release_datetime: new Date().toISOString(),
        deadline_datetime: inDays(10),
        estimated_hours: 6,
        difficulty_level: 3,
        cognitive_load: 5,
        assessment_weight: 10,
        is_team_task: false
      }
    });
    assert.equal(res.status, 201);
    taskId = res.body.data.task_id;
    assert.ok(taskId);
  });

  test('POST /faculty/tasks rejects deadline before release (validated + trigger-backed)', async () => {
    const res = await call('POST', '/faculty/tasks', {
      token,
      body: { course_id: courseId, title: 'Bad dates', release_datetime: inDays(5), deadline_datetime: inDays(2) }
    });
    assert.equal(res.status, 400);
  });

  test('PUT /faculty/tasks/:id cannot move the deadline before release (DB trigger)', async () => {
    const res = await call('PUT', `/faculty/tasks/${taskId}`, { token, body: { deadline_datetime: inDays(-30) } });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /deadline_datetime must be strictly after release_datetime/);
  });

  test('PUT /faculty/tasks/:id updates fields', async () => {
    const res = await call('PUT', `/faculty/tasks/${taskId}`, { token, body: { title: 'Renamed Test Assignment', estimated_hours: 7.5 } });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.title, 'Renamed Test Assignment');
    assert.equal(res.body.data.estimated_hours, 7.5);
  });

  test('GET /faculty/tasks/:id/students lists the assigned roster', async () => {
    const res = await call('GET', `/faculty/tasks/${taskId}/students`, { token });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 4);
  });

  test('Dependencies: add, and circular chains are rejected by the trigger', async () => {
    const add = await call('POST', `/faculty/tasks/${taskId}/dependencies`, { token, body: { prerequisite_task_id: 4 } });
    assert.equal(add.status, 201);

    // 4 already depends on 2 (seed), and now taskId depends on 4. Making 2 depend on taskId closes a cycle.
    const cycle = await call('POST', '/faculty/tasks/2/dependencies', { token, body: { prerequisite_task_id: taskId } });
    assert.equal(cycle.status, 400);
    assert.match(cycle.body.message, /Circular dependency/);

    const self = await call('POST', `/faculty/tasks/${taskId}/dependencies`, { token, body: { prerequisite_task_id: taskId } });
    assert.equal(self.status, 400);

    const detail = await call('GET', `/faculty/tasks/${taskId}`, { token });
    assert.equal(detail.body.data.prerequisites.length, 1);

    const rm = await call('DELETE', `/faculty/tasks/${taskId}/dependencies/4`, { token });
    assert.equal(rm.status, 200);
  });

  test('POST /faculty/simulations simulates a deadline change', async () => {
    const res = await call('POST', '/faculty/simulations', { token, body: { task_id: 3, proposed_deadline: inDays(11) } });
    assert.equal(res.status, 201);
    for (const k of ['simulation_id', 'original_risk', 'projected_risk', 'impact_score', 'recommendation', 'task_title']) {
      assert.ok(res.body.data[k] !== undefined, k);
    }
  });

  test('Simulation into a crowded window is NOT RECOMMENDED', async () => {
    // Task 4 (day 14, nothing nearby) moved into the day 3-5 cluster of tasks 1, 2, 3, 5, 6
    const res = await call('POST', '/faculty/simulator/run', { token, body: { task_id: 4, proposed_deadline: inDays(4, 12) } });
    assert.equal(res.status, 201);
    assert.match(res.body.data.recommendation, /^NOT RECOMMENDED/);
    assert.ok(res.body.data.impact_score > 0);
  });

  test('POST /faculty/simulator/run accepts "YYYY-MM-DD HH:mm:ss" strings', async () => {
    const d = new Date(Date.now() + 12 * 86_400_000);
    const pad = (n) => String(n).padStart(2, '0');
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 10:00:00`;
    const res = await call('POST', '/faculty/simulator/run', { token, body: { task_id: 3, proposed_deadline: local } });
    assert.equal(res.status, 201);
  });

  test('GET /faculty/simulations and /simulator/history return the audit log', async () => {
    const a = await call('GET', '/faculty/simulations', { token });
    const b = await call('GET', '/faculty/simulator/history', { token });
    assert.equal(a.status, 200);
    assert.ok(a.body.data.length >= 3);
    assert.equal(b.body.data.length, a.body.data.length);
  });

  test("Simulating another faculty member's task returns 404", async () => {
    const res = await call('POST', '/faculty/simulations', { token, body: { task_id: 5, proposed_deadline: inDays(8) } });
    assert.equal(res.status, 404);
  });

  test('GET /faculty/courses/:id/risk-summary returns aggregates and per-student risk', async () => {
    const res = await call('GET', `/faculty/courses/${courseId}/risk-summary`, { token });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.course);
    assert.ok(res.body.data.enrolled_students.length >= 4);
    assert.equal(typeof res.body.data.enrolled_students[0].overall_risk_score, 'number');
  });

  test('DELETE /faculty/tasks/:id removes the task', async () => {
    const res = await call('DELETE', `/faculty/tasks/${taskId}`, { token });
    assert.equal(res.status, 200);
    const gone = await call('GET', `/faculty/tasks/${taskId}`, { token });
    assert.equal(gone.status, 404);
  });
});
