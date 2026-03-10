'use client';

import Link from 'next/link';
import { Grid3X3, Globe } from 'lucide-react';
import { GridBoard } from '@/components/grid-maker/GridBoard';
import { useLocale } from '@/lib/i18n/locale-context';
import { gridMakerStrings } from '@/lib/i18n/translations/grid-maker';
import { useTitlePreference } from '@/lib/title-preference';

export default function GridMakerContent({ shareId }: { shareId?: string } = {}) {
  const locale = useLocale();
  const s = gridMakerStrings[locale];
  const { setPreference } = useTitlePreference();

  return (
    <div className="min-h-[80vh] flex flex-col items-center px-4 py-8 sm:py-12">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/30 mb-3">
            <Grid3X3 className="w-8 h-8 text-purple-600 dark:text-purple-400" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-2">
            {s['page.title']}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 max-w-lg mx-auto">
            {s['page.subtitle']}
          </p>
          <Link
            href={locale === 'en' ? '/ja/3x3-maker/' : '/3x3-maker/'}
            className="inline-flex items-center gap-1.5 mt-3 text-xs text-gray-400 dark:text-gray-500 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
            onClick={() => setPreference(locale === 'en' ? 'japanese' : 'romaji')}
          >
            <Globe className="w-3.5 h-3.5" />
            {locale === 'en' ? '\u65e5\u672c\u8a9e' : 'English'}
          </Link>
        </div>

        <GridBoard shareId={shareId} />
      </div>
    </div>
  );
}
