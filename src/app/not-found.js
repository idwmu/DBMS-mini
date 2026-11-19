import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="card empty-state" style={{ maxWidth: '480px', margin: '4rem auto', padding: '3rem 2rem' }}>
      <div className="empty-state-icon">🧭</div>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>Page Not Found</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        The requested URL does not exist or has been relocated.
      </p>
      <Link href="/" className="btn btn-primary">
        Return to Home
      </Link>
    </div>
  );
}
