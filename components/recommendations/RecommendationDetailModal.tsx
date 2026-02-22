'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { X, ExternalLink, Tag, Users, BookOpen, ImageOff, Mic, Heart, Building2, Pen, Star, LucideIcon } from 'lucide-react';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { NSFWNextImage } from '@/components/NSFWImage';

interface MatchedTag {
  id: number;
  name: string;
  user_weight: number;
  vn_score: number;
  contribution: number;  // user_weight * vn_score
  weighted_score: number;  // Stats page weighted score (0-100 scale)
  count: number;  // Number of user's VNs with this tag
}

interface MatchedStaff {
  id: string;
  name: string;
  user_avg_rating: number;
  weight: number;  // Delta from user's average
  weighted_score: number;  // Stats page weighted score (0-100 scale)
  count: number;  // Number of user's VNs with this staff
}

interface MatchedDeveloper {
  name: string;
  user_avg_rating: number;
  weight: number;  // Delta from user's average
  weighted_score: number;  // Stats page weighted score (0-100 scale)
  count: number;  // Number of user's VNs from this developer
}

interface ContributingVN {
  id: string;
  title: string;
  similarity: number;
}

interface MatchedSeiyuu {
  id: string;
  name: string;
  weighted_score: number;
  count: number;
}

interface MatchedTrait {
  id: number;
  name: string;
  weighted_score: number;
  count: number;
}

interface SimilarGamesDetail {
  source_vn_id: string;
  source_title?: string;
  similarity: number;
}

interface UsersAlsoReadDetail {
  source_vn_id: string;
  source_title?: string;
  co_score: number;
  user_count: number;
}

interface RecommendationDetails {
  matched_tags: MatchedTag[];
  matched_staff: MatchedStaff[];
  matched_developers: MatchedDeveloper[];
  matched_seiyuu?: MatchedSeiyuu[];
  matched_traits?: MatchedTrait[];
  contributing_vns: ContributingVN[];
  similar_games: SimilarGamesDetail[];
  users_also_read: UsersAlsoReadDetail[];
}

interface Recommendation {
  vn_id: string;
  title: string;
  title_jp?: string;       // Original Japanese title (kanji/kana)
  title_romaji?: string;   // Romanized title
  score: number;
  normalized_score?: number;  // 0-100 scale from backend
  match_reasons: string[];
  image_url: string | null;
  image_sexual: number | null;  // For NSFW blur (0=safe, 1=suggestive, 2=explicit)
  rating: number | null;
  scores: {
    tag: number;
    similar_games: number;
    users_also_read: number;
    developer?: number;
    staff: number;
    seiyuu?: number;
    trait?: number;
    quality?: number;
  };
  details?: RecommendationDetails;
}

interface RecommendationDetailModalProps {
  recommendation: Recommendation;
  onClose: () => void;
  isLoading?: boolean;
}

// Category configuration type
interface CategoryConfig {
  key: string;
  name: string;
  Icon: LucideIcon;
  iconColorClass: string;
  barColorClass: string;
  textColorClass: string;
  percent: number;
  renderContent: () => React.ReactNode;
}

export function RecommendationDetailModal({ recommendation, onClose, isLoading = false }: RecommendationDetailModalProps) {
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

  // Prevent body scroll when modal is open + manage focus
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    previousActiveElement.current = document.activeElement;
    // Focus the modal container on mount
    modalRef.current?.focus();
    return () => {
      document.body.style.overflow = 'unset';
      // Restore focus to previously active element on unmount
      if (previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus();
      }
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

  // Calculate total weighted score and percentages (must match backend weights)
  // Backend weights: TAG=2.5, VN_SIMILARITY=2.0, USERS_ALSO_READ=2.0, QUALITY=1.5, DEVELOPER=0.6, STAFF=0.5, SEIYUU=0.3, TRAIT=0.5
  const tagContribution = scores.tag * 2.5;
  const similarGamesContribution = scores.similar_games * 2.0;
  const usersAlsoReadContribution = scores.users_also_read * 2.0;
  const qualityContribution = (scores.quality || 0) * 1.5;
  const developerContribution = (scores.developer || 0) * 0.6;
  const staffContribution = scores.staff * 0.5;
  const seiyuuContribution = (scores.seiyuu || 0) * 0.3;
  const traitContribution = (scores.trait || 0) * 0.5;
  const totalContribution = tagContribution + similarGamesContribution + usersAlsoReadContribution + qualityContribution + developerContribution + staffContribution + seiyuuContribution + traitContribution;

  // Calculate percentage of total score each component contributes
  const tagPercent = totalContribution > 0 ? Math.round((tagContribution / totalContribution) * 100) : 0;
  const similarGamesPercent = totalContribution > 0 ? Math.round((similarGamesContribution / totalContribution) * 100) : 0;
  const usersAlsoReadPercent = totalContribution > 0 ? Math.round((usersAlsoReadContribution / totalContribution) * 100) : 0;
  const qualityPercent = totalContribution > 0 ? Math.round((qualityContribution / totalContribution) * 100) : 0;
  const developerPercent = totalContribution > 0 ? Math.round((developerContribution / totalContribution) * 100) : 0;
  const staffPercent = totalContribution > 0 ? Math.round((staffContribution / totalContribution) * 100) : 0;
  const seiyuuPercent = totalContribution > 0 ? Math.round((seiyuuContribution / totalContribution) * 100) : 0;
  const traitPercent = totalContribution > 0 ? Math.round((traitContribution / totalContribution) * 100) : 0;

  // Overall score from backend (0-100) or fallback calculation
  const overallPercent = recommendation.normalized_score ?? Math.min(100, Math.round(recommendation.score * 18));

  // Build sortable categories array
  const categories = useMemo<CategoryConfig[]>(() => {
    if (!details) return [];

    const cats: CategoryConfig[] = [
      {
        key: 'tag',
        name: 'Tag Matching',
        Icon: Tag,
        iconColorClass: 'text-blue-500',
        barColorClass: 'bg-blue-500',
        textColorClass: 'text-blue-600 dark:text-blue-400',
        percent: tagPercent,
        renderContent: () => (
          details.matched_tags.length > 0 ? (
            <div className="space-y-2 pl-7">
              {details.matched_tags.slice(0, 8).map((tag) => {
                const barWidth = Math.max(10, tag.weighted_score);
                return (
                  <div key={tag.id} className="flex items-center gap-2">
                    <span className="text-sm text-gray-700 dark:text-gray-300 w-36 truncate" title={tag.name}>
                      {tag.name}
                    </span>
                    <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <span
                      className="text-xs text-gray-500 dark:text-gray-400 w-20 text-right"
                      title={`Weighted score based on ${tag.count} VN(s) with this tag`}
                    >
                      <span className="text-blue-600 dark:text-blue-400 font-medium">
                        {tag.weighted_score.toFixed(0)}
                      </span>
                      <span className="text-gray-400 dark:text-gray-500 ml-1">
                        ({tag.count})
                      </span>
                    </span>
                  </div>
                );
              })}
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                Weighted score (0-100) based on your ratings of VNs with this tag
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 pl-7">
              No significant tag matches
            </p>
          )
        ),
      },
      {
        key: 'developer',
        name: 'Developer Match',
        Icon: Building2,
        iconColorClass: 'text-orange-500',
        barColorClass: 'bg-orange-500',
        textColorClass: 'text-orange-600 dark:text-orange-400',
        percent: developerPercent,
        renderContent: () => (
          <div className="pl-7 space-y-2">
            {details.matched_developers.length > 0 ? (
              <>
                {details.matched_developers.slice(0, 5).map((dev, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                      <span className="font-medium">{dev.name}</span>
                    </span>
                    <span
                      className="text-sm font-medium text-orange-600 dark:text-orange-400 ml-2 shrink-0"
                      title={`Based on ${dev.count} VN(s) from this developer`}
                    >
                      {dev.weighted_score.toFixed(0)}
                      <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">
                        ({dev.count})
                      </span>
                    </span>
                  </div>
                ))}
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                  Weighted score (0-100) based on your ratings of their VNs
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Based on your preferred developers/publishers
              </p>
            )}
          </div>
        ),
      },
      {
        key: 'staff',
        name: 'Staff Match',
        Icon: Pen,
        iconColorClass: 'text-amber-500',
        barColorClass: 'bg-amber-500',
        textColorClass: 'text-amber-600 dark:text-amber-400',
        percent: staffPercent,
        renderContent: () => (
          <div className="pl-7 space-y-2">
            {details.matched_staff.length > 0 ? (
              <>
                {details.matched_staff.slice(0, 5).map((staff) => (
                  <div key={staff.id} className="flex items-center justify-between">
                    <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                      <span className="font-medium">{staff.name}</span>
                    </span>
                    <span
                      className="text-sm font-medium text-amber-600 dark:text-amber-400 ml-2 shrink-0"
                      title={`Based on ${staff.count} VN(s) with this staff member`}
                    >
                      {staff.weighted_score.toFixed(0)}
                      <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">
                        ({staff.count})
                      </span>
                    </span>
                  </div>
                ))}
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                  Weighted score (0-100) based on your ratings of their VNs
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Based on your preferred writers and artists
              </p>
            )}
          </div>
        ),
      },
      {
        key: 'seiyuu',
        name: 'Voice Actors',
        Icon: Mic,
        iconColorClass: 'text-pink-500',
        barColorClass: 'bg-pink-500',
        textColorClass: 'text-pink-600 dark:text-pink-400',
        percent: seiyuuPercent,
        renderContent: () => (
          <div className="pl-7 space-y-2">
            {details.matched_seiyuu && details.matched_seiyuu.length > 0 ? (
              <>
                {details.matched_seiyuu.map((seiyuu) => (
                  <div key={seiyuu.id} className="flex items-center justify-between">
                    <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                      {seiyuu.name}
                    </span>
                    <span
                      className="text-sm font-medium text-pink-600 dark:text-pink-400 ml-2 shrink-0"
                      title={`Based on ${seiyuu.count} VN(s) with this voice actor`}
                    >
                      {seiyuu.weighted_score.toFixed(0)}
                      <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">
                        ({seiyuu.count})
                      </span>
                    </span>
                  </div>
                ))}
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                  Weighted score (0-100) based on your ratings of their VNs
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Based on your preferred voice actors
              </p>
            )}
          </div>
        ),
      },
      {
        key: 'trait',
        name: 'Character Traits',
        Icon: Heart,
        iconColorClass: 'text-rose-500',
        barColorClass: 'bg-rose-500',
        textColorClass: 'text-rose-600 dark:text-rose-400',
        percent: traitPercent,
        renderContent: () => (
          <div className="pl-7 space-y-2">
            {details.matched_traits && details.matched_traits.length > 0 ? (
              <>
                {details.matched_traits.map((trait) => (
                  <div key={trait.id} className="flex items-center justify-between">
                    <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                      {trait.name}
                    </span>
                    <span
                      className="text-sm font-medium text-rose-600 dark:text-rose-400 ml-2 shrink-0"
                      title={`Based on ${trait.count} VN(s) with this character trait`}
                    >
                      {trait.weighted_score.toFixed(0)}
                      <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">
                        ({trait.count})
                      </span>
                    </span>
                  </div>
                ))}
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                  Weighted score (0-100) based on your ratings of VNs with these traits
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Based on your preferred character archetypes
              </p>
            )}
          </div>
        ),
      },
      {
        key: 'similar_games',
        name: 'Similar Games',
        Icon: BookOpen,
        iconColorClass: 'text-green-500',
        barColorClass: 'bg-green-500',
        textColorClass: 'text-green-600 dark:text-green-400',
        percent: similarGamesPercent,
        renderContent: () => (
          <div className="pl-7 space-y-2">
            {details.similar_games && details.similar_games.length > 0 ? (
              <>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                  Similar to VNs you&apos;ve rated highly:
                </p>
                {details.similar_games.slice(0, 5).map((match, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <Link
                      href={`/vn/${match.source_vn_id}/`}
                      className="text-sm text-gray-700 dark:text-gray-300 hover:text-green-600 dark:hover:text-green-400 truncate"
                      onClick={onClose}
                    >
                      {match.source_title || match.source_vn_id}
                    </Link>
                    <span className="text-sm font-medium text-green-600 dark:text-green-400 ml-2 shrink-0">
                      {(match.similarity * 100).toFixed(0)}% similar
                    </span>
                  </div>
                ))}
              </>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No similar games data available
              </p>
            )}
          </div>
        ),
      },
      {
        key: 'users_also_read',
        name: 'Users Also Read',
        Icon: Users,
        iconColorClass: 'text-teal-500',
        barColorClass: 'bg-teal-500',
        textColorClass: 'text-teal-600 dark:text-teal-400',
        percent: usersAlsoReadPercent,
        renderContent: () => (
          <div className="pl-7 space-y-2">
            {details.users_also_read && details.users_also_read.length > 0 ? (
              <>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                  Popular among fans of your favorites:
                </p>
                {details.users_also_read.slice(0, 5).map((match, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <Link
                      href={`/vn/${match.source_vn_id}/`}
                      className="text-sm text-gray-700 dark:text-gray-300 hover:text-teal-600 dark:hover:text-teal-400 truncate"
                      onClick={onClose}
                    >
                      {match.source_title || match.source_vn_id}
                    </Link>
                    <span className="text-sm text-teal-600 dark:text-teal-400 ml-2 shrink-0">
                      <span className="font-medium">{match.user_count}</span> in common
                    </span>
                  </div>
                ))}
              </>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No co-reading data available
              </p>
            )}
          </div>
        ),
      },
      {
        key: 'quality',
        name: 'Quality',
        Icon: Star,
        iconColorClass: 'text-yellow-500',
        barColorClass: 'bg-yellow-500',
        textColorClass: 'text-yellow-600 dark:text-yellow-400',
        percent: qualityPercent,
        renderContent: () => {
          // Convert quality score (0-1) back to rating (5-10)
          const estimatedRating = ((scores.quality || 0) * 5) + 5;
          return (
            <div className="pl-7 space-y-2">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Based on VNDB average rating: <span className="font-medium text-yellow-600 dark:text-yellow-400">{estimatedRating.toFixed(2)}</span>
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Higher-rated VNs receive a quality bonus. Formula: (rating - 5) / 5
              </p>
            </div>
          );
        },
      },
    ];

    // Sort by percentage (highest first) - show all categories for debugging
    return cats.sort((a, b) => b.percent - a.percent);
  }, [details, tagPercent, similarGamesPercent, usersAlsoReadPercent, qualityPercent, developerPercent, staffPercent, seiyuuPercent, traitPercent, scores.quality]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="rec-detail-modal-title">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      {/* Modal */}
      <div ref={modalRef} tabIndex={-1} className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden outline-hidden">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-4 z-10">
          <div className="flex items-start gap-4">
            {/* Cover Image */}
            <div className="relative w-16 h-20 shrink-0 bg-gray-200 dark:bg-gray-700 rounded-lg overflow-hidden">
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
                <div className="absolute inset-0 flex items-center justify-center">
                  <ImageOff className="w-6 h-6 text-gray-400" />
                </div>
              )}
            </div>

            {/* Title and rating */}
            <div className="flex-1 min-w-0">
              <h2 id="rec-detail-modal-title" className="text-lg font-bold text-gray-900 dark:text-white line-clamp-2">
                {displayTitle}
              </h2>
              {rating && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  VNDB Rating: {rating.toFixed(2)}
                </p>
              )}
            </div>

            {/* Close button */}
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(85vh-120px)] p-6 space-y-6">
          {/* Loading State */}
          {isLoading || !details ? (
            loadingTimedOut ? (
              <div className="flex flex-col items-center justify-center py-12">
                <p className="text-red-500 dark:text-red-400 text-sm mb-4">
                  Failed to load details. The request timed out.
                </p>
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="animate-spin rounded-full h-10 w-10 border-2 border-violet-200 border-t-violet-600 mb-4" />
                <p className="text-gray-500 dark:text-gray-400 text-sm">Loading details...</p>
              </div>
            )
          ) : (
            <>
          {/* Overall Match Score */}
          <div>
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              Overall Match Score
            </h3>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-linear-to-r from-violet-500 to-violet-600 rounded-full transition-all"
                  style={{ width: `${Math.min(overallPercent, 100)}%` }}
                />
              </div>
              <span className="text-lg font-bold text-violet-600 dark:text-violet-400 w-14 text-right">
                {overallPercent}%
              </span>
            </div>
          </div>

          {/* Score Breakdown - Dynamic sorted categories */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">
              Score Breakdown
            </h3>

            {categories.map((cat) => (
              <div key={cat.key} className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <cat.Icon className={`w-5 h-5 ${cat.iconColorClass}`} />
                  <span className="font-medium text-gray-900 dark:text-white">
                    {cat.name}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400 ml-auto">
                    {cat.percent}% of score
                  </span>
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
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-medium transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              View on VNDB
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
