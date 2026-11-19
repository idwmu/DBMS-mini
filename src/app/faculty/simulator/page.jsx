import { Suspense } from 'react';
import SimulatorClient from './SimulatorClient';

export const metadata = { title: 'What-If Simulator • Workload Analyzer' };

export default function SimulatorPage() {
  return (
    <Suspense fallback={null}>
      <SimulatorClient />
    </Suspense>
  );
}
