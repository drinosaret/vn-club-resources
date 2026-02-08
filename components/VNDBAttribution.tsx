'use client';

export function VNDBAttribution() {
  return (
    <div className="text-center text-xs sm:text-sm text-gray-500 dark:text-gray-400 py-6 px-6 border-t border-gray-200 dark:border-gray-700 mt-6">
      <p className="max-w-md mx-auto">
        Contains data from{' '}
        <a
          href="https://vndb.org"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary-600 dark:text-primary-400 hover:underline"
        >
          VNDB
        </a>
        , available under the{' '}
        <a
          href="https://opendatacommons.org/licenses/odbl/1-0/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary-600 dark:text-primary-400 hover:underline"
        >
          Open Database License
        </a>
        . Statistics are based on daily data dumps and may not reflect real-time changes.
      </p>
    </div>
  );
}
