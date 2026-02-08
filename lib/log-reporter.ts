/**
 * Frontend log reporter that sends errors to the backend.
 *
 * Features:
 * - Captures global errors (window.onerror, unhandledrejection)
 * - Batches logs before sending
 * - Includes context: URL, user agent, stack trace
 * - Falls back gracefully if backend unavailable
 */

import { getBackendUrlOptional } from './config';

const BACKEND_URL = getBackendUrlOptional();

// Correlation ID for request tracing across frontend-backend
function generateCorrelationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}

// Sensitive query parameter names to redact from logged URLs
const SENSITIVE_PARAMS = ['token', 'key', 'api_key', 'apikey', 'password', 'secret', 'auth', 'session', 'jwt', 'access_token', 'refresh_token'];

/**
 * Sanitize URL to remove sensitive query parameters before logging.
 */
function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const params = parsed.searchParams;

    // Redact sensitive parameters
    for (const param of SENSITIVE_PARAMS) {
      if (params.has(param)) {
        params.set(param, '[REDACTED]');
      }
    }

    return parsed.toString();
  } catch {
    // If URL parsing fails, just return the path without query string
    return url.split('?')[0];
  }
}

// Session-level correlation ID (generated once per page session)
let sessionCorrelationId = typeof window !== 'undefined' ? generateCorrelationId() : '';

/**
 * Get the current correlation ID for request tracing.
 * Include this in API requests to trace them through the backend logs.
 */
export function getCorrelationId(): string {
  return sessionCorrelationId;
}

/**
 * Refresh the correlation ID (e.g., on significant user action or navigation).
 */
export function refreshCorrelationId(): string {
  if (typeof window !== 'undefined') {
    sessionCorrelationId = generateCorrelationId();
  }
  return sessionCorrelationId;
}

type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

interface LogEntry {
  level: LogLevel;
  message: string;
  url: string;
  userAgent?: string;
  stackTrace?: string;
  component?: string;
  extraData?: Record<string, unknown>;
  _retryCount?: number;
}

class LogReporter {
  private static instance: LogReporter | null = null;
  private queue: LogEntry[] = [];
  private flushTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly BATCH_SIZE = 10;
  private readonly FLUSH_INTERVAL = 5000; // 5 seconds
  private readonly MAX_QUEUE_SIZE = 100;
  private initialized = false;

  private constructor() {
    // Set up global error handlers only on client
    if (typeof window !== 'undefined') {
      this.setupGlobalHandlers();
      this.initialized = true;
    }
  }

  static getInstance(): LogReporter {
    if (!LogReporter.instance) {
      LogReporter.instance = new LogReporter();
    }
    return LogReporter.instance;
  }

  private setupGlobalHandlers() {
    // Handle uncaught errors
    window.addEventListener('error', (event: ErrorEvent) => {
      this.error(event.message, {
        stackTrace: event.error?.stack,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        type: 'uncaught_error',
      });
    });

    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      this.error(
        reason instanceof Error ? reason.message : String(reason),
        {
          stackTrace: reason instanceof Error ? reason.stack : undefined,
          type: 'unhandled_rejection',
        }
      );
    });
  }

  /**
   * Log an error
   */
  error(message: string, extra?: Record<string, unknown>) {
    this.log('ERROR', message, extra);
  }

  /**
   * Log a warning
   */
  warn(message: string, extra?: Record<string, unknown>) {
    this.log('WARNING', message, extra);
  }

  /**
   * Log an info message
   */
  info(message: string, extra?: Record<string, unknown>) {
    this.log('INFO', message, extra);
  }

  /**
   * Log a debug message
   */
  debug(message: string, extra?: Record<string, unknown>) {
    this.log('DEBUG', message, extra);
  }

  private log(level: LogLevel, message: string, extra?: Record<string, unknown>) {
    // Also log to console in development
    if (process.env.NODE_ENV === 'development') {
      const consoleFn = level === 'ERROR' ? console.error :
                        level === 'WARNING' ? console.warn :
                        level === 'DEBUG' ? console.debug : console.info;
      consoleFn(`[${level}]`, message, extra);
    }

    // Skip if not in browser
    if (typeof window === 'undefined') {
      return;
    }

    const entry: LogEntry = {
      level,
      message: message.slice(0, 5000), // Limit message length
      url: sanitizeUrl(window.location.href),
      userAgent: navigator.userAgent,
      stackTrace: (extra?.stackTrace as string)?.slice(0, 10000),
      component: extra?.component as string,
      extraData: extra,
    };

    // Add to queue (with max size limit)
    if (this.queue.length < this.MAX_QUEUE_SIZE) {
      this.queue.push(entry);
    }

    this.scheduleFlush();
  }

  private scheduleFlush() {
    // Flush immediately if batch is full
    if (this.queue.length >= this.BATCH_SIZE) {
      this.flush();
      return;
    }

    // Schedule flush if not already scheduled
    if (!this.flushTimeout) {
      this.flushTimeout = setTimeout(() => this.flush(), this.FLUSH_INTERVAL);
    }
  }

  private async flush() {
    // Clear timeout
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    // Nothing to flush or no backend configured
    if (this.queue.length === 0 || !BACKEND_URL) {
      return;
    }

    // Take items from queue
    const entries = this.queue.splice(0, this.BATCH_SIZE);
    const failedEntries: LogEntry[] = [];

    try {
      // Send each entry to backend
      await Promise.all(
        entries.map(async (entry) => {
          try {
            const response = await fetch(`${BACKEND_URL}/api/v1/logs/frontend`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Correlation-ID': sessionCorrelationId,
              },
              body: JSON.stringify({
                level: entry.level,
                message: entry.message,
                url: entry.url,
                user_agent: entry.userAgent,
                stack_trace: entry.stackTrace,
                component: entry.component,
                extra_data: entry.extraData,
                correlation_id: sessionCorrelationId,
              }),
            });

            if (!response.ok && response.status !== 429) {
              // Collect failed entries (except rate limit)
              failedEntries.push(entry);
            }
          } catch {
            // Network error - collect for re-queue
            failedEntries.push(entry);
          }
        })
      );

      // Re-queue failed entries with a retry limit to avoid infinite loops
      for (const entry of failedEntries) {
        const retryCount = (entry._retryCount ?? 0) + 1;
        if (retryCount <= 3 && this.queue.length < this.MAX_QUEUE_SIZE) {
          this.queue.push({ ...entry, _retryCount: retryCount });
        }
        // Entries exceeding 3 retries are silently dropped
      }
    } catch {
      // Ignore flush errors
    }

    // Schedule next flush if there are more items
    if (this.queue.length > 0) {
      this.scheduleFlush();
    }
  }

  /**
   * Force flush all pending logs (useful before page unload)
   */
  async flushSync() {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    while (this.queue.length > 0) {
      await this.flush();
    }
  }
}

// Export singleton instance
export const logReporter = LogReporter.getInstance();

// Export class for testing
export { LogReporter };
