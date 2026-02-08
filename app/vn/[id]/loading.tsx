'use client';

import { useEffect } from 'react';
import { VNDetailSkeleton } from '@/components/vn/VNDetailSkeleton';

export default function Loading() {
  useEffect(() => {
    document.title = 'Loading... | VN Club';
  }, []);

  return <VNDetailSkeleton />;
}
