interface LoadingScreenProps {
  title?: string;
  subtitle?: string;
}

export function LoadingScreen({ title = 'Loading data…', subtitle = 'Hang tight, fetching stats from VNDB' }: LoadingScreenProps) {
  return (
    // The band holds a page's worth so the footer stays below the fold until there is a page
    // above it. Its middle is past the fold, so the spinner sits near the top of it instead.
    <div className="min-h-[calc(100vh+8rem)] flex flex-col items-center justify-start pt-[12vh] gap-4 text-center">
      <div className="sw-wait">
        <span className="sw-spin h-6 w-6" />
      </div>
      <div className="space-y-1">
        <div className="sw-card-title">{title}</div>
        <div className="sw-plate sw-plate--sentence">{subtitle}</div>
      </div>
    </div>
  );
}
