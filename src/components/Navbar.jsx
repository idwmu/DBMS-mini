'use client';

// =====================================================================
// Navbar.jsx: Frosted glass navigation bar with theme toggle
// =====================================================================

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';

const STUDENT_LINKS = [
  ['/student/dashboard', 'Dashboard'],
  ['/student/tasks', 'Tasks'],
  ['/student/availability', 'Availability'],
  ['/student/collisions', 'Collisions']
];

const FACULTY_LINKS = [
  ['/faculty/dashboard', 'Dashboard'],
  ['/faculty/courses', 'Courses'],
  ['/faculty/tasks', 'Tasks'],
  ['/faculty/simulator', 'Simulator'],
  ['/faculty/simulations', 'History']
];

export default function Navbar() {
  const { user, logout, isStudent, isFaculty } = useAuth();
  const { toggleTheme, isDark } = useTheme();
  const pathname = usePathname();

  const links = isStudent ? STUDENT_LINKS : isFaculty ? FACULTY_LINKS : [];
  const isActive = (href) => pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));

  return (
    <header className="navbar-container">
      <div className="nav-wrapper">
        <Link href="/" className="nav-brand">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
            <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span>Workload Analyzer</span>
        </Link>

        <nav className="nav-links">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className={`nav-link ${isActive(href) ? 'active' : ''}`}>
              {label}
            </Link>
          ))}
        </nav>

        <div className="nav-actions">
          <button
            type="button"
            onClick={toggleTheme}
            className="apple-theme-toggle"
            title={`Switch to ${isDark ? 'Light' : 'Dark'} Mode`}
            aria-label="Toggle visual theme"
          >
            {isDark ? '🌙 Dark' : '☀️ Light'}
          </button>

          {user ? (
            <>
              <span className={`role-tag ${user.role}`}>{user.role}</span>
              <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--ink)' }}>{user.username}</span>
              <button onClick={logout} className="btn btn-secondary btn-sm">
                Sign Out
              </button>
            </>
          ) : (
            <Link href="/login" className="btn btn-primary btn-sm">
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
