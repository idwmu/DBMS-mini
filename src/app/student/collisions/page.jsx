'use client';

// =====================================================================
// CollisionsPage.jsx: Collision Detection & Resolution Center (Apple Design)
// =====================================================================

import { useState, useEffect } from 'react';
import { api } from '@/lib/client';
import CollisionCard from '@/components/CollisionCard';

export default function CollisionsPage() {
  const [collisions, setCollisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('active');

  const fetchCollisions = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get('/student/collisions');
      setCollisions(res || []);
    } catch (err) {
      setError(err.message || 'Failed to load collisions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCollisions();
  }, []);

  const handleResolve = async (collisionId) => {
    try {
      await api.patch(`/student/collisions/${collisionId}/resolve`, {
        notes: 'Resolved by student via collision center'
      });
      fetchCollisions();
    } catch (err) {
      alert(`Resolution failed: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner"></div>
        <p>Analyzing schedule for deadline collisions...</p>
      </div>
    );
  }

  const activeList = collisions.filter((c) => !c.resolved);
  const resolvedList = collisions.filter((c) => c.resolved);
  const displayedList = tab === 'active' ? activeList : tab === 'resolved' ? resolvedList : collisions;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Deadline Collision Center</h1>
        </div>

        {/* Tab Switcher Pills */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setTab('active')}
            className={`btn btn-sm ${tab === 'active' ? 'btn-primary' : 'btn-secondary'}`}
          >
            Active Conflicts ({activeList.length})
          </button>
          <button
            onClick={() => setTab('resolved')}
            className={`btn btn-sm ${tab === 'resolved' ? 'btn-primary' : 'btn-secondary'}`}
          >
            Resolved Log ({resolvedList.length})
          </button>
          <button
            onClick={() => setTab('all')}
            className={`btn btn-sm ${tab === 'all' ? 'btn-primary' : 'btn-secondary'}`}
          >
            All ({collisions.length})
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Collision List */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '17px', fontWeight: 600 }}>
            {tab === 'active' ? 'Active Collisions Requiring Resolution' : tab === 'resolved' ? 'Resolved Collisions Archive' : 'All Detected Collisions'}
          </h3>
          <span style={{ fontSize: '13px', color: 'var(--ink-secondary)' }}>
            Showing {displayedList.length} items
          </span>
        </div>

        {displayedList.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">✅</div>
            <p style={{ fontWeight: 600, fontSize: '16px', color: 'var(--ink)' }}>All Clear!</p>
            <p style={{ fontSize: '14px', color: 'var(--ink-secondary)', marginTop: '4px' }}>
              No collisions found in this view. All assignments and study hours are safely scheduled.
            </p>
          </div>
        ) : (
          <div>
            {displayedList.map((col) => (
              <CollisionCard
                key={col.collision_id}
                collision={col}
                onResolve={handleResolve}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
