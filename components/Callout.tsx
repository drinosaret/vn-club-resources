'use client';

import { ReactNode } from 'react';
import { MessageCircle } from 'lucide-react';

interface CalloutProps {
  children: ReactNode;
}

export function Callout({ children }: CalloutProps) {
  return (
    <blockquote className="sw-aside sw-aside--quiet my-6">
      <div className="flex gap-3">
        <MessageCircle className="sw-aside-mark w-4 h-4 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 [&>p]:my-0 [&>p:not(:last-child)]:mb-3">
          {children}
        </div>
      </div>
    </blockquote>
  );
}
