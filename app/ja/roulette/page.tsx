import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Dices } from 'lucide-react';
import { VNDBAttribution } from '@/components/VNDBAttribution';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';
import RoulettePageClient from '@/components/roulette/RoulettePageClient';

export const metadata: Metadata = {
  ...generatePageMetadata({
    title: '\u30a8\u30ed\u30b2\u30eb\u30fc\u30ec\u30c3\u30c8 - \u30db\u30a4\u30fc\u30eb\u3092\u56de\u3057\u3066\u6b21\u306e\u4e00\u4f5c\u3092\u9078\u307c\u3046',
    description: '\u30a8\u30ed\u30b2\u3092\u30eb\u30fc\u30ec\u30c3\u30c8\u30db\u30a4\u30fc\u30eb\u306b\u8ffd\u52a0\u3057\u3066\u30b9\u30d4\u30f3\u3002\u30b0\u30eb\u30fc\u30d7\u30e2\u30fc\u30c9\u3067\u8aad\u66f8\u4f1a\u3084\u30af\u30e9\u30d6\u30d4\u30c3\u30af\u306b\u53cb\u9054\u3078\u306eVN\u5272\u308a\u5f53\u3066\u3082\u53ef\u80fd\u3002',
    path: '/ja/roulette/',
  }),
  alternates: {
    canonical: `${SITE_URL}/ja/roulette/`,
    languages: {
      'en': `${SITE_URL}/roulette/`,
      'ja': `${SITE_URL}/ja/roulette/`,
    },
  },
};

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: '\u30a8\u30ed\u30b2\u30eb\u30fc\u30ec\u30c3\u30c8',
    description: '\u30eb\u30fc\u30ec\u30c3\u30c8\u30db\u30a4\u30fc\u30eb\u3092\u56de\u3057\u3066\u6b21\u306e\u30a8\u30ed\u30b2\u3092\u9078\u3073\u307e\u3057\u3087\u3046\u3002\u30b0\u30eb\u30fc\u30d7\u30e2\u30fc\u30c9\u3067\u30d7\u30ec\u30a4\u30e4\u30fc\u306bVN\u3092\u5272\u308a\u5f53\u3066\u3002',
    url: `${SITE_URL}/ja/roulette/`,
    inLanguage: 'ja',
    applicationCategory: 'EntertainmentApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    featureList: [
      '\u30a8\u30ed\u30b2\u3092\u691c\u7d22\u3057\u3066\u30db\u30a4\u30fc\u30eb\u306b\u8ffd\u52a0',
      '\u6ed1\u3089\u304b\u306a\u6e1b\u901f\u30a2\u30cb\u30e1\u30fc\u30b7\u30e7\u30f3\u4ed8\u304d\u30eb\u30fc\u30ec\u30c3\u30c8',
      '\u30bd\u30ed\u30e2\u30fc\u30c9\u3067\u500b\u4eba\u30d4\u30c3\u30af',
      '\u30b0\u30eb\u30fc\u30d7\u30e2\u30fc\u30c9\u3067\u8907\u6570\u30d7\u30ec\u30a4\u30e4\u30fc\u306bVN\u5272\u308a\u5f53\u3066',
      '\u30d6\u30e9\u30a6\u30b6\u306b\u81ea\u52d5\u4fdd\u5b58',
    ],
    author: {
      '@type': 'Organization',
      name: 'VN Club',
      url: SITE_URL,
    },
    isPartOf: {
      '@type': 'WebSite',
      name: 'VN Club',
      url: SITE_URL,
    },
  },
  generateBreadcrumbJsonLd([
    { name: '\u30db\u30fc\u30e0', path: '/' },
    { name: '\u30a8\u30ed\u30b2\u30eb\u30fc\u30ec\u30c3\u30c8', path: '/ja/roulette/' },
  ]),
];

function LoadingFallback() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center px-4 py-12">
      <div className="max-w-5xl w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-violet-100 dark:bg-violet-900/30 mb-4">
            <Dices className="w-10 h-10 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="h-10 w-56 mx-auto mb-3 rounded image-placeholder" />
          <div className="h-6 w-80 mx-auto rounded image-placeholder" />
        </div>
        <div className="flex justify-center">
          <div className="w-80 h-80 rounded-full image-placeholder" />
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <Suspense fallback={<LoadingFallback />}>
        <RoulettePageClient />
      </Suspense>

      <section className="max-w-2xl mx-auto px-4 py-12 text-sm text-gray-600 dark:text-gray-400">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">使い方</h2>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">エロゲの追加</h3>
        <p className="mb-3">タイトルやVNDB IDでエロゲを検索し、クリックしてホイールに追加。最小2作品から最大15作品まで追加できます。各作品はホイール上に色付きセグメントとして表示されます。ゴミ箱アイコンで削除、または全体をクリアしてやり直し。</p>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">ホイールを回す</h3>
        <p className="mb-3">スピンボタンを押すと、ホイールが減速しながら回転し、ランダムにエロゲが選ばれます。結果カードには選ばれたVNの詳細ページへのリンクが表示されます。何度でもスピン可能。ホイールの設定はブラウザに自動保存されます。</p>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">グループモード</h3>
        <p className="mb-3">グループモードに切り替えて読書会やクラブピックに活用。プレイヤー名をキューに追加してスピンすると、毎ラウンドでランダムにプレイヤーが選ばれ、ホイールからVNが割り当てられます。割り当て済みのプレイヤーはキューから外れ、VNはホイールに残ります。割り当て履歴テーブルで全結果を確認できます。</p>
      </section>

      <VNDBAttribution />
    </>
  );
}
