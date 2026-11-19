import { Suspense } from 'react';
import LoginForm from './LoginForm';

export const metadata = { title: 'Sign In • Workload Analyzer' };

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
