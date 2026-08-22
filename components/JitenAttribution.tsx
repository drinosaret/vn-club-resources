import { ExternalLink } from 'lucide-react';

/**
 * Credit for the reading-difficulty data.
 *
 * Difficulty comes from jiten.moe's analysis of the script, and is the only figure on the
 * site sourced from outside. Anywhere it is filtered, sorted or ranked on needs to
 * say so where the reader is looking, not only in the small print of a methodology panel.
 */

interface JitenAttributionProps {
  /** What the reader is looking at, so the sentence fits its surroundings. */
  describes?: string;
  className?: string;
}

export function JitenAttribution({
  describes = 'Reading difficulty',
  className = '',
}: JitenAttributionProps) {
  return (
    <p className={`text-xs text-gray-500 dark:text-gray-400 ${className}`}>
      {describes} comes from{' '}
      <a
        href="https://jiten.moe/decks/media?mediaType=7"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 hover:underline"
      >
        jiten.moe
        <ExternalLink className="w-3 h-3" />
      </a>
      , which analyses the Japanese script. It covers only the titles jiten has measured.
    </p>
  );
}
