export default function NewsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[80vh] px-4 py-12">
      <div className="max-w-6xl mx-auto">
        <div className="sec-head">
          <div>
            <h1 className="sec-title">
              Visual Novel News
              {/* The aggregator is still being tuned, and a reader should know that before
                  treating a quiet day as a complete one. */}
              <span className="nameplate nameplate--plain ml-3 align-middle">Beta</span>
            </h1>
            <p className="sec-sub">
              Japanese releases, announcements and industry news, gathered daily.
            </p>
          </div>
        </div>

        {children}
      </div>
    </div>
  );
}
