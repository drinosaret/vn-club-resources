'use client';

import { LoadingScreen } from '@/components/LoadingScreen';

export default function Loading() {
  return <LoadingScreen title="Loading trait stats…" subtitle="Crunching VNDB data for this trait" />;
}
