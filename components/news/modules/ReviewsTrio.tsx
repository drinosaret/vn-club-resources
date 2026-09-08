'use client';

import type { NewsItem } from '@/lib/news';
import { ReviewRow } from '../ReviewRow';

/** Three reviews, compact, one under the other. */
export function ReviewsTrio({ items }: { items: NewsItem[] }) {
  return (
    <div className="nw-trio">
      {items.map((item) => (
        <ReviewRow key={item.id} item={item} compact />
      ))}
    </div>
  );
}
