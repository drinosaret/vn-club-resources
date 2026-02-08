'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Info, AlertTriangle, AlertCircle, CheckCircle, Lightbulb, FileText, Quote } from 'lucide-react';

const admonitionConfig = {
  info: {
    gradient: 'from-blue-50 to-blue-50/50 dark:from-blue-950/40 dark:to-blue-900/20',
    border: 'border-blue-200 dark:border-blue-700/50',
    badgeBg: 'bg-blue-100 dark:bg-blue-900/50',
    iconColor: 'text-blue-600 dark:text-blue-400',
    titleColor: 'text-blue-800 dark:text-blue-200',
    Icon: Info,
  },
  warning: {
    gradient: 'from-amber-50 to-amber-50/50 dark:from-amber-950/40 dark:to-amber-900/20',
    border: 'border-amber-200 dark:border-amber-700/50',
    badgeBg: 'bg-amber-100 dark:bg-amber-900/50',
    iconColor: 'text-amber-600 dark:text-amber-400',
    titleColor: 'text-amber-800 dark:text-amber-200',
    Icon: AlertTriangle,
  },
  danger: {
    gradient: 'from-red-50 to-red-50/50 dark:from-red-950/40 dark:to-red-900/20',
    border: 'border-red-200 dark:border-red-700/50',
    badgeBg: 'bg-red-100 dark:bg-red-900/50',
    iconColor: 'text-red-600 dark:text-red-400',
    titleColor: 'text-red-800 dark:text-red-200',
    Icon: AlertCircle,
  },
  success: {
    gradient: 'from-emerald-50 to-emerald-50/50 dark:from-emerald-950/40 dark:to-emerald-900/20',
    border: 'border-emerald-200 dark:border-emerald-700/50',
    badgeBg: 'bg-emerald-100 dark:bg-emerald-900/50',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    titleColor: 'text-emerald-800 dark:text-emerald-200',
    Icon: CheckCircle,
  },
  tip: {
    gradient: 'from-violet-50 to-violet-50/50 dark:from-violet-950/40 dark:to-violet-900/20',
    border: 'border-violet-200 dark:border-violet-700/50',
    badgeBg: 'bg-violet-100 dark:bg-violet-900/50',
    iconColor: 'text-violet-600 dark:text-violet-400',
    titleColor: 'text-violet-800 dark:text-violet-200',
    Icon: Lightbulb,
  },
  note: {
    gradient: 'from-gray-50 to-gray-50/50 dark:from-gray-900/50 dark:to-gray-800/30',
    border: 'border-gray-200 dark:border-gray-700/50',
    badgeBg: 'bg-gray-100 dark:bg-gray-800/50',
    iconColor: 'text-gray-600 dark:text-gray-400',
    titleColor: 'text-gray-800 dark:text-gray-200',
    Icon: FileText,
  },
  quote: {
    gradient: 'from-slate-50 to-slate-50/50 dark:from-slate-900/50 dark:to-slate-800/30',
    border: 'border-slate-200 dark:border-slate-700/50',
    badgeBg: 'bg-slate-100 dark:bg-slate-800/50',
    iconColor: 'text-slate-600 dark:text-slate-400',
    titleColor: 'text-slate-800 dark:text-slate-200',
    Icon: Quote,
  },
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
    <div className={`rounded-xl bg-gradient-to-r ${config.gradient} border ${config.border} overflow-hidden`}>
      <div className="flex gap-4 p-5">
        <div className="flex-shrink-0">
          <div className={`w-10 h-10 rounded-full ${config.badgeBg} flex items-center justify-center`}>
            <Icon className={`w-5 h-5 ${config.iconColor}`} />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          {title && (
            <div className={`font-semibold mb-2 ${config.titleColor}`}>
              {title}
            </div>
          )}
          <div className="text-slate-700 dark:text-slate-300 text-[0.95rem] leading-relaxed">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                em: ({ children }) => <em className="italic">{children}</em>,
                a: ({ href, children }) => {
                  const safeHref = href && /^https?:\/\//.test(href) ? href : undefined;
                  return (
                    <a href={safeHref} className="text-indigo-600 dark:text-indigo-400 hover:underline" rel="noopener noreferrer">
                      {children}
                    </a>
                  );
                },
                ul: ({ children }) => <ul className="list-disc list-outside ml-4 space-y-1 my-3">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-outside ml-4 space-y-1 my-3">{children}</ol>,
                li: ({ children }) => <li className="pl-1">{children}</li>,
                code: ({ children }) => (
                  <code className="bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded text-sm font-mono">
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
