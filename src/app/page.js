import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';

// proxy.js normally handles "/", this is a fallback
export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  redirect(user.role === 'student' ? '/student/dashboard' : '/faculty/dashboard');
}
