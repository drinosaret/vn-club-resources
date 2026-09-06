import { Suspense } from 'react';
import type { Metadata } from 'next';
import TierListContent from '@/app/tierlist/TierListContent';
import { VNDBAttribution } from '@/components/VNDBAttribution';
import { generatePageMetadata, localizedAlternates, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = {
  ...generatePageMetadata({
    title: '\u30a8\u30ed\u30b2 \u30c6\u30a3\u30a2\u30ea\u30b9\u30c8\u30e1\u30fc\u30ab\u30fc - エロゲ\u30e9\u30f3\u30ad\u30f3\u30b0\u4f5c\u6210',
    description: 'VNDB\u306e\u8a55\u4fa1\u304b\u3089\u30a8\u30ed\u30b2\u306e\u30c6\u30a3\u30a2\u30ea\u30b9\u30c8\u3092\u4f5c\u6210\u3002\u30c9\u30e9\u30c3\u30b0\uff06\u30c9\u30ed\u30c3\u30d7\u3067\u30e9\u30f3\u30ad\u30f3\u30b0\u3001\u30c6\u30a3\u30a2\u30e9\u30d9\u30eb\u3068\u30ab\u30e9\u30fc\u3092\u30ab\u30b9\u30bf\u30de\u30a4\u30ba\u3001\u5171\u6709\u53ef\u80fd\u306a\u753b\u50cf\u3068\u3057\u3066\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3002',
    path: '/ja/tierlist/',
  }),
  alternates: localizedAlternates('tierlist', 'ja'),
};

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: '\u30a8\u30ed\u30b2 \u30c6\u30a3\u30a2\u30ea\u30b9\u30c8\u30e1\u30fc\u30ab\u30fc',
    description: 'VNDB\u306e\u8a55\u4fa1\u307e\u305f\u306f\u624b\u52d5\u691c\u7d22\u304b\u3089\u30a8\u30ed\u30b2\u306e\u30c6\u30a3\u30a2\u30ea\u30b9\u30c8\u3092\u4f5c\u6210\u3002\u30c9\u30e9\u30c3\u30b0\uff06\u30c9\u30ed\u30c3\u30d7\u3067\u30e9\u30f3\u30ad\u30f3\u30b0\u3001\u5171\u6709\u53ef\u80fd\u306a\u753b\u50cf\u3068\u3057\u3066\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3002',
    url: `${SITE_URL}/ja/tierlist/`,
    inLanguage: 'ja',
    applicationCategory: 'EntertainmentApplication',
    operatingSystem: 'Any',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    browserRequirements: 'Requires JavaScript',
    featureList: [
      'VNDBリストインポート・ティア自動振り分け',
      'カスタマイズ可能なティアラベルとカラー',
      'ドラッグ＆ドロップランキング',
      'カバー画像・テキストのみ表示モード',
      '小・中・大サムネイルサイズ',
      '複数プリセット（S-F、1-5、1-10、10-100）',
      'JPG、PNG、WebPエクスポート',
      '共有リンク',
      'ダーク・ライトテーマ',
      'エロゲ・キャラクターモード',
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
    { name: 'エロゲ \u30c6\u30a3\u30a2\u30ea\u30b9\u30c8\u30e1\u30fc\u30ab\u30fc', path: '/ja/tierlist/' },
  ]),
];

function LoadingFallback() {
  return (
    <div className="flex min-h-[80vh] flex-col items-center px-4 py-12">
      <div className="w-full max-w-5xl">
        <div className="mb-8 text-center">
          <div className="image-placeholder mx-auto mb-3 h-10 w-64 rounded-xs" />
          <div className="image-placeholder mx-auto h-6 w-96 rounded-xs" />
        </div>
        <div className="relative mx-auto mb-8 max-w-lg">
          <div className="image-placeholder h-14 w-full rounded-xs" />
        </div>
        <div className="mx-auto grid max-w-2xl grid-cols-1 gap-6 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xs border border-[color:var(--rule)] p-5">
              <div className="image-placeholder mb-3 h-10 w-10 rounded-xs" />
              <div className="image-placeholder mb-2 h-5 w-24 rounded-xs" />
              <div className="image-placeholder mb-1 h-4 w-full rounded-xs" />
              <div className="image-placeholder h-4 w-3/4 rounded-xs" />
            </div>
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
        <TierListContent />
      </Suspense>

      <section className="mx-auto max-w-2xl px-4 py-12 font-jp text-sm text-[color:var(--nezu)]">
        <h2 className="rel-group-title">使い方</h2>

        <h3 className="mt-4 mb-1 font-display font-bold text-[color:var(--ink)]">アイテムの追加</h3>
        <p className="mb-3">検索バーでエロゲやキャラクターを名前やVNDB ID（例：「v17」や「17」）で検索。クリックすると未分類プールに追加されます（歯車アイコンの「最後のティアに直接追加」を有効にするとプールをスキップ可能）。エロゲ/キャラクターモードはトグルボタンで切り替え。VNDBのユーザー名またはIDを入力すると、評価済み作品がスコアに応じて自動的にティアに振り分けられます。最大500アイテムまで対応。</p>

        <h3 className="mt-4 mb-1 font-display font-bold text-[color:var(--ink)]">ティアの整理</h3>
        <p className="mb-3">アイテムをティアにドラッグして配置、特定のアイテムの上にドロップするとその前に挿入、空白部分にドロップすると末尾に配置されます。ティアラベルをクリックすると名前の変更（最大40文字）、色の変更、削除、上下へのティア追加ができます。4つのプリセット（S-F、1-5、1-10、10-100）があり、切り替えるとアイテムが自動的に再配置されます。</p>

        <h3 className="mt-4 mb-1 font-display font-bold text-[color:var(--ink)]">スコアとタイトルの編集</h3>
        <p className="mb-3">アイテムにマウスを合わせて鉛筆アイコンをクリックすると編集モーダルが開きます。カスタムタイトルでデフォルト名を上書きしたり、スコア（10-100）を調整できます。歯車アイコンでスコアバッジやタイトルオーバーレイの表示を切り替え可能。EN/JPトグルで英語/ローマ字と日本語タイトルを切り替えられます。</p>

        <h3 className="mt-4 mb-1 font-display font-bold text-[color:var(--ink)]">表示モード</h3>
        <p className="mb-3">ツールバーのボタンでカバー画像モードとタイトルのみのテキストモードを切り替えられます。カバーモードでは小・中・大のサムネイルサイズを選択でき、タイトルやスコアのオーバーレイも表示可能。テキストモードはコンパクトなラベル表示で、多くのアイテムを密度高く並べたいときに便利です。</p>

        <h3 className="mt-4 mb-1 font-display font-bold text-[color:var(--ink)]">エクスポートと共有</h3>
        <p className="mb-3">JPG、PNG、WebPでエクスポート、クリップボードにコピー、またはTwitter、Reddit、デバイスの共有メニューで直接共有できます。共有リンクを生成すると、開いた人がコピーを並べ替えできるので、友人にテンプレートとして送り、同じ作品セットで自分のランキングを作ってもらう使い方ができます。ティア上のテキストフィールドでタイトルを設定すると、エクスポート画像のヘッダーに表示されます。</p>

        <h3 className="mt-4 mb-1 font-display font-bold text-[color:var(--ink)]">自動保存</h3>
        <p className="mb-3">ティアのレイアウト、アイテムの配置、カスタムタイトル、スコア、表示設定など、すべてがブラウザに自動保存されます。いつでも戻れば、離れたときのままの状態です。</p>

      </section>

      <VNDBAttribution />
    </>
  );
}
