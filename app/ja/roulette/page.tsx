import type { Metadata } from 'next';
import { VNDBAttribution } from '@/components/VNDBAttribution';
import { generatePageMetadata, localizedAlternates, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';
import RoulettePageClient from '@/components/roulette/RoulettePageClient';

export const metadata: Metadata = {
  ...generatePageMetadata({
    title: '\u30a8\u30ed\u30b2\u30eb\u30fc\u30ec\u30c3\u30c8 - \u30db\u30a4\u30fc\u30eb\u3092\u56de\u3057\u3066\u6b21\u306e\u4e00\u4f5c\u3092\u9078\u307c\u3046',
    description: '\u30a8\u30ed\u30b2\u3092\u30eb\u30fc\u30ec\u30c3\u30c8\u30db\u30a4\u30fc\u30eb\u306b\u8ffd\u52a0\u3057\u3066\u30b9\u30d4\u30f3\u3057\u3001\u6b21\u306b\u8aad\u3080\u4e00\u4f5c\u3092\u6c7a\u5b9a\u3002VNDB\u304b\u3089\u691c\u7d22\u3057\u3066\u5019\u88dc\u3092\u8ffd\u52a0\u3067\u304d\u3001\u30b0\u30eb\u30fc\u30d7\u30e2\u30fc\u30c9\u306a\u3089\u53cb\u9054\u540c\u58eb\u3067\u30a8\u30ed\u30b2\u3092\u632f\u308a\u5206\u3051\u3066\u8aad\u66f8\u4f1a\u3084\u4f01\u753b\u306b\u3082\u4f7f\u3048\u308b\u3002',
    path: '/ja/roulette/',
  }),
  alternates: localizedAlternates('roulette', 'ja'),
};

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: '\u30a8\u30ed\u30b2\u30eb\u30fc\u30ec\u30c3\u30c8',
    description: '\u30eb\u30fc\u30ec\u30c3\u30c8\u30db\u30a4\u30fc\u30eb\u3092\u56de\u3057\u3066\u6b21\u306e\u30a8\u30ed\u30b2\u3092\u9078\u3073\u307e\u3057\u3087\u3046\u3002\u30b0\u30eb\u30fc\u30d7\u30e2\u30fc\u30c9\u3067\u30d7\u30ec\u30a4\u30e4\u30fc\u306b\u30a8\u30ed\u30b2\u3092\u5272\u308a\u5f53\u3066\u3002',
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
      '\u30b0\u30eb\u30fc\u30d7\u30e2\u30fc\u30c9\u3067\u8907\u6570\u30d7\u30ec\u30a4\u30e4\u30fc\u306b\u30a8\u30ed\u30b2\u5272\u308a\u5f53\u3066',
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

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <RoulettePageClient />

      <section className="mx-auto max-w-2xl px-4 py-12 font-jp text-sm text-[color:var(--nezu)]">
        <h2 className="rel-group-title">使い方</h2>

        <h3 className="mt-4 mb-1 font-display font-bold text-[color:var(--ink)]">エロゲの追加</h3>
        <p className="mb-3">タイトルかVNDB IDで検索して、クリックでホイールに追加します。2〜15作品まで追加できます。ゴミ箱アイコンで個別に削除するか、全部クリアしてやり直せます。</p>

        <h3 className="mt-4 mb-1 font-display font-bold text-[color:var(--ink)]">ホイールを回す</h3>
        <p className="mb-3">スピンボタンを押すとホイールが回り、止まったところのエロゲが選ばれます。結果から作品ページに移動できます。何度でも回せますし、ホイールの中身はブラウザに自動保存されます。</p>

        <h3 className="mt-4 mb-1 font-display font-bold text-[color:var(--ink)]">グループモード</h3>
        <p className="mb-3">読書会やみんなで遊ぶときに。プレイヤー名を追加してスピンすると、ランダムに一人選ばれてエロゲが割り当てられます。当たったプレイヤーはリストから外れ、エロゲはそのまま残ります。誰に何が当たったかは履歴テーブルで確認できます。</p>
      </section>

      <VNDBAttribution />
    </>
  );
}
