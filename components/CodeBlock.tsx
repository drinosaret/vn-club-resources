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
    } catch {
      // Clipboard copy failed - silently ignore
    }
  };

  return (
    <div className="relative group">
      <pre
        ref={preRef}
        className="sw-code my-6 overflow-x-auto"
      >
        {children}
      </pre>
      <button
        onClick={handleCopy}
        className="sw-act sw-act--icon absolute top-2.5 right-2.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        aria-label="Copy code"
      >
        {copied ? (
          <Check className="w-4 h-4 sw-tick" />
        ) : (
          <Copy className="w-4 h-4" />
        )}
      </button>
    </div>
  );
}
