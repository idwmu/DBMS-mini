'use client';

// =====================================================================
// Footer.jsx: Directory navigation footer & project information
// =====================================================================

import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';

const INFO = {
  schema: 'Database schema: student_workload (10 normalized PostgreSQL tables, foreign keys, CHECK constraints, CASCADE / SET NULL rules).',
  procedures: 'PL/pgSQL functions: sp_calculate_workload, sp_detect_collisions, sp_assign_task_to_students, sp_simulate_deadline_change. Views: v_student_task_overview, v_course_risk_summary, v_high_risk_students, v_latest_workload.',
  triggers: 'Triggers: trg_prevent_circular_dependencies (recursive CTE), trg_tasks_deadline_check, trg_student_tasks_after_insert.',
  transactions: 'ACID transactions: multi-step writes (registration, task creation, availability with row locks) run inside BEGIN / COMMIT with automatic rollback.',
  stack: 'Tech stack: Next.js (App Router, route handlers), PostgreSQL (node-postgres pool), React, Recharts.',
  tests: 'API test suite: node:test integration tests covering auth, student workflow, faculty workflow, triggers and the simulator.',
  security: 'Security: JWT in an httpOnly cookie (or Bearer header), bcrypt password hashing, zod input validation, server-side route guard.',
  design: 'Design system: photography-first museum interface, SF Pro type stack, Action Blue #0066cc, light and dark themes.',
  terms: 'Terms of academic use: designed for a Database Management Systems course project.',
  privacy: 'Privacy: student study schedules and task progress are stored only in your PostgreSQL database.',
  viva: 'DBMS viva ready: functions, triggers, views and transactions are all demonstrable from the UI.'
};

function InfoLink({ id, children }) {
  return (
    <a
      href={`#${id}`}
      onClick={(e) => {
        e.preventDefault();
        alert(INFO[id]);
      }}
    >
      {children}
    </a>
  );
}

export default function Footer() {
  const { isStudent, isFaculty } = useAuth();
  const pick = (student, faculty, fallback = '/login') => (isStudent ? student : isFaculty ? faculty : fallback);

  return (
    <footer className="footer-container">
      <div className="footer-content">
        <div className="footer-grid">
          <div className="footer-col">
            <h4>Analytical Engine</h4>
            <ul>
              <li><Link href={pick('/student/collisions', '/faculty/simulator')}>Deadline Collision Detection</Link></li>
              <li><Link href={isFaculty ? '/faculty/simulations' : '/login'}>Simulation History Log</Link></li>
            </ul>
          </div>

          <div className="footer-col">
            <h4>Academic Portal</h4>
            <ul>
              <li><Link href={pick('/student/dashboard', '/faculty/dashboard')}>Command Dashboard</Link></li>
              <li><Link href={pick('/student/tasks', '/faculty/tasks')}>Task Management</Link></li>
              <li>
                <Link href={pick('/student/availability', '/faculty/courses')}>
                  {isStudent ? 'Study Availability Calendar' : 'Course Cohort Management'}
                </Link>
              </li>
              <li><Link href="/register">Create Academic Account</Link></li>
            </ul>
          </div>

          <div className="footer-col">
            <h4>Database Architecture</h4>
            <ul>
              <li><InfoLink id="schema">Relational Schema (10 Tables)</InfoLink></li>
              <li><InfoLink id="procedures">PL/pgSQL Functions &amp; Views</InfoLink></li>
              <li><InfoLink id="triggers">Automated Triggers</InfoLink></li>
              <li><InfoLink id="transactions">ACID Concurrency Safety</InfoLink></li>
            </ul>
          </div>

          <div className="footer-col">
            <h4>System &amp; Stack</h4>
            <ul>
              <li><InfoLink id="stack">Full-Stack Architecture</InfoLink></li>
              <li><InfoLink id="tests">Automated Test Suite</InfoLink></li>
              <li><InfoLink id="security">JWT &amp; Bcrypt Security</InfoLink></li>
              <li><InfoLink id="design">Design System Reference</InfoLink></li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <div>
            Copyright © 2026 Student Workload &amp; Deadline Collision Analyzer. DBMS Course Project. All rights reserved.
          </div>
          <div className="footer-links-inline">
            <InfoLink id="terms">Terms of Use</InfoLink>
            <InfoLink id="privacy">Privacy Policy</InfoLink>
            <InfoLink id="viva">DBMS Viva Guide</InfoLink>
          </div>
        </div>
      </div>
    </footer>
  );
}
