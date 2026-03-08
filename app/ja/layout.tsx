import { LocaleProvider } from '@/lib/i18n/locale-context';

export default function JaLayout({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider locale="ja">
      <div lang="ja">
        {children}
      </div>
    </LocaleProvider>
  );
}
