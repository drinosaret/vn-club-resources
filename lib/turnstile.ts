/**
 * Cloudflare Turnstile integration for bot protection.
 *
 * Uses invisible mode — no UI widget. Tokens are fetched on demand
 * via the JS API and sent with protected requests.
 *
 * Requires NEXT_PUBLIC_TURNSTILE_SITE_KEY to be set. If missing,
 * all calls gracefully return null (no token sent, backend skips check).
 */

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptLoaded = false;
let scriptLoading: Promise<void> | null = null;

/** Load the Turnstile script if not already loaded. */
function loadScript(): Promise<void> {
  if (scriptLoaded) return Promise.resolve();
  if (scriptLoading) return scriptLoading;
  if (!SITE_KEY) return Promise.resolve();

  scriptLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => { scriptLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('Failed to load Turnstile'));
    document.head.appendChild(script);
  });
  return scriptLoading;
}

/**
 * Get a Turnstile token for the given action.
 * Returns null if Turnstile is not configured or fails.
 */
export async function getTurnstileToken(action?: string): Promise<string | null> {
  if (!SITE_KEY) return null;

  try {
    await loadScript();
  } catch {
    console.warn('[turnstile] Script load failed');
    return null;
  }

  const turnstile = (window as unknown as { turnstile?: TurnstileAPI }).turnstile;
  if (!turnstile) return null;

  return new Promise<string | null>((resolve) => {
    // Create a hidden container for the invisible widget
    const container = document.createElement('div');
    container.style.display = 'none';
    document.body.appendChild(container);

    let widgetId: string | undefined;
    let settled = false;

    const settle = (value: string | null) => {
      if (settled) return;
      settled = true;
      if (widgetId != null) {
        try { turnstile.remove(widgetId); } catch { /* ignore */ }
      }
      container.remove();
      resolve(value);
    };

    try {
      widgetId = turnstile.render(container, {
        sitekey: SITE_KEY,
        size: 'invisible',
        action,
        callback: (token: string) => { settle(token); },
        'error-callback': () => { settle(null); },
        'timeout-callback': () => { settle(null); },
      });
    } catch {
      settle(null);
    }

    // Safety timeout — don't hang forever
    setTimeout(() => { settle(null); }, 10_000);
  });
}

interface TurnstileAPI {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
}
