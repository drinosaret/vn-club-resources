'use client';

// The credit is English wherever it appears, including on the pages whose surrounding
// content is declared Japanese, so it carries its own language.
export function VNDBAttribution() {
  return (
    <div className="text-center text-xs sm:text-sm text-[color:var(--nezu)] py-6 px-6 border-t border-[color:var(--rule)] mt-6" lang="en">
      <p className="max-w-md mx-auto">
        Contains data from{' '}
        <a
          href="https://vndb.org"
          target="_blank"
          rel="noopener noreferrer"
          className="sw-link underline"
        >
          VNDB
        </a>
        , available under the{' '}
        <a
          href="https://opendatacommons.org/licenses/odbl/1-0/"
          target="_blank"
          rel="noopener noreferrer"
          className="sw-link underline"
        >
          Open Database License
        </a>
        . Reading difficulty and script measurements come from{' '}
        <a
          href="https://jiten.moe"
          target="_blank"
          rel="noopener noreferrer"
          className="sw-link underline"
        >
          jiten.moe
        </a>
        . Statistics are based on daily data dumps and may not reflect real-time changes.
      </p>
    </div>
  );
}
