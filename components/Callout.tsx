'use client';

import { ReactNode } from 'react';
import { MessageCircle } from 'lucide-react';

interface CalloutProps {
  children: ReactNode;
}

export function Callout({ children }: CalloutProps) {
  return (
    <blockquote className="my-6 rounded-xl bg-gradient-to-r from-slate-50 to-gray-50 dark:from-slate-900/50 dark:to-gray-900/50 border border-slate-200 dark:border-slate-700/50 overflow-hidden">
      <div className="flex gap-4 p-5">
        <div className="flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
        </div>
        <div className="flex-1 min-w-0 text-slate-700 dark:text-slate-300 [&>p]:my-0 [&>p:not(:last-child)]:mb-3">
          {children}
        </div>
      </div>
    </blockquote>
  );
}
