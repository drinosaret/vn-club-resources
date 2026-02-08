'use client';

import { Component, ReactNode } from 'react';
import { logReporter } from '@/lib/log-reporter';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Sanitize stack trace to remove sensitive information like absolute paths
 * and user-specific directory names.
 */
function sanitizeStackTrace(stack: string | undefined): string | undefined {
  if (!stack) return undefined;

  return stack
    // Remove absolute paths, keep just filename
    .replace(/(?:at\s+)?(?:[A-Za-z]:)?(?:\/[\w.-]+)+\//g, '')
    // Remove user directory paths (Windows and Unix)
    .replace(/(?:C:\\Users\\[^\\]+\\|\/home\/[^/]+\/|\/Users\/[^/]+\/)/gi, '')
    // Truncate to reasonable length
    .slice(0, 2000);
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Report to backend with sanitized stack traces
    logReporter.error(error.message, {
      stackTrace: sanitizeStackTrace(error.stack),
      componentStack: sanitizeStackTrace(errorInfo.componentStack ?? undefined),
      component: 'ErrorBoundary',
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-white dark:bg-gray-900">
          <div className="text-center">
            <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              Something went wrong
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              The page failed to load properly.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
