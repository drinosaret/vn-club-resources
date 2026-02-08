'use client';

import { LoadingScreen } from '@/components/LoadingScreen';

export default function Loading() {
  return <LoadingScreen title="Loading tag stats…" subtitle="Crunching VNDB data for this tag" />;
}
