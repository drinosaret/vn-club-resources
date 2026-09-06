'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from '@/components/Link';
import { X, ExternalLink, ImageOff } from 'lucide-react';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import {
  RECOMMENDATION_LISTS,
  SIGNAL_LABELS,
  SignalKey,
  RecommendationList,
  listByName,
} from '@/lib/recommendation-weights';
import type { Recommendation } from '@/lib/recommendation-types';
import { useTitlePreference, getDisplayTitle, getEntityDisplayName, TitlePreference } from '@/lib/title-preference';
import { NSFWNextImage } from '@/components/NSFWImage';

const COMBINED_LIST: RecommendationList = listByName('combined') ?? RECOMMENDATION_LISTS[0];

/** Every signal list, which is what the agreement figure counts out of when the page does not say. */
const DEFAULT_TOTAL_LISTS = RECOMMENDATION_LISTS.filter((entry) => entry.signal !== null).length;

// Wording the page uses for a list whose ranking signal gave every title on it the same
// score, kept identical here so the breakdown does not contradict the page it was opened from.
const UNSEPARATED_SIGNAL_NOTE =
  'The score behind this order is the same for every title here, so it separated ' +
  'nothing. They are ordered by how much of your reading the matched entries account ' +
  'for: read this tab as a set rather than a ranking.';

interface RecommendationDetailModalProps {
  recommendation: Recommendation;
  onClose: () => void;
  isLoading?: boolean;
  /** The details request failed; the breakdown cannot be shown. */
  failed?: boolean;
  /** The list the card was opened from, which decides what its number means. */
  list?: RecommendationList;
  /** Whether the list's ranking signal separated the page at all. */
  signalRanks?: boolean;
  /** How many signal lists the agreement figure is out of. */
  totalLists?: number;
}

/**
 * One signal's evidence. The category is named in words rather than coded into a colour:
 * nine of them share this list, and nine hues would make the breakdown harder to read than
 * the numbers it exists to explain.
 */
interface CategoryConfig {
  key: SignalKey;
  /** Whether the details carry anything to show under the heading. */
  hasEvidence: boolean;
  renderContent: () => React.ReactNode;
}

// Source VNs carry every title form, so the reader's preference picks between them here
// rather than falling back to whichever form the database happens to store as the title.
function getSourceTitle(
  match: {
    source_vn_id: string;
    source_title?: string;
    source_title_jp?: string | null;
    source_title_romaji?: string | null;
  },
  preference: TitlePreference
): string {
  const displayed = getDisplayTitle(
    {
      title: match.source_title,
      title_jp: match.source_title_jp ?? undefined,
      title_romaji: match.source_title_romaji ?? undefined,
    },
    preference
  );
  return displayed || match.source_vn_id;
}

/** One matched entity: its name, and the mark the reader's own ratings put on it. */
function MatchRow({ name, score, count, countLabel }: {
  name: string;
  score: number;
  count: number;
  countLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate text-sm text-[color:var(--ink)]">{name}</span>
      <span className="rc-num shrink-0 text-sm text-[color:var(--nezu)]" title={countLabel}>
        <span className="font-semibold text-[color:var(--ink)]">{score.toFixed(0)}</span>
        <span className="ml-1 text-[color:var(--text-faint)]">({count})</span>
      </span>
    </div>
  );
}

export function RecommendationDetailModal({
  recommendation,
  onClose,
  isLoading = false,
  failed = false,
  list = COMBINED_LIST,
  signalRanks = true,
  totalLists = DEFAULT_TOTAL_LISTS,
}: RecommendationDetailModalProps) {
  const { vn_id, title, title_jp, title_romaji, image_url, image_sexual, rating, scores, details } = recommendation;
  const { preference: titlePreference } = useTitlePreference();
  const displayTitle = getDisplayTitle({ title, title_jp, title_romaji }, titlePreference);

  // Focus management
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);

  // Loading timeout state
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    previousActiveElement.current = document.activeElement;
    // Everything behind the scrim leaves the tab order and the accessibility tree while
    // the dialog is up. The portal renders the dialog root straight into body, so its
    // siblings are the page.
    const dialogRoot = modalRef.current?.closest('[role="dialog"]') ?? null;
    const siblings = Array.from(document.body.children).filter((node) => node !== dialogRoot);
    siblings.forEach((node) => node.setAttribute('inert', ''));
    modalRef.current?.focus();

    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !modalRef.current) return;
      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trap);

    return () => {
      document.body.style.overflow = 'unset';
      siblings.forEach((node) => node.removeAttribute('inert'));
      document.removeEventListener('keydown', trap);
      if (previousActiveElement.current instanceof HTMLElement) previousActiveElement.current.focus();
    };
  }, []);

  // Loading timeout - show error if loading takes more than 15 seconds
  useEffect(() => {
    if (!isLoading && details) {
      setLoadingTimedOut(false);
      return;
    }
    if (!isLoading && !details && !loadingTimedOut) {
      // Not loading but no details yet (initial state before fetch starts)
      return;
    }
    const timer = setTimeout(() => {
      setLoadingTimedOut(true);
    }, 15000);
    return () => clearTimeout(timer);
  }, [isLoading, details, loadingTimedOut]);

  // Signal evidence, strongest signal first. A signal that scored nothing and has nothing
  // to show is left out rather than listed as empty.
  const categories = useMemo<CategoryConfig[]>(() => {
    if (!details) return [];

    const cats: CategoryConfig[] = [
      {
        key: 'tag',
        hasEvidence: details.matched_tags.length > 0,
        renderContent: () => (
          details.matched_tags.length > 0 ? (
            <div className="space-y-2">
              {details.matched_tags.slice(0, 8).map((tag) => {
                const barWidth = Math.max(10, tag.weighted_score);
                return (
                  <div key={tag.id} className="flex items-center gap-3">
                    <span className="w-36 truncate text-sm text-[color:var(--ink)]" title={tag.name}>
                      {tag.name}
                    </span>
                    <div className="rc-meter flex-1 h-2">
                      <div className="rc-meter-fill" style={{ width: `${barWidth}%` }} />
                    </div>
                    <span
                      className="rc-num w-20 text-right text-xs text-[color:var(--nezu)]"
                      title={`Weighted score based on ${tag.count} VN(s) with this tag`}
                    >
                      <span className="font-semibold text-[color:var(--ink)]">
                        {tag.weighted_score.toFixed(0)}
                      </span>
                      <span className="ml-1 text-[color:var(--text-faint)]">({tag.count})</span>
                    </span>
                  </div>
                );
              })}
              <p className="rc-why mt-2">
                Weighted score (0-100) based on your ratings of VNs with this tag
              </p>
            </div>
          ) : (
            <p className="rc-why">No significant tag matches</p>
          )
        ),
      },
      {
        key: 'developer',
        hasEvidence: details.matched_developers.length > 0,
        renderContent: () => (
          <div className="space-y-2">
            {details.matched_developers.length > 0 ? (
              <>
                {details.matched_developers.slice(0, 5).map((dev, i) => (
                  <MatchRow
                    key={i}
                    name={getEntityDisplayName({ name: dev.name, original: dev.name_original }, titlePreference)}
                    score={dev.weighted_score}
                    count={dev.count}
                    countLabel={`Based on ${dev.count} VN(s) from this developer`}
                  />
                ))}
                <p className="rc-why mt-2">
                  Weighted score (0-100) based on your ratings of their VNs
                </p>
              </>
            ) : (
              <p className="rc-why">Based on your preferred developers/publishers</p>
            )}
          </div>
        ),
      },
      {
        key: 'staff',
        hasEvidence: details.matched_staff.length > 0,
        renderContent: () => (
          <div className="space-y-2">
            {details.matched_staff.length > 0 ? (
              <>
                {details.matched_staff.slice(0, 5).map((staff) => (
                  <MatchRow
                    key={staff.id}
                    name={getEntityDisplayName({ name: staff.name, original: staff.name_original }, titlePreference)}
                    score={staff.weighted_score}
                    count={staff.count}
                    countLabel={`Based on ${staff.count} VN(s) with this staff member`}
                  />
                ))}
                <p className="rc-why mt-2">
                  Weighted score (0-100) based on your ratings of their VNs
                </p>
              </>
            ) : (
              <p className="rc-why">Based on your preferred writers and artists</p>
            )}
          </div>
        ),
      },
      {
        key: 'seiyuu',
        hasEvidence: (details.matched_seiyuu?.length ?? 0) > 0,
        renderContent: () => (
          <div className="space-y-2">
            {details.matched_seiyuu && details.matched_seiyuu.length > 0 ? (
              <>
                {details.matched_seiyuu.map((seiyuu) => (
                  <MatchRow
                    key={seiyuu.id}
                    name={getEntityDisplayName({ name: seiyuu.name, original: seiyuu.name_original }, titlePreference)}
                    score={seiyuu.weighted_score}
                    count={seiyuu.count}
                    countLabel={`Based on ${seiyuu.count} VN(s) with this voice actor`}
                  />
                ))}
                <p className="rc-why mt-2">
                  Weighted score (0-100) based on your ratings of their VNs
                </p>
              </>
            ) : (
              <p className="rc-why">Based on your preferred voice actors</p>
            )}
          </div>
        ),
      },
      {
        key: 'trait',
        hasEvidence: (details.matched_traits?.length ?? 0) > 0,
        renderContent: () => (
          <div className="space-y-2">
            {details.matched_traits && details.matched_traits.length > 0 ? (
              <>
                {details.matched_traits.map((trait) => (
                  <MatchRow
                    key={trait.id}
                    name={trait.name}
                    score={trait.weighted_score}
                    count={trait.count}
                    countLabel={`Based on ${trait.count} VN(s) with this character trait`}
                  />
                ))}
                <p className="rc-why mt-2">
                  Weighted score (0-100) based on your ratings of VNs with these traits
                </p>
              </>
            ) : (
              <p className="rc-why">Based on your preferred character archetypes</p>
            )}
          </div>
        ),
      },
      {
        key: 'description',
        hasEvidence: (details.description_matches?.length ?? 0) > 0,
        renderContent: () => (
          <div className="space-y-2">
            {details.description_matches && details.description_matches.length > 0 ? (
              <>
                <p className="rc-why mb-2">Reads like VNs you&apos;ve rated highly:</p>
                {details.description_matches.slice(0, 5).map((match, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <Link
                      href={`/vn/${match.source_vn_id}/`}
                      className="rc-name min-w-0 truncate"
                      onClick={onClose}
                    >
                      {getSourceTitle(match, titlePreference)}
                    </Link>
                    <span className="rc-num shrink-0 text-sm text-[color:var(--nezu)]">
                      {(match.similarity * 100).toFixed(0)}% alike
                    </span>
                  </div>
                ))}
                <p className="rc-why mt-2">
                  How closely this title describes itself the way those do
                </p>
              </>
            ) : (
              <p className="rc-why">No description on record to compare</p>
            )}
          </div>
        ),
      },
      {
        key: 'similar_games',
        hasEvidence: details.similar_games.length > 0 || details.contributing_vns.length > 0,
        renderContent: () => (
          <div className="space-y-2">
            {details.similar_games.length > 0 ? (
              <>
                <p className="rc-why mb-2">Similar to VNs you&apos;ve rated highly:</p>
                {details.similar_games.slice(0, 5).map((match, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <Link
                      href={`/vn/${match.source_vn_id}/`}
                      className="rc-name min-w-0 truncate"
                      onClick={onClose}
                    >
                      {getSourceTitle(match, titlePreference)}
                    </Link>
                    <span className="rc-num shrink-0 text-sm text-[color:var(--nezu)]">
                      {(match.similarity * 100).toFixed(0)}% similar
                    </span>
                  </div>
                ))}
              </>
            ) : (
              <p className="rc-why">No similar titles on record</p>
            )}
            {details.contributing_vns.length > 0 && (
              <p className="rc-why mt-2">
                Because you liked{' '}
                {details.contributing_vns.map((vn, i) => (
                  <span key={vn.id}>
                    {i > 0 && ', '}
                    <Link href={`/vn/${vn.id.replace('v', '')}`} className="rc-name" onClick={onClose}>
                      {getDisplayTitle(
                        { title: vn.title, title_jp: vn.title_jp ?? undefined, title_romaji: vn.title_romaji ?? undefined },
                        titlePreference,
                      )}
                    </Link>{' '}
                    <span className="rc-num">({Math.round(vn.similarity)}%)</span>
                  </span>
                ))}
              </p>
            )}
          </div>
        ),
      },
      {
        key: 'users_also_read',
        hasEvidence: details.users_also_read.length > 0,
        renderContent: () => (
          <div className="space-y-2">
            {details.users_also_read.length > 0 ? (
              <>
                <p className="rc-why mb-2">Popular among fans of your favorites:</p>
                {details.users_also_read.slice(0, 5).map((match, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <Link
                      href={`/vn/${match.source_vn_id}/`}
                      className="rc-name min-w-0 truncate"
                      onClick={onClose}
                    >
                      {getSourceTitle(match, titlePreference)}
                    </Link>
                    <span className="rc-num shrink-0 text-sm text-[color:var(--nezu)]">
                      <span className="font-semibold text-[color:var(--ink)]">{match.user_count}</span> in common
                    </span>
                  </div>
                ))}
              </>
            ) : (
              <p className="rc-why">No co-reading data available</p>
            )}
          </div>
        ),
      },
      {
        key: 'quality',
        hasEvidence: false,
        renderContent: () => {
          // Convert quality score (0-1) back to rating (5-10)
          const estimatedRating = ((scores.quality ?? 0) * 5) + 5;
          return (
            <div className="space-y-2">
              <p className="text-sm text-[color:var(--nezu)]">
                Based on VNDB average rating:{' '}
                <span className="rc-num font-semibold text-[color:var(--ink)]">
                  {estimatedRating.toFixed(2)}
                </span>
              </p>
              <p className="rc-why">
                Higher-rated VNs receive a quality bonus. Formula: (rating - 5) / 5
              </p>
            </div>
          );
        },
      },
    ];

    return cats
      .filter((cat) => (scores[cat.key] ?? 0) > 0 || cat.hasEvidence)
      .sort((a, b) => (scores[b.key] ?? 0) - (scores[a.key] ?? 0));
  }, [details, titlePreference, scores, onClose]);

  return createPortal(
    <div className="rc-scrim" role="dialog" aria-modal="true" aria-labelledby="rec-detail-modal-title">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close breakdown"
        onClick={onClose}
        tabIndex={-1}
      />

      {/* Modal */}
      <div ref={modalRef} tabIndex={-1} className="rc-modal outline-hidden">
        {/* Header */}
        <div className="flex items-start gap-4 px-6 py-4 border-b border-[color:var(--rule)]">
          {/* Cover Image */}
          <div className="rc-art w-16 h-20 shrink-0">
            {image_url ? (
              <NSFWNextImage
                src={getProxiedImageUrl(image_url, { width: 128, vnId: vn_id }) ?? image_url}
                alt={title}
                imageSexual={image_sexual}
                fill
                className="object-cover object-top"
                sizes="64px"
                unoptimized // Proxied images already optimized as WebP
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-[color:var(--text-faint)]">
                <ImageOff aria-hidden className="w-6 h-6" />
              </div>
            )}
          </div>

          {/* Title and rating */}
          <div className="flex-1 min-w-0">
            <h2 id="rec-detail-modal-title" className="rc-name rc-name--lg font-bold line-clamp-2">
              {displayTitle}
            </h2>
            {rating && (
              <p className="rc-why mt-1">
                VNDB rating <span className="rc-num">{rating.toFixed(2)}</span>
              </p>
            )}
          </div>

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            className="rc-btn rc-btn--icon shrink-0"
            aria-label="Close breakdown"
          >
            <X aria-hidden className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Loading State */}
          {isLoading || !details ? (
            failed || loadingTimedOut ? (
              <div className="flex flex-col items-center justify-center gap-4 py-12">
                <p className="rc-caution text-sm">Could not load the breakdown. Close and try again.</p>
                <button type="button" onClick={onClose} className="rc-btn">
                  Close
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-4 py-12">
                <span aria-hidden className="rc-spin w-6 h-6" />
                <p className="rc-why">Loading details...</p>
              </div>
            )
          ) : (
            <>
          <div>
            <h3 className="rc-label mb-2">
              {list.name === 'combined' ? 'Agreement across lists' : `${SIGNAL_LABELS[list.signal!]} signal`}
            </h3>
            {list.signal && !signalRanks ? (
              <p className="rc-why rc-caution">{UNSEPARATED_SIGNAL_NOTE}</p>
            ) : (
              <div className="flex items-center gap-3">
                <div className="rc-meter flex-1 h-4">
                  <div className="rc-meter-fill" style={{ width: `${Math.min(recommendation.normalized_score, 100)}%` }} />
                </div>
                <span className="rc-num w-14 text-right text-lg font-bold text-[color:var(--ink)]">
                  {recommendation.normalized_score}%
                </span>
              </div>
            )}
            {list.name === 'combined' && recommendation.signals_ranked !== undefined && (
              <p className="rc-why mt-1">
                In {recommendation.signals_ranked} of {totalLists} lists. 100% would be first in every one.
              </p>
            )}
            {recommendation.predicted_rating && (
              <p className="rc-why mt-1">
                Predicted {recommendation.predicted_rating.mean.toFixed(1)}
                {recommendation.predicted_rating.low !== null && recommendation.predicted_rating.high !== null &&
                  ` (${recommendation.predicted_rating.low.toFixed(1)} to ${recommendation.predicted_rating.high.toFixed(1)})`}
              </p>
            )}
          </div>

          <div className="border-t border-[color:var(--rule)] pt-6">
            <h3 className="rc-label mb-4">Where each list placed it</h3>

            {recommendation.ranked_in && Object.keys(recommendation.ranked_in).length > 0 && (
              <ul className="rc-why grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 mb-4">
                {Object.entries(recommendation.ranked_in)
                  .sort((a, b) => a[1] - b[1])
                  .map(([signal, position]) => (
                    <li key={signal} className="flex justify-between gap-2">
                      <span>{SIGNAL_LABELS[signal as SignalKey] ?? signal}</span>
                      <span className="rc-num">#{Math.round(position)}</span>
                    </li>
                  ))}
              </ul>
            )}

            {categories.map((cat) => (
              <div key={cat.key} className="mb-6">
                <div className="flex items-baseline gap-2 mb-3">
                  <span className="font-medium text-[color:var(--ink)]">{SIGNAL_LABELS[cat.key]}</span>
                </div>
                {cat.renderContent()}
              </div>
            ))}
          </div>

            </>
          )}

          {/* View on VNDB button - always visible */}
          <div className="pt-4">
            <a
              href={`https://vndb.org/${vn_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rc-btn rc-btn--go rc-btn--wide"
            >
              <ExternalLink aria-hidden className="w-4 h-4" />
              View on VNDB
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

