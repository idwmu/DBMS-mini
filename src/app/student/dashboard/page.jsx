'use client';

// =====================================================================
// Dashboard.jsx: Student Central Command Dashboard (Apple Design)
// =====================================================================

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client';
import RiskBadge from '@/components/RiskBadge';
import CollisionCard from '@/components/CollisionCard';

export default function StudentDashboard() {
  const [workload, setWorkload] = useState(null);
  const [collisions, setCollisions] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [priorityDeadlines, setPriorityDeadlines] = useState([]);
  const [priorityFilter, setPriorityFilter] = useState('all'); // 'all', '1', '2', '7'
  const [prioritySource, setPrioritySource] = useState('postgres');
  const [priorityLoading, setPriorityLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPriorityDeadlines = async (filterKey = 'all') => {
    try {
      setPriorityLoading(true);
      const query = filterKey === 'all' ? '' : `?withinDays=${filterKey}`;
      const res = await api.get(`/student/deadlines/priority${query}`);
      setPriorityDeadlines(res?.tasks || []);
      setPrioritySource(res?.source || 'postgres');
    } catch (err) {
      console.warn('Failed to load priority deadlines:', err);
    } finally {
      setPriorityLoading(false);
    }
  };

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [workloadRes, collisionsRes, tasksRes] = await Promise.all([
        api.get('/student/workload/current'),
        api.get('/student/collisions'),
        api.get('/student/tasks')
      ]);

      setWorkload(workloadRes?.latest || null);
      setCollisions(collisionsRes || []);
      setTasks(tasksRes || []);
      await fetchPriorityDeadlines(priorityFilter);
    } catch (err) {
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const handleFilterChange = (filterKey) => {
    setPriorityFilter(filterKey);
    fetchPriorityDeadlines(filterKey);
  };

  const handleResolveCollision = async (collisionId) => {
    try {
      await api.patch(`/student/collisions/${collisionId}/resolve`, {
        notes: 'Reviewed and resolved by student'
      });
      fetchDashboardData();
    } catch (err) {
      alert(`Failed to resolve collision: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner"></div>
        <p>Loading workload metrics & deadlines...</p>
      </div>
    );
  }

  const activeCollisions = collisions.filter(c => !c.resolved);
  const pendingTasks = tasks.filter(t => t.submission_status !== 'completed' && Number(t.completion_percentage) < 100);
  const upcomingDeadlines = pendingTasks.slice(0, 4);

  return (
    <div className="dashboard-page">
      {/* ─── Apple Header Row ─── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
        </div>
        <div>
          {workload && (
            <RiskBadge level={workload.risk_level} score={workload.overall_risk_score} />
          )}
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* ─── Keynote Hero Banner ─── */}
      <div className="keynote-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h3>Balance your semester with proactive workload intelligence.</h3>
            <p>
              Calculate your 5-dimensional workload pressure, monitor study availability hours,
              detect 48-hour deadline clusters, and resolve conflicting exam submissions before final grades are impacted.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Link href="/student/availability" className="btn btn-primary btn-sm">
              Log Study Hours
            </Link>
          </div>
        </div>
      </div>

      {/* Critical Alert Banner if High / Critical Risk */}
      {workload && (workload.risk_level === 'HIGH' || workload.risk_level === 'CRITICAL') && (
        <div className="card" style={{ borderLeft: '4px solid var(--status-high)', marginBottom: '24px', backgroundColor: 'var(--status-high-bg)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--status-high-text)', fontSize: '15px' }}>
                High Workload Warning: {workload.risk_level} Risk Level ({Number(workload.overall_risk_score).toFixed(1)}%)
              </div>
              <div style={{ fontSize: '13px', color: 'var(--ink)', marginTop: '4px' }}>
                Your required task effort ({workload.total_estimated_hours}h) exceeds available study hours ({workload.available_hours}h) with {activeCollisions.length} active deadline collisions.
              </div>
            </div>
            <Link href="/student/availability" className="btn btn-primary btn-sm">
              Adjust Availability Calendar
            </Link>
          </div>
        </div>
      )}

      {/* Metric Cards Grid */}
      <div className="grid-cols-4" style={{ marginBottom: '24px' }}>
        <div className="stat-card">
          <div className="stat-icon">📚</div>
          <div>
            <div className="stat-label">Pending Tasks</div>
            <div className="stat-value">{pendingTasks.length}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">⏱️</div>
          <div>
            <div className="stat-label">Required Study</div>
            <div className="stat-value">{workload?.total_estimated_hours || 0}h</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">🗓️</div>
          <div>
            <div className="stat-label">Available Study</div>
            <div className="stat-value">{workload?.available_hours || 0}h</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">⚠️</div>
          <div>
            <div className="stat-label">Active Collisions</div>
            <div className="stat-value">{activeCollisions.length}</div>
          </div>
        </div>
      </div>

      {/* Smart Deadline Priority Card */}
      <div style={{ marginBottom: '24px' }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ fontSize: '17px', fontWeight: 600 }}>Smart Deadline Priority</h3>
            </div>
            <Link href="/student/tasks" style={{ fontSize: '13px', fontWeight: 500 }}>
              All Tasks →
            </Link>
          </div>

          {/* Time Filter Pills */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
            {[
              { key: 'all', label: 'All' },
              { key: '1', label: '24 Hours' },
              { key: '2', label: '48 Hours' },
              { key: '7', label: '7 Days' }
            ].map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => handleFilterChange(f.key)}
                style={{
                  fontSize: '12px',
                  fontWeight: 500,
                  padding: '4px 12px',
                  borderRadius: 'var(--radius-pill)',
                  border: priorityFilter === f.key ? '1px solid var(--primary)' : '1px solid var(--hairline)',
                  backgroundColor: priorityFilter === f.key ? 'var(--primary)' : 'var(--canvas-parchment)',
                  color: priorityFilter === f.key ? '#ffffff' : 'var(--ink-secondary)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          {priorityLoading ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--ink-secondary)', fontSize: '13px' }}>
              Updating priority queue...
            </div>
          ) : priorityDeadlines.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px 16px' }}>
              <p>No task deadlines due within this time horizon. Your academic queue is balanced!</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {priorityDeadlines.slice(0, 5).map((t, idx) => (
                <div
                  key={t.student_task_id || t.task_id}
                  style={{
                    padding: '14px 16px',
                    backgroundColor: 'var(--canvas-parchment)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--hairline)',
                    position: 'relative'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          backgroundColor: 'var(--surface)',
                          color: 'var(--ink-secondary)',
                          padding: '2px 6px',
                          borderRadius: 'var(--radius-xs)',
                          border: '1px solid var(--hairline)',
                          marginTop: '2px'
                        }}
                      >
                        #{t.priority_rank || idx + 1}
                      </span>
                      <div>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--primary)' }}>
                          {t.course_code}
                        </span>
                        <h4 style={{ fontSize: '14px', fontWeight: 600, marginTop: '2px' }}>
                          {t.task_title}
                        </h4>
                      </div>
                    </div>

                    <div>
                      {t.urgency_status === 'OVERDUE' || t.is_overdue ? (
                        <span className="severity-pill HIGH">OVERDUE</span>
                      ) : t.urgency_status === 'DUE_TODAY' ? (
                        <span className="severity-pill MEDIUM">DUE TODAY</span>
                      ) : t.urgency_status === 'DUE_SOON' ? (
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 'var(--radius-pill)',
                            backgroundColor: 'var(--status-medium-bg)',
                            color: 'var(--status-medium-text)',
                            border: '1px solid var(--hairline)'
                          }}
                        >
                          DUE SOON
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 500,
                            color: 'var(--ink-secondary)',
                            backgroundColor: 'var(--surface)',
                            padding: '2px 8px',
                            borderRadius: 'var(--radius-pill)',
                            border: '1px solid var(--hairline)'
                          }}
                        >
                          In {t.hours_until_deadline}h
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--ink-secondary)', marginTop: '8px' }}>
                    <span>
                      Due: {new Date(t.deadline_datetime).toLocaleDateString()} ({t.is_overdue ? `Overdue by ${Math.abs(t.hours_until_deadline)}h` : `${t.hours_until_deadline}h remaining`})
                    </span>
                    <span>{t.estimated_hours}h effort • {t.assessment_weight}% wt</span>
                  </div>

                  <div className="progress-bar-container">
                    <div
                      className={`progress-bar-fill ${Number(t.completion_percentage) >= 100 ? 'completed' : ''}`}
                      style={{ width: `${t.completion_percentage}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Active Collisions Card */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3 style={{ fontSize: '17px', fontWeight: 600 }}>
              Detected Collision Events ({activeCollisions.length})
            </h3>
          </div>
          <Link href="/student/collisions" style={{ fontSize: '13px', fontWeight: 500 }}>
            Collision Center →
          </Link>
        </div>

        {activeCollisions.length === 0 ? (
          <div className="empty-state" style={{ padding: '32px 16px' }}>
            <p>No active collisions detected. All course deadlines and study blocks are evenly spaced.</p>
          </div>
        ) : (
          <div>
            {activeCollisions.slice(0, 3).map((col) => (
              <CollisionCard
                key={col.collision_id}
                collision={col}
                onResolve={handleResolveCollision}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
