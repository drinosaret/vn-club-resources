'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Rows3, Globe } from 'lucide-react';
import { useLocale } from '@/lib/i18n/locale-context';
import { tierListStrings } from '@/lib/i18n/translations/tierlist';
import { TierListBoard } from '@/components/tierlist/TierListBoard';
import { VNDBAttribution } from '@/components/VNDBAttribution';

export default function TierListContent({ shareId }: { shareId?: string } = {}) {
  const searchParams = useSearchParams();
  const locale = useLocale();
  const s = tierListStrings[locale];

  const urlParams = useMemo(() => {
    const preset = searchParams.get('preset');
    const user = searchParams.get('user');
    if (!preset && !user) return null;
    return { preset, user };
  }, [searchParams]);

  return (
    <div className="min-h-[80vh] flex flex-col items-center px-4 py-8 sm:py-12">
      <div className="max-w-5xl w-full">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 mb-3">
            <Rows3 className="w-8 h-8 text-amber-600 dark:text-amber-400" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-2">
            {s['page.title']}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 max-w-lg mx-auto">
            {s['page.subtitle']}
          </p>
          <Link
            href={locale === 'en' ? '/ja/tierlist/' : '/tierlist/'}
            className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            <Globe className="w-3.5 h-3.5" />
            {locale === 'en' ? '日本語' : 'English'}
          </Link>
        </div>

        <TierListBoard urlParams={urlParams} shareId={shareId} />
        <VNDBAttribution />
      </div>
    </div>
  );
}
