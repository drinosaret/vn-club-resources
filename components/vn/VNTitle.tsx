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

export function VNTitle({ title, titleJp, titleRomaji }: VNTitleProps) {
  const { preference } = useTitlePreference();
  const primaryTitle = getDisplayTitle({ title, title_jp: titleJp, title_romaji: titleRomaji }, preference);
  const primaryIsJapanese = hasJapanese(primaryTitle);

  // Clean title fields — VNDB aliases can be \n-separated
  const cleanJp = titleJp ? firstLine(titleJp) : undefined;
  const cleanRomaji = titleRomaji ? firstLine(titleRomaji) : undefined;
  const cleanTitle = title ? firstLine(title) : undefined;

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
      <h1 className={`text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white leading-tight ${primaryIsJapanese ? 'font-jp' : ''}`}>
        {primaryTitle}
      </h1>
      {altTitles.length > 0 && (
        <div className="mt-0.5 space-y-0">
          {altTitles.map((alt, index) => (
            <p key={index} className={`text-sm text-gray-500 dark:text-gray-400 ${alt.isJapanese ? 'font-jp' : 'italic'}`}>
              {alt.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
