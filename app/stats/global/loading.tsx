'use client';

import { LoadingScreen } from '@/components/LoadingScreen';

export default function Loading() {
  return <LoadingScreen title="Loading global stats…" subtitle="Aggregating VNDB-wide numbers" />;
}
