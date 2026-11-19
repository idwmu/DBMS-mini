// =====================================================================
// authService.js: Registration, login and profile lookup
// =====================================================================

import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { one, withTransaction } from '../db';
import { HttpError } from '../http';
import { signToken } from '../jwt';

export const registerSchema = z.object({
  username: z.string().trim().min(3, 'Username must be between 3 and 50 characters').max(50, 'Username must be between 3 and 50 characters'),
  email: z.string().trim().toLowerCase().pipe(z.email('Please provide a valid email address')),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  // Admin accounts are not self-service; create them directly in the database.
  role: z.enum(['student', 'faculty'], { message: 'Role must be student or faculty' }),
  roll_no: z.string().trim().max(50).optional().or(z.literal('')),
  program: z.string().trim().max(100).optional(),
  semester: z.coerce.number().int().min(1).max(8).optional(),
  section: z.string().trim().max(20).optional(),
  advisor_id: z.coerce.number().int().positive().optional().nullable()
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Valid email required')),
  password: z.string().min(1, 'Password is required')
});

export async function registerUser(input) {
  const { username, email, password, role, roll_no, program, semester, section, advisor_id } = input;

  const result = await withTransaction(async (client) => {
    const existing = await client.query(
      'SELECT user_id FROM users WHERE LOWER(email) = $1 OR username = $2',
      [email, username]
    );
    if (existing.rowCount > 0) {
      throw new HttpError(409, 'Username or email already registered', 'Duplicate Entry');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { rows: [user] } = await client.query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING user_id, username, email, role, created_at`,
      [username, email, passwordHash, role]
    );

    let student = null;
    if (role === 'student') {
      const sem = semester || 4;
      const { rows: [s] } = await client.query(
        `INSERT INTO students (user_id, roll_no, program, semester, section, advisor_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING student_id, roll_no, program, semester, section, advisor_id`,
        [
          user.user_id,
          roll_no || `ROLL-${Date.now().toString().slice(-6)}`,
          program || 'Computer Science',
          sem,
          section || 'A',
          advisor_id || null
        ]
      );
      student = s;

      // Enroll into existing tasks of the student's semester
      // (the AFTER INSERT trigger computes their first workload analysis)
      await client.query(
        `INSERT INTO student_tasks (student_id, task_id, status, actual_hours, completion_percentage)
         SELECT $1, t.task_id, 'assigned', 0, 0
         FROM tasks t JOIN courses c ON t.course_id = c.course_id
         WHERE c.semester = $2
         ON CONFLICT (student_id, task_id) DO NOTHING`,
        [student.student_id, sem]
      );
    }

    return { user, student };
  });

  const { user, student } = result;
  const token = await signToken({
    user_id: user.user_id,
    username: user.username,
    email: user.email,
    role: user.role,
    ...(student ? { student_id: student.student_id } : {})
  });

  return { token, user: { ...user, ...(student || {}) } };
}

export async function loginUser({ email, password }) {
  const user = await one(
    'SELECT user_id, username, email, password_hash, role, created_at FROM users WHERE LOWER(email) = $1',
    [email]
  );
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, 'Invalid email or password', 'Unauthorized');
  }
  delete user.password_hash;

  let student = null;
  if (user.role === 'student') {
    student = await one(
      'SELECT student_id, roll_no, program, semester, section, advisor_id FROM students WHERE user_id = $1',
      [user.user_id]
    );
  }

  const token = await signToken({
    user_id: user.user_id,
    username: user.username,
    email: user.email,
    role: user.role,
    ...(student ? { student_id: student.student_id } : {})
  });

  return { token, user: { ...user, ...(student || {}) } };
}

export async function getCurrentUser(userId) {
  const user = await one(
    'SELECT user_id, username, email, role, created_at FROM users WHERE user_id = $1',
    [userId]
  );
  if (!user) throw new HttpError(404, 'User not found', 'NotFound');

  if (user.role === 'student') {
    const student = await one(
      `SELECT s.student_id, s.roll_no, s.program, s.semester, s.section, s.advisor_id,
              adv.username AS advisor_name
       FROM students s
       LEFT JOIN users adv ON s.advisor_id = adv.user_id
       WHERE s.user_id = $1`,
      [user.user_id]
    );
    if (student) Object.assign(user, student);
  }
  return user;
}
