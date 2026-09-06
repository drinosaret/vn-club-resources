'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Info, AlertTriangle, AlertCircle, CheckCircle, Lightbulb, FileText, Quote } from 'lucide-react';

// Seven kinds against four weights: what is worth knowing, what is worth watching for, what
// will cost the reader something, and what is merely set aside. The kind itself is carried by
// the mark and the title rather than by a hue of its own.
const admonitionConfig = {
  info: { tone: 'sw-aside--note', Icon: Info },
  warning: { tone: 'sw-aside--warn', Icon: AlertTriangle },
  danger: { tone: 'sw-aside--alert', Icon: AlertCircle },
  success: { tone: 'sw-aside--note', Icon: CheckCircle },
  tip: { tone: 'sw-aside--note', Icon: Lightbulb },
  note: { tone: 'sw-aside--quiet', Icon: FileText },
  quote: { tone: 'sw-aside--quiet', Icon: Quote },
};

interface AdmonitionBlockProps {
  type: string;
  title?: string;
  children: string;
}

export function AdmonitionBlock({ type, title, children }: AdmonitionBlockProps) {
  const config = admonitionConfig[type as keyof typeof admonitionConfig] || admonitionConfig.info;
  const { Icon } = config;

  return (
    <div className={`sw-aside ${config.tone}`}>
      <div className="flex gap-3">
        <Icon className="sw-aside-mark w-4 h-4 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          {title && (
            <div className="sw-aside-title">
              {title}
            </div>
          )}
          <div className="text-[0.95rem] leading-relaxed">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                em: ({ children }) => <em className="italic">{children}</em>,
                a: ({ href, children }) => {
                  const isExternal = href?.startsWith('http');
                  const safeHref = href && (/^https?:\/\//.test(href) || href.startsWith('/')) ? href : undefined;
                  return (
                    <a href={safeHref} className="sw-link" {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                      {children}
                    </a>
                  );
                },
                ul: ({ children }) => <ul className="list-disc list-outside ml-4 space-y-1 my-3">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-outside ml-4 space-y-1 my-3">{children}</ol>,
                li: ({ children }) => <li className="pl-1">{children}</li>,
                code: ({ children }) => (
                  <code className="sw-code-inline">
                    {children}
                  </code>
                ),
              }}
            >
              {children}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}
