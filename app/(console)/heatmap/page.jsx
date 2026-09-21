import { Suspense } from 'react';
import Heatmap from '@/views/Heatmap';

export const metadata = { title: 'Sector heatmap — APIx' };

// Heatmap reads ?metric= via useSearchParams, which opts the subtree out of
// prerendering. The boundary keeps that scoped to this page instead of
// bailing out the whole route.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <Heatmap />
    </Suspense>
  );
}
