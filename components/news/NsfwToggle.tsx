'use client';

import type { Locale } from '@/lib/i18n/types';
import { ns } from '@/lib/i18n/translations/news';
import { useNSFWRevealContext } from '@/lib/nsfw-reveal';

/**
 * The site's own "show NSFW uncensored" setting, placed on the page: the same switch the
 * header's settings menu holds, since a reader of a news page full of blurred covers may
 * not know to look there. The server renders the setting off, and the provider reads the
 * saved choice after mount, so the markup never disagrees with the client.
 */
export function NsfwToggle({ locale }: { locale: Locale }) {
  const nsfw = useNSFWRevealContext();
  if (!nsfw) return null;
  const on = nsfw.allRevealed;
  return (
    <button
      type="button"
      className={on ? 'nw-locale nw-locale--on' : 'nw-locale'}
      aria-pressed={on}
      title={ns(locale, 'nsfw.title')}
      onClick={() => nsfw.setAllRevealed(!on)}
    >
      {ns(locale, on ? 'nsfw.on' : 'nsfw.off')}
    </button>
  );
}
