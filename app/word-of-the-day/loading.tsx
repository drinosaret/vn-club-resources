export default function WordOfTheDayLoading() {
  return (
    <div className="min-h-screen bg-[color:var(--ground)]">
      <div className="container mx-auto px-4 max-w-4xl py-8 md:py-12">
        {/* Date nav skeleton */}
        <div className="wd-nav">
          <div className="wd-skel w-8 h-8 animate-pulse" />
          <div className="wd-skel w-40 h-5 animate-pulse" />
          <div className="wd-skel w-8 h-8 animate-pulse" />
        </div>

        <div className="space-y-6 mt-6">
          {/* Hero skeleton */}
          <div className="panel p-6 pt-8 md:p-8 md:pt-9">
            <span className="nameplate dg-plate">Word of the Day</span>
            <div className="flex flex-col md:flex-row gap-6 md:gap-8 items-start">
              <div className="wd-word-box w-full md:w-auto md:min-w-[200px] h-[180px] animate-pulse" />
              <div className="flex-1 space-y-3 w-full">
                <div className="wd-skel h-4 w-20 animate-pulse" />
                <div className="wd-skel h-5 w-48 animate-pulse" />
                <div className="wd-skel h-4 w-64 animate-pulse" />
                <div className="wd-skel h-4 w-40 animate-pulse" />
              </div>
            </div>
          </div>

          {/* Sentences skeleton */}
          <div className="panel p-5">
            <div className="wd-skel h-5 w-40 animate-pulse mb-4" />
            <div className="space-y-3">
              <div className="wd-skel h-12 animate-pulse" />
              <div className="wd-skel h-12 animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
