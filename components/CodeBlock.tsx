'use client';

import { useState, ReactNode, useRef } from 'react';
import { Check, Copy } from 'lucide-react';

interface CodeBlockProps {
  children: ReactNode;
}

export function CodeBlock({ children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  const handleCopy = async () => {
    const text = preRef.current?.textContent || '';

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="relative group">
      <pre
        ref={preRef}
        className="bg-gray-100 dark:bg-gray-800 p-4 pr-12 rounded-lg my-6 overflow-x-auto text-sm"
      >
        {children}
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-3 right-3 p-1.5 rounded-md bg-gray-200 dark:bg-gray-700 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-300 dark:hover:bg-gray-600"
        aria-label="Copy code"
      >
        {copied ? (
          <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
        ) : (
          <Copy className="w-4 h-4 text-gray-600 dark:text-gray-400" />
        )}
      </button>
    </div>
  );
}
