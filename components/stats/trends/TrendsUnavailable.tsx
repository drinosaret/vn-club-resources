/**
 * What a trends section shows when its request did not come back.
 *
 * Every section here would otherwise render its heading and its explanation above nothing at
 * all, which reads as a quiet period rather than as a failure. These figures are about
 * movement, so an empty panel is a plausible-looking answer and therefore the wrong one: a
 * reader has no way to tell that the question was never asked.
 *
 * Kept deliberately small. The section's own heading already says what is missing, so this
 * only has to say why it is missing and that it is worth coming back.
 */

interface TrendsUnavailableProps {
  /** Names the thing that failed, for when several sections sit on one page. */
  what?: string;
  /**
   * Why it is absent.
   *
   * A section with nothing in it yet and a section whose request failed look identical on
   * screen and are not the same thing: one resolves overnight and the other is a fault. The
   * backend answers a missing cache key with an empty payload rather than an error, so the
   * caller is the only place that knows which of the two this is.
   */
  reason?: 'failed' | 'not-built';
}

export function TrendsUnavailable({
  what = 'This section',
  reason = 'failed',
}: TrendsUnavailableProps) {
  return (
    <p
      role="status"
      className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400"
    >
      {reason === 'not-built'
        ? `${what} is not available until the nightly rebuild has run.`
        : `${what} could not be loaded. The stats service did not answer, which is usually brief.`}
    </p>
  );
}
