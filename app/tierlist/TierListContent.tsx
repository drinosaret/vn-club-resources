'use client';

import Link from '@/components/Link';
import { useLocale } from '@/lib/i18n/locale-context';
import { tierListStrings } from '@/lib/i18n/translations/tierlist';
import { useTitlePreference } from '@/lib/title-preference';
import { TierListBoard } from '@/components/tierlist/TierListBoard';

export default function TierListContent({ shareId }: { shareId?: string } = {}) {
  const locale = useLocale();
  const s = tierListStrings[locale];
  const { setPreference } = useTitlePreference();

  return (
    <div className="min-h-[80vh] flex flex-col items-center px-4 py-8 sm:py-12">
      <div className="max-w-5xl w-full">
        <div className="mb-6 text-center">
          <h1 className="sec-title">{s['page.title']}</h1>
          <p className="sec-sub mx-auto max-w-lg">{s['page.subtitle']}</p>
          <Link
            href={locale === 'en' ? '/ja/tierlist/' : '/tierlist/'}
            className="toy-btn mt-4"
            onClick={() => setPreference(locale === 'en' ? 'japanese' : 'romaji')}
          >
            {locale === 'en' ? '日本語' : 'English'}
          </Link>
        </div>

        <TierListBoard shareId={shareId} />
      </div>
    </div>
  );
}
