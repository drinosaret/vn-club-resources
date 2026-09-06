'use client';

import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { hasJapanese } from './vn-utils';

interface VNTitleProps {
  title: string;
  titleJp?: string;
  titleRomaji?: string;
  olang?: string;
}

/** Take only the first line of a potentially multi-line alias string */
function firstLine(text: string): string {
  return text.split(/\\n|\n/)[0].trim();
}

/**
 * The title block.
 *
 * The Japanese form leads where there is one and every other form follows beneath it, which
 * is the script the title is read in and the order every list on the site uses. The reader's
 * stored preference decides the heading only for a title with no Japanese form at all.
 */
export function VNTitle({ title, titleJp, titleRomaji }: VNTitleProps) {
  const { preference } = useTitlePreference();

  // Clean title fields; VNDB aliases can be \n-separated
  const cleanJp = titleJp ? firstLine(titleJp) : undefined;
  const cleanRomaji = titleRomaji ? firstLine(titleRomaji) : undefined;
  const cleanTitle = title ? firstLine(title) : undefined;

  const japanese = cleanJp && hasJapanese(cleanJp) ? cleanJp : undefined;
  const primaryTitle = japanese
    ?? getDisplayTitle({ title, title_jp: titleJp, title_romaji: titleRomaji }, preference);
  const primaryIsJapanese = hasJapanese(primaryTitle);

  // Build list of alternative titles to show below the main title
  const altTitles: Array<{ text: string; isJapanese: boolean }> = [];

  if (cleanJp && cleanJp !== primaryTitle) altTitles.push({ text: cleanJp, isJapanese: hasJapanese(cleanJp) });
  if (cleanRomaji && cleanRomaji !== primaryTitle && cleanRomaji !== cleanJp) {
    altTitles.push({ text: cleanRomaji, isJapanese: hasJapanese(cleanRomaji) });
  }
  if (cleanTitle && cleanTitle !== primaryTitle && cleanTitle !== cleanJp && cleanTitle !== cleanRomaji) {
    altTitles.push({ text: cleanTitle, isJapanese: hasJapanese(cleanTitle) });
  }

  return (
    <div>
      <h1
        lang={primaryIsJapanese ? 'ja' : undefined}
        className={`text-xl sm:text-2xl lg:text-3xl font-bold leading-tight text-[color:var(--ink)] ${primaryIsJapanese ? 'font-jp' : 'font-display'}`}
      >
        {primaryTitle}
      </h1>
      {altTitles.length > 0 && (
        <div className="mt-1 space-y-0">
          {altTitles.map((alt, index) => (
            <p
              key={index}
              lang={alt.isJapanese ? 'ja' : undefined}
              className={`text-sm text-[color:var(--nezu)] ${alt.isJapanese ? 'font-jp' : ''}`}
            >
              {alt.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
