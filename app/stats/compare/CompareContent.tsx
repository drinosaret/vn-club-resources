'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from '@/components/Link';
import { ArrowLeft, Users, Loader2 } from 'lucide-react';
import {
  vndbStatsApi,
  UserComparisonResponse,
  SharedVNScore,
  SimilarUser,
} from '@/lib/vndb-stats-api';
import { CompareCompatibility } from '@/components/stats/CompareCompatibility';
import { StatsCrossLinks } from '@/components/stats/StatsCrossLinks';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { useDisplayTitle } from '@/lib/title-preference';
import { StatsSummaryCard } from '@/components/stats/StatsSummaryCard';
import { FadeIn } from '@/components/FadeIn';

type Mode = 'compare' | 'similar';

/**
 * How many shared favourites a comparison carries. The list is a sample, not a tally, so a
 * response holding this many titles states a floor and the summary figure is marked as one.
 */
const SHARED_FAVORITES_CAP = 10;

interface UserLookupResult {
  uid: string;
  username: string;
}

export default function CompareContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Mode: 'compare' or 'similar'
  const [mode, setMode] = useState<Mode>(() => {
    return searchParams.get('mode') === 'similar' ? 'similar' : 'compare';
  });

  // User inputs
  const [user1Input, setUser1Input] = useState('');
  const [user2Input, setUser2Input] = useState('');
  const [user1, setUser1] = useState<UserLookupResult | null>(null);
  const [user2, setUser2] = useState<UserLookupResult | null>(null);

  // Results
  const [comparison, setComparison] = useState<UserComparisonResponse | null>(null);
  const [similarUsers, setSimilarUsers] = useState<SimilarUser[] | null>(null);

  // Loading states
  const [isLoading, setIsLoading] = useState(false);
  const [isLookingUp1, setIsLookingUp1] = useState(false);
  const [isLookingUp2, setIsLookingUp2] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const initialLoadRef = useRef(false);
  const pendingCompareRef = useRef(false);
  const pendingSimilarRef = useRef(false);

  // Auto-load users from URL params
  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;

    const modeParam = searchParams.get('mode');
    const u1Param = searchParams.get('user1');
    const u2Param = searchParams.get('user2');

    if (modeParam === 'similar') {
      setMode('similar');
      if (u1Param) {
        pendingSimilarRef.current = true;
        setUser1Input(u1Param);
        setLookupError(null);
        vndbStatsApi.lookupUser(u1Param).then(user => {
          if (user) {
            setUser1(user);
          } else {
            setLookupError(`User "${u1Param}" not found on VNDB`);
          }
        }).catch(() => {
          setLookupError(`Failed to look up user "${u1Param}". Please try again.`);
        });
      }
    } else if (u1Param || u2Param) {
      setMode('compare');
      pendingCompareRef.current = true;
      setLookupError(null);

      const lookups: Promise<void>[] = [];
      const failedUsers: string[] = [];

      if (u1Param) {
        setUser1Input(u1Param);
        lookups.push(
          vndbStatsApi.lookupUser(u1Param).then(user => {
            if (user) {
              setUser1(user);
            } else {
              failedUsers.push(u1Param);
            }
          }).catch(() => {
            failedUsers.push(u1Param);
          })
        );
      }

      if (u2Param) {
        setUser2Input(u2Param);
        lookups.push(
          vndbStatsApi.lookupUser(u2Param).then(user => {
            if (user) {
              setUser2(user);
            } else {
              failedUsers.push(u2Param);
            }
          }).catch(() => {
            failedUsers.push(u2Param);
          })
        );
      }

      // Show error after all lookups complete
      Promise.all(lookups).then(() => {
        if (failedUsers.length > 0) {
          setLookupError(`User${failedUsers.length > 1 ? 's' : ''} not found: ${failedUsers.join(', ')}`);
        }
      });
    }
  }, [searchParams]);

  // Auto-compare when both users are loaded from URL params
  useEffect(() => {
    if (!pendingCompareRef.current || !user1 || !user2) return;
    pendingCompareRef.current = false;

    setIsLoading(true);
    setError(null);

    vndbStatsApi.compareUsers(user1.uid, user2.uid, user1.username, user2.username)
      .then(result => {
        setComparison({
          ...result,
          user1: { uid: user1.uid, username: user1.username },
          user2: { uid: user2.uid, username: user2.username },
        });
      })
      .catch(() => {
        setError('Failed to compare users. Make sure both users have public lists.');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [user1, user2]);

  // Auto-load similar users when user1 is loaded in similar mode
  useEffect(() => {
    if (!pendingSimilarRef.current || !user1) return;
    pendingSimilarRef.current = false;

    loadSimilarUsers(user1.uid);
  }, [user1]);

  // Set page title
  useEffect(() => {
    if (comparison) {
      document.title = `${comparison.user1.username} vs ${comparison.user2.username} | VN Club`;
    } else if (mode === 'similar') {
      document.title = 'Find Similar Users | VN Club';
    } else {
      document.title = 'Compare Users | VN Club';
    }
  }, [comparison, mode]);

  const loadSimilarUsers = async (uid: string) => {
    setIsLoading(true);
    setError(null);
    setSimilarUsers(null);

    try {
      const similar = await vndbStatsApi.getSimilarUsers(uid, 12);
      setSimilarUsers(similar);
    } catch {
      setError('Failed to load similar users.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLookupUser = async (
    input: string,
    setUser: (u: UserLookupResult | null) => void,
    setLoading: (l: boolean) => void
  ) => {
    if (!input.trim()) {
      setUser(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const user = await vndbStatsApi.lookupUser(input.trim());
      if (user) {
        setUser(user);
      } else {
        setUser(null);
        setError(`User "${input}" not found on VNDB`);
      }
    } catch {
      setUser(null);
      setError('Failed to look up user');
    } finally {
      setLoading(false);
    }
  };

  const handleCompare = async (e: FormEvent) => {
    e.preventDefault();
    if (!user1 || !user2) return;

    setIsLoading(true);
    setError(null);
    setLookupError(null);

    try {
      const result = await vndbStatsApi.compareUsers(
        user1.uid,
        user2.uid,
        user1.username,
        user2.username
      );
      setComparison({
        ...result,
        user1: { uid: user1.uid, username: user1.username },
        user2: { uid: user2.uid, username: user2.username },
      });
    } catch {
      setError('Failed to compare users. Make sure both users have public lists.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFindSimilar = async (e: FormEvent) => {
    e.preventDefault();
    if (!user1) return;

    loadSimilarUsers(user1.uid);
  };

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    setError(null);
    setLookupError(null);
    setComparison(null);
    setSimilarUsers(null);
    // Update URL
    const params = new URLSearchParams();
    if (newMode === 'similar') {
      params.set('mode', 'similar');
      if (user1) params.set('user1', user1.uid);
    } else {
      if (user1) params.set('user1', user1.uid);
      if (user2) params.set('user2', user2.uid);
    }
    router.replace(`/stats/compare?${params.toString()}`);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => window.history.back()}
          aria-label="Go back"
          className="st-act st-act--icon"
        >
          <ArrowLeft className="w-5 h-5 text-[color:var(--nezu)]" />
        </button>
        <div>
          <h1 className="sec-title">
            {mode === 'similar' ? 'Find Similar Users' : 'Compare Lists'}
          </h1>
          <p className="text-[color:var(--nezu)]">
            {mode === 'similar'
              ? 'Find users with similar VN taste'
              : 'See how your VN taste matches with another user'}
          </p>
        </div>
      </div>

      {/* Mode Tabs */}
      <div className="tabs mb-6">
        <button
          onClick={() => handleModeChange('compare')}
          aria-pressed={mode === 'compare'}
          className={`tab ${mode === 'compare' ? 'tab--on' : ''}`}
        >
          Compare Two Users
        </button>
        <button
          onClick={() => handleModeChange('similar')}
          aria-pressed={mode === 'similar'}
          className={`tab ${mode === 'similar' ? 'tab--on' : ''}`}
        >
          Find Similar Users
        </button>
      </div>

      {/* Input Form */}
      {mode === 'similar' ? (
        <form onSubmit={handleFindSimilar} className="mb-8">
          <div className="st-card p-6">
            <label className="fig-label mb-2">
              VNDB Username
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={user1Input}
                  onChange={(e) => {
                    setUser1Input(e.target.value);
                    setUser1(null);
                  }}
                  onBlur={() => handleLookupUser(user1Input, setUser1, setIsLookingUp1)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleLookupUser(user1Input, setUser1, setIsLookingUp1);
                    }
                  }}
                  placeholder="Enter your VNDB username"
                  className="st-field w-full px-4 py-2"
                />
                {isLookingUp1 && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Loader2 className="h-4 w-4 animate-spin text-[color:var(--ai)]" aria-hidden="true" />
                  </div>
                )}
              </div>
              {user1 && (
                <span className="st-badge self-center">{user1.username}</span>
              )}
            </div>

            {(error || lookupError) && (
              <p className="mt-4 text-sm text-[color:var(--beni-text)]">{error || lookupError}</p>
            )}

            <button
              type="submit"
              disabled={!user1 || isLoading}
              className="st-act st-act--go mt-6 w-full disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <>
                  Find Similar Users
                </>
              )}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleCompare} className="mb-8">
          <div className="st-card p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* User 1 */}
              <div>
                <label className="fig-label mb-2">
                  User 1
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={user1Input}
                      onChange={(e) => {
                        setUser1Input(e.target.value);
                        setUser1(null);
                      }}
                      onBlur={() => handleLookupUser(user1Input, setUser1, setIsLookingUp1)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleLookupUser(user1Input, setUser1, setIsLookingUp1);
                        }
                      }}
                      placeholder="VNDB username"
                      className="st-field w-full px-4 py-2"
                    />
                    {isLookingUp1 && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <Loader2 className="h-4 w-4 animate-spin text-[color:var(--ai)]" aria-hidden="true" />
                      </div>
                    )}
                  </div>
                  {user1 && (
                    <span className="st-badge self-center">{user1.username}</span>
                  )}
                </div>
              </div>

              {/* User 2 */}
              <div>
                <label className="fig-label mb-2">
                  User 2
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={user2Input}
                      onChange={(e) => {
                        setUser2Input(e.target.value);
                        setUser2(null);
                      }}
                      onBlur={() => handleLookupUser(user2Input, setUser2, setIsLookingUp2)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleLookupUser(user2Input, setUser2, setIsLookingUp2);
                        }
                      }}
                      placeholder="VNDB username"
                      className="st-field w-full px-4 py-2"
                    />
                    {isLookingUp2 && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <Loader2 className="h-4 w-4 animate-spin text-[color:var(--ai)]" aria-hidden="true" />
                      </div>
                    )}
                  </div>
                  {user2 && (
                    <span className="st-badge self-center">{user2.username}</span>
                  )}
                </div>
              </div>
            </div>

            {(error || lookupError) && (
              <p className="mt-4 text-sm text-[color:var(--beni-text)]">{error || lookupError}</p>
            )}

            <button
              type="submit"
              disabled={!user1 || !user2 || isLoading}
              className="st-act st-act--go mt-6 w-full disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <>
                  Compare Lists
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Results */}
      {mode === 'similar' && similarUsers && (
        <FadeIn>
          <SimilarUsersResults
            similarUsers={similarUsers}
            currentUid={user1?.uid || ''}
            currentUsername={user1?.username || ''}
            onCompare={(otherUser) => {
              if (!user1) return;
              setUser2({ uid: otherUser.uid, username: otherUser.username });
              setMode('compare');
              setError(null);
              setSimilarUsers(null);
              setIsLoading(true);

              const params = new URLSearchParams();
              params.set('user1', user1.uid);
              params.set('user2', otherUser.uid);
              router.replace(`/stats/compare?${params.toString()}`);

              vndbStatsApi.compareUsers(user1.uid, otherUser.uid, user1.username, otherUser.username)
                .then(result => {
                  setComparison({
                    ...result,
                    user1: { uid: user1.uid, username: user1.username },
                    user2: { uid: otherUser.uid, username: otherUser.username },
                  });
                })
                .catch(() => {
                  setError('Failed to compare users. Make sure both users have public lists.');
                })
                .finally(() => {
                  setIsLoading(false);
                });
            }}
          />
        </FadeIn>
      )}

      {mode === 'compare' && comparison && (
        <FadeIn>
          <ComparisonResults comparison={comparison} />
        </FadeIn>
      )}

      <StatsCrossLinks current="compare" />
    </div>
  );
}

function SimilarUsersResults({
  similarUsers,
  currentUid,
  currentUsername,
  onCompare,
}: {
  similarUsers: SimilarUser[];
  currentUid: string;
  currentUsername: string;
  onCompare: (user: SimilarUser) => void;
}) {
  if (similarUsers.length === 0) {
    return (
      <div className="st-card p-8 text-center">
        <h3 className="st-card-title mb-2">
          No Similar Users to Show
        </h3>
        {/* An empty result and a search that never ran arrive here as the same thing, so the
            wording covers both rather than telling a reader something about their own list. */}
        <p className="text-[color:var(--nezu)] max-w-md mx-auto">
          Either no users share enough rated VNs with this one, or the search could not be
          completed. Try again, or try a user with more rated VNs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="sec-sub">
          Found {similarUsers.length} users with similar taste to {currentUsername}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {similarUsers.map((user) => (
          <SimilarUserCard key={user.uid} user={user} currentUid={currentUid} onCompare={() => onCompare(user)} />
        ))}
      </div>

      <p className="st-card-sub text-center">
        Similarity is calculated based on shared VNs, rating patterns, and tag preferences.
      </p>
    </div>
  );
}

function SimilarUserCard({ user, currentUid, onCompare }: { user: SimilarUser; currentUid: string; onCompare: () => void }) {
  const compatibilityPercent = Math.round(user.compatibility * 100);

  return (
    <div className="st-card st-card--pick p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/stats/${user.uid}?username=${encodeURIComponent(user.username)}`}
            className="dg-name block"
          >
            {user.username}
          </Link>
          {user.avg_score != null && (
            <div className="st-num text-xs text-[color:var(--text-faint)]">
              {user.avg_score.toFixed(1)} avg
            </div>
          )}
        </div>
        <div className="fig-value shrink-0">{compatibilityPercent}%</div>
      </div>

      <div className="st-num mb-3 text-xs text-[color:var(--text-faint)]">
        {user.shared_vns} shared VNs
      </div>

      {/* Compatibility bar */}
      <div className="st-bar mb-3 h-1.5">
        <div
          className={`st-bar-fill ${compatibilityPercent < 35 ? 'st-bar-fill--quiet' : ''}`}
          style={{ width: `${compatibilityPercent}%` }}
        />
      </div>

      <button onClick={onCompare} className="sec-more">
        Compare lists
        <span aria-hidden>&rarr;</span>
      </button>
    </div>
  );
}

function ComparisonResults({ comparison }: { comparison: UserComparisonResponse }) {
  const compatibilityPercent = Math.round(comparison.compatibility_score * 100);

  return (
    <div className="space-y-6">
      {/* Compatibility Header */}
      <div className="st-card p-6 text-center">
        <p className="fig-label">Compatibility</p>
        <p className="fig-value">{compatibilityPercent}%</p>
        <p className="st-card-sub mt-2">
          Compatibility between{' '}
          <span className="font-semibold text-[color:var(--ink)]">{comparison.user1.username}</span>
          {' '}and{' '}
          <span className="font-semibold text-[color:var(--ink)]">{comparison.user2.username}</span>
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsSummaryCard
          label="Compatibility"
          value={`${compatibilityPercent}%`}
          subtext={compatibilityPercent >= 60 ? 'Great match!' : compatibilityPercent >= 35 ? 'Some overlap' : 'Different tastes'}
          tooltip="Weighted combination of list overlap, rating similarity, and tag preferences. With more shared VNs, rating correlation matters more. With fewer shared VNs, tag similarity is weighted higher."
        />
        <StatsSummaryCard
          label="Shared VNs"
          value={comparison.shared_vns.toString()}
          subtext="rated by both"
          tooltip="Visual novels that both users have rated. Only VNs with scores from both users are counted."
        />
        <StatsSummaryCard
          label="Confidence"
          value={comparison.confidence != null ? `${Math.round(comparison.confidence * 100)}%` : 'N/A'}
          subtext={comparison.confidence != null ? (comparison.confidence >= 0.7 ? 'High reliability' : comparison.confidence >= 0.3 ? 'Moderate data' : 'Limited data') : 'calculating...'}
          tooltip="How reliable is this comparison? Based on number of shared rated VNs. Formula: min(shared_rated / 20, 100%). More shared ratings = higher confidence in the comparison."
        />
        <StatsSummaryCard
          label="Favorites"
          value={`${comparison.shared_favorites.length}${comparison.shared_favorites.length >= SHARED_FAVORITES_CAP ? '+' : ''}`}
          subtext="both love"
          tooltip="VNs that both users rated 8/10 or higher. The comparison carries at most ten of them, so a figure marked with a plus is a floor rather than the total."
        />
      </div>

      <CompareCompatibility
        jaccardSimilarity={comparison.jaccard_similarity ?? null}
        ratingAgreement={comparison.rating_agreement ?? null}
        tagSimilarity={comparison.tag_similarity ?? null}
        scoreCorrelation={comparison.score_correlation}
        sharedVNs={comparison.shared_vns}
      />

      {/* Common Tags */}
      {comparison.common_tags && comparison.common_tags.length > 0 && (
        <div className="st-card p-6">
          <h3 className="st-card-title">Shared Favorites Tags</h3>
          <p className="st-card-sub mb-4">Tags you both rate highly</p>
          <div className="flex flex-wrap gap-2">
            {comparison.common_tags.map((tag) => (
              <span
                key={tag}
                className="st-chip"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Differing Tastes */}
      {comparison.differing_tastes &&
        (comparison.differing_tastes.user1_prefers?.length > 0 ||
         comparison.differing_tastes.user2_prefers?.length > 0) && (
        <div className="st-card p-6">
          <h3 className="st-card-title">Differing Tastes</h3>
          <p className="st-card-sub mb-4">Tags where your ratings differ significantly</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {comparison.differing_tastes.user1_prefers?.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-[color:var(--text-secondary)] mb-2">
                  {comparison.user1.username} prefers:
                </h4>
                <div className="flex flex-wrap gap-2">
                  {comparison.differing_tastes.user1_prefers.map((tag) => (
                    <span
                      key={tag}
                      className="st-chip"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {comparison.differing_tastes.user2_prefers?.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-[color:var(--text-secondary)] mb-2">
                  {comparison.user2.username} prefers:
                </h4>
                <div className="flex flex-wrap gap-2">
                  {comparison.differing_tastes.user2_prefers.map((tag) => (
                    <span
                      key={tag}
                      className="st-chip"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Shared Favorites */}
      {comparison.shared_favorites.length > 0 && (
        <SharedVNsSection
          title="Shared Favorites"
          subtitle="VNs you both rated 8+/10"
          vns={comparison.shared_favorites}
          user1Name={comparison.user1.username}
          user2Name={comparison.user2.username}
        />
      )}

      {/* Biggest Disagreements */}
      {comparison.biggest_disagreements.length > 0 && (
        <SharedVNsSection
          title="Biggest Disagreements"
          subtitle="VNs with very different ratings"
          vns={comparison.biggest_disagreements}
          user1Name={comparison.user1.username}
          user2Name={comparison.user2.username}
          showDifference
        />
      )}

      {/* No shared VNs message */}
      {comparison.shared_vns === 0 && (
        <div className="st-card p-8 text-center">
          <h3 className="st-card-title mb-2">No Shared VNs</h3>
          <p className="st-card-sub">
            These users haven&apos;t read any of the same visual novels yet.
          </p>
        </div>
      )}
    </div>
  );
}

interface SharedVNsSectionProps {
  title: string;
  subtitle: string;
  vns: SharedVNScore[];
  user1Name: string;
  user2Name: string;
  showDifference?: boolean;
}

function SharedVNsSection({
  title,
  subtitle,
  vns,
  user1Name,
  user2Name,
  showDifference = false,
}: SharedVNsSectionProps) {
  return (
    <div className="st-card p-6">
      <h3 className="st-card-title">{title}</h3>
      <p className="st-card-sub mb-4">{subtitle}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {vns.map((vn) => (
          <VNComparisonCard
            key={vn.vn_id}
            vn={vn}
            user1Name={user1Name}
            user2Name={user2Name}
            showDifference={showDifference}
          />
        ))}
      </div>
    </div>
  );
}

function VNComparisonCard({
  vn,
  user1Name,
  user2Name,
  showDifference,
}: {
  vn: SharedVNScore;
  user1Name: string;
  user2Name: string;
  showDifference?: boolean;
}) {
  const getTitle = useDisplayTitle();
  const displayTitle = getTitle(vn);
  const scoreDiff = Math.abs(vn.user1_score - vn.user2_score);

  return (
    <Link
      href={`/vn/${vn.vn_id}`}
      className="st-card st-card--pick group flex gap-3 p-3"
    >
      {/* Image */}
      <div className="h-20 w-16 shrink-0 overflow-hidden rounded-xs border border-[color:var(--rule)] bg-[color:var(--surface-inset)]">
        {vn.image_url ? (
          <img
            src={getProxiedImageUrl(vn.image_url, { width: 128, vnId: vn.vn_id }) ?? undefined}
            alt={displayTitle}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[color:var(--text-faint)]">
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="dg-name line-clamp-2 dg-name--wrap">{displayTitle}</h4>
        <div className="mt-2 space-y-1 text-xs">
          <div className="flex justify-between gap-2">
            <span className="truncate text-[color:var(--nezu)]">{user1Name}</span>
            <span className="st-num text-[color:var(--ink)]">{vn.user1_score.toFixed(1)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="truncate text-[color:var(--nezu)]">{user2Name}</span>
            <span className="st-num text-[color:var(--ink)]">{vn.user2_score.toFixed(1)}</span>
          </div>
        </div>
        {showDifference && (
          <div className="st-num mt-1 text-xs text-[color:var(--text-faint)]">
            {scoreDiff.toFixed(1)} point difference
          </div>
        )}
      </div>
    </Link>
  );
}
