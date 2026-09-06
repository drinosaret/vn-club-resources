import { classifyReadingStyle, readingStyleSentence } from '@/lib/reading-style';
import { difficultyLabel } from '@/lib/difficulty';
import type { LanguageLookup } from '@/lib/jiten-server';

const JITEN_VN_DECKS = 'https://jiten.moe/decks/media?mediaType=7';

interface VNLanguageSummaryProps {
  /** null when the lookup did not resolve, in which case nothing is asserted either way. */
  lookup: LanguageLookup | null;
  onOpenAnalysis?: () => void;
}

/**
 * The measured Japanese of one title, in prose.
 *
 * Rendered during the server pass so the figures are in the delivered markup rather than
 * arriving with the charts. Holds no state and fetches nothing: the charts on the language
 * tab remain the interactive surface.
 */
export function VNLanguageSummary({ lookup, onOpenAnalysis }: VNLanguageSummaryProps) {
  // Most titles have no measurement, and a heading that only says so is worth less than the
  // space it takes on the first tab. The language tab explains the absence for anyone who
  // goes looking.
  if (!lookup?.stats) return null;

  const stats = lookup.stats;
  const style = classifyReadingStyle(stats);
  const band = difficultyLabel(stats.difficultyRaw);

  return (
    <section
      aria-labelledby="vn-language-summary-heading"
      className="vn-sec px-4 sm:px-5 py-3.5"
    >
      {/* The measured figure is the live one on this block, so it is the thing carrying amber. */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <h2 id="vn-language-summary-heading" className="vn-sec-title">
          {style.label} Japanese
        </h2>
        <span className="nameplate">
          {band ? `${band} · ` : ''}{stats.difficultyRaw.toFixed(1)}/5
        </span>
      </div>
      <p className="mt-1.5 text-sm text-[color:var(--text-secondary)]">
        {readingStyleSentence(stats)}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2.5">
        {onOpenAnalysis && (
          <button type="button" onClick={onOpenAnalysis} className="sec-more">
            Full language analysis
            <span aria-hidden>→</span>
          </button>
        )}
        <a
          href={JITEN_VN_DECKS}
          target="_blank"
          rel="noopener noreferrer"
          className="sec-more"
        >
          Measurements by jiten.moe
          <span aria-hidden>↗</span>
        </a>
      </div>
    </section>
  );
}

export default VNLanguageSummary;
