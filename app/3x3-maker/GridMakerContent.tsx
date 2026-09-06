'use client';

import Link from '@/components/Link';
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
        <div className="mb-6 text-center">
          <h1 className="sec-title">{s['page.title']}</h1>
          <p className="sec-sub mx-auto max-w-lg">{s['page.subtitle']}</p>
          <Link
            href={locale === 'en' ? '/ja/3x3-maker/' : '/3x3-maker/'}
            className="toy-btn mt-4"
            onClick={() => setPreference(locale === 'en' ? 'japanese' : 'romaji')}
          >
            {locale === 'en' ? '\u65e5\u672c\u8a9e' : 'English'}
          </Link>
        </div>

        <GridBoard shareId={shareId} />
      </div>
    </div>
  );
}
