import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Grid3X3 } from 'lucide-react';
import GridMakerContent from '@/app/3x3-maker/GridMakerContent';
import { VNDBAttribution } from '@/components/VNDBAttribution';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = {
  ...generatePageMetadata({
    title: '\u30a8\u30ed\u30b2 3x3\u30e1\u30fc\u30ab\u30fc - エロゲ\u30b3\u30e9\u30fc\u30b8\u30e5\u4f5c\u6210',
    description: '3x3\u30014x4\u30015x5\u306e\u30a8\u30ed\u30b2\u30b3\u30e9\u30fc\u30b8\u30e5\u3092\u4f5c\u6210\u3002VNDB\u30ea\u30b9\u30c8\u304b\u3089\u30a4\u30f3\u30dd\u30fc\u30c8\u307e\u305f\u306f\u624b\u52d5\u3067\u691c\u7d22\u3057\u3001\u30ab\u30d0\u30fc\u3092\u30af\u30ed\u30c3\u30d7\u3057\u3066\u5171\u6709\u53ef\u80fd\u306a\u753b\u50cf\u3092\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3002',
    path: '/ja/3x3-maker/',
  }),
  alternates: {
    canonical: `${SITE_URL}/ja/3x3-maker/`,
    languages: {
      'en': `${SITE_URL}/3x3-maker/`,
      'ja': `${SITE_URL}/ja/3x3-maker/`,
    },
  },
};

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: '\u30a8\u30ed\u30b2 3x3\u30e1\u30fc\u30ab\u30fc',
    description: 'VNDB\u30ea\u30b9\u30c8\u307e\u305f\u306f\u624b\u52d5\u691c\u7d22\u304b\u30893x3\u30014x4\u30015x5\u306e\u30a8\u30ed\u30b2\u30b3\u30e9\u30fc\u30b8\u30e5\u3092\u4f5c\u6210\u3002\u30ab\u30d0\u30fc\u3092\u30af\u30ed\u30c3\u30d7\u3057\u3066\u5171\u6709\u53ef\u80fd\u306a\u753b\u50cf\u3092\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3002',
    url: `${SITE_URL}/ja/3x3-maker/`,
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
      'VNDB\u30ea\u30b9\u30c8\u30a4\u30f3\u30dd\u30fc\u30c8',
      '3x3\u30014x4\u30015x5\u30b0\u30ea\u30c3\u30c9\u30b5\u30a4\u30ba',
      '\u753b\u50cf\u30af\u30ed\u30c3\u30d7\u30fb\u4f4d\u7f6e\u8abf\u6574',
      '\u30ab\u30b9\u30bf\u30e0\u30bf\u30a4\u30c8\u30eb\u30fb\u30b9\u30b3\u30a2',
      'JPG\u3001PNG\u3001WebP\u30a8\u30af\u30b9\u30dd\u30fc\u30c8',
      '\u5171\u6709\u30ea\u30f3\u30af',
      '\u30c0\u30fc\u30af\u30fb\u30e9\u30a4\u30c8\u30c6\u30fc\u30de',
      '\u30a8\u30ed\u30b2\u30fb\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u30e2\u30fc\u30c9',
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
    { name: '\u30a8\u30ed\u30b2 3x3\u30e1\u30fc\u30ab\u30fc', path: '/ja/3x3-maker/' },
  ]),
];

function LoadingFallback() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center px-4 py-12">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/30 mb-3">
            <Grid3X3 className="w-8 h-8 text-purple-600 dark:text-purple-400" />
          </div>
          <div className="h-10 w-48 mx-auto mb-3 rounded image-placeholder" />
          <div className="h-5 w-80 mx-auto rounded image-placeholder" />
        </div>
        <div className="max-w-md mx-auto mb-6">
          <div className="w-full h-10 rounded-lg image-placeholder" />
        </div>
        <div className="max-w-[420px] mx-auto grid grid-cols-3 gap-1">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] rounded-sm image-placeholder" />
          ))}
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
        <GridMakerContent />
      </Suspense>

      <section className="max-w-2xl mx-auto px-4 py-12 text-sm text-gray-600 dark:text-gray-400">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">使い方</h2>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">アイテムの追加</h3>
        <p className="mb-3">検索バーでエロゲやキャラクターを名前やVNDB ID（例：「v17」や「17」）で検索できます。クリックするとプールに追加されます。歯車アイコンの「グリッドに直接追加」を有効にすると、次の空のセルに直接配置されます。空のセルを先にクリックして、モーダル内で検索して特定のスロットをターゲットすることも可能。エロゲ/キャラクターモードはトグルボタンで切り替え。VNDBのユーザー名またはIDを入力すると、評価の高い上位500作品が自動的にグリッドに配置されます。</p>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">グリッドサイズとレイアウト</h3>
        <p className="mb-3">3&times;3、4&times;4、5&times;5のグリッドから選択できます。正方形クロップとカバー（2:3）アスペクト比を切り替え可能。アイテムをドラッグ＆ドロップで並べ替えられ、ドラッグすると2つのセルの位置が入れ替わります。グリッドに収まらないアイテムは下のプールに保管され、いつでもドラッグでグリッドに戻せます。</p>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">クロップと編集</h3>
        <p className="mb-3">アイテムにマウスを合わせて鉛筆アイコンをクリックするとエディターが開きます。ズームスライダー（1x～3x）とドラッグでクロップ範囲を調整できます。カスタムタイトルの設定、スコア（10～100）の調整、別のカバー画像の選択も可能。プレビューはリアルタイムで更新されます。</p>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">表示設定</h3>
        <p className="mb-3">歯車アイコンを開くと、タイトルオーバーレイ、スコアバッジ、装飾フレーム、タイトル言語（EN/JP）を切り替えられます。タイトルは各セルの下部に、スコアは角にバッジとして表示されます。これらの設定は画面表示とエクスポート画像の両方に適用されます。</p>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">エクスポートと共有</h3>
        <p className="mb-3">JPG、PNG、WebPでエクスポート、クリップボードにコピー、またはTwitter、Reddit、デバイスの共有メニューで直接共有できます。共有リンクを生成すると、開いた人がコピーを編集できるので、友人にテンプレートとして送り、同じ作品プールから自分のピックを埋めてもらう使い方ができます。</p>

        <h3 className="font-medium text-gray-800 dark:text-gray-200 mt-4 mb-1">自動保存</h3>
        <p className="mb-3">グリッドはアイテム、クロップ位置、カスタムタイトル、スコア、表示設定を含めてブラウザに自動保存されます。VNDBからインポートした場合、URLが更新されるのでブックマークや共有に便利です。</p>

      </section>

      <VNDBAttribution />
    </>
  );
}
