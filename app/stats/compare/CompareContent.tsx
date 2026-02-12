'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Users, Heart, AlertTriangle,
  TrendingUp, BookOpen, Star, Tag, Target, Activity, Info, UserCheck
} from 'lucide-react';
import {
  vndbStatsApi,
  UserComparisonResponse,
  SharedVNScore,
  SimilarUser,
} from '@/lib/vndb-stats-api';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { useDisplayTitle } from '@/lib/title-preference';
import { StatsSummaryCard } from '@/components/stats/StatsSummaryCard';
import { FadeIn } from '@/components/FadeIn';

type Mode = 'compare' | 'similar';

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
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            {mode === 'similar' ? 'Find Similar Users' : 'Compare Lists'}
            <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
              BETA
            </span>
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {mode === 'similar'
              ? 'Find users with similar VN taste'
              : 'See how your VN taste matches with another user'}
          </p>
        </div>
      </div>

      {/* Mode Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => handleModeChange('compare')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            mode === 'compare'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          <Users className="w-4 h-4" />
          Compare Two Users
        </button>
        <button
          onClick={() => handleModeChange('similar')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            mode === 'similar'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          <UserCheck className="w-4 h-4" />
          Find Similar Users
        </button>
      </div>

      {/* Input Form */}
      {mode === 'similar' ? (
        <form onSubmit={handleFindSimilar} className="mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
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
                  className="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                {isLookingUp1 && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>
              {user1 && (
                <span className="flex items-center px-3 py-2 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg text-sm font-medium">
                  {user1.username}
                </span>
              )}
            </div>

            {(error || lookupError) && (
              <p className="mt-4 text-red-500 dark:text-red-400 text-sm">{error || lookupError}</p>
            )}

            <button
              type="submit"
              disabled={!user1 || isLoading}
              className="mt-6 w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <UserCheck className="w-5 h-5" />
                  Find Similar Users
                </>
              )}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleCompare} className="mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* User 1 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
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
                      className="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    {isLookingUp1 && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                  {user1 && (
                    <span className="flex items-center px-3 py-2 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg text-sm font-medium">
                      {user1.username}
                    </span>
                  )}
                </div>
              </div>

              {/* User 2 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
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
                      className="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    {isLookingUp2 && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                  {user2 && (
                    <span className="flex items-center px-3 py-2 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg text-sm font-medium">
                      {user2.username}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {(error || lookupError) && (
              <p className="mt-4 text-red-500 dark:text-red-400 text-sm">{error || lookupError}</p>
            )}

            <button
              type="submit"
              disabled={!user1 || !user2 || isLoading}
              className="mt-6 w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Users className="w-5 h-5" />
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
      <div className="bg-white dark:bg-gray-800 rounded-xl p-8 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none text-center">
        <UserCheck className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          No Similar Users Found
        </h3>
        <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto">
          No users with enough shared rated VNs were found.
          Try a user with more rated VNs for better results.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Found {similarUsers.length} users with similar taste to {currentUsername}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {similarUsers.map((user) => (
          <SimilarUserCard key={user.uid} user={user} currentUid={currentUid} onCompare={() => onCompare(user)} />
        ))}
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
        Similarity is calculated based on shared VNs, rating patterns, and tag preferences.
      </p>
    </div>
  );
}

function SimilarUserCard({ user, currentUid, onCompare }: { user: SimilarUser; currentUid: string; onCompare: () => void }) {
  const compatibilityPercent = Math.round(user.compatibility * 100);
  const compatibilityColor =
    compatibilityPercent >= 60 ? 'text-green-600 dark:text-green-400' :
    compatibilityPercent >= 35 ? 'text-yellow-600 dark:text-yellow-400' :
    'text-red-600 dark:text-red-400';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none hover:shadow-lg hover:shadow-gray-300/50 dark:hover:shadow-none hover:-translate-y-0.5 transition-all duration-200">
      <div className="flex items-start justify-between mb-3">
        <div>
          <Link
            href={`/stats/${user.uid}?username=${encodeURIComponent(user.username)}`}
            className="font-medium text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400"
          >
            {user.username}
          </Link>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {user.total_vns} VNs
            {user.avg_score && ` · ${user.avg_score.toFixed(1)} avg`}
          </div>
        </div>
        <div className={`text-2xl font-bold ${compatibilityColor}`}>
          {compatibilityPercent}%
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-3">
        <BookOpen className="w-4 h-4" />
        <span>{user.shared_vns} shared VNs</span>
      </div>

      {/* Compatibility bar */}
      <div className="h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden mb-3">
        <div
          className={`h-full transition-all duration-300 ${
            compatibilityPercent >= 60 ? 'bg-green-500' :
            compatibilityPercent >= 35 ? 'bg-yellow-500' :
            'bg-red-500'
          }`}
          style={{ width: `${compatibilityPercent}%` }}
        />
      </div>

      <button
        onClick={onCompare}
        className="inline-flex items-center gap-1.5 text-sm text-primary-600 dark:text-primary-400 hover:underline"
      >
        <Users className="w-3.5 h-3.5" />
        Compare lists
      </button>
    </div>
  );
}

function ComparisonResults({ comparison }: { comparison: UserComparisonResponse }) {
  const compatibilityPercent = Math.round(comparison.compatibility_score * 100);

  return (
    <div className="space-y-6">
      {/* Compatibility Header */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none text-center">
        <div className="text-6xl font-bold mb-2">
          <span className={
            compatibilityPercent >= 60 ? 'text-green-600 dark:text-green-400' :
            compatibilityPercent >= 35 ? 'text-yellow-600 dark:text-yellow-400' :
            'text-red-600 dark:text-red-400'
          }>
            {compatibilityPercent}%
          </span>
        </div>
        <p className="text-gray-600 dark:text-gray-400">
          Compatibility between{' '}
          <span className="font-semibold text-gray-900 dark:text-white">{comparison.user1.username}</span>
          {' '}and{' '}
          <span className="font-semibold text-gray-900 dark:text-white">{comparison.user2.username}</span>
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatsSummaryCard
          icon={<Heart className="w-5 h-5" />}
          label="Compatibility"
          value={`${compatibilityPercent}%`}
          subtext={compatibilityPercent >= 60 ? 'Great match!' : compatibilityPercent >= 35 ? 'Some overlap' : 'Different tastes'}
          tooltip="Weighted combination of list overlap, rating similarity, and tag preferences. With more shared VNs, rating correlation matters more. With fewer shared VNs, tag similarity is weighted higher."
        />
        <StatsSummaryCard
          icon={<BookOpen className="w-5 h-5" />}
          label="Shared VNs"
          value={comparison.shared_vns.toString()}
          subtext="rated by both"
          tooltip="Visual novels that both users have rated. Only VNs with scores from both users are counted."
        />
        <StatsSummaryCard
          icon={<Target className="w-5 h-5" />}
          label="Confidence"
          value={comparison.confidence != null ? `${Math.round(comparison.confidence * 100)}%` : 'N/A'}
          subtext={comparison.confidence != null ? (comparison.confidence >= 0.7 ? 'High reliability' : comparison.confidence >= 0.3 ? 'Moderate data' : 'Limited data') : 'calculating...'}
          tooltip="How reliable is this comparison? Based on number of shared rated VNs. Formula: min(shared_rated / 20, 100%). More shared ratings = higher confidence in the comparison."
        />
        <StatsSummaryCard
          icon={<Star className="w-5 h-5" />}
          label="Shared Favorites"
          value={comparison.shared_favorites.length.toString()}
          subtext="both love"
          tooltip="VNs that both users rated 8/10 or higher. These are titles you both really enjoyed!"
        />
      </div>

      {/* Enhanced Metrics Breakdown */}
      {(comparison.tag_similarity != null || comparison.jaccard_similarity != null) && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-5 h-5 text-primary-500" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Compatibility Breakdown
            </h3>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Individual metrics that make up the compatibility score. Hover over the <Info className="w-3 h-3 inline" /> icons for calculation details.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {comparison.jaccard_similarity != null && (
              <MetricBar
                label="List Overlap"
                value={comparison.jaccard_similarity}
                description="VNs in common"
                tooltip="Jaccard similarity: (shared VNs) / (total unique VNs between both users). Higher = more overlap in what you've read."
                showRawCount={comparison.shared_vns}
              />
            )}
            {comparison.rating_agreement != null && (
              <MetricBar
                label="Rating Agreement"
                value={comparison.rating_agreement}
                description="Score closeness on shared VNs"
                tooltip="How closely you rate shared VNs. 100% = identical scores, 0% = average 5+ point difference on a 10-point scale."
              />
            )}
            {comparison.tag_similarity != null && (
              <MetricBar
                label="Tag Preferences"
                value={comparison.tag_similarity}
                description="Similar tastes in genres"
                tooltip="Cosine similarity of tag preference vectors. Compares which genres/tags you rate highly, weighted by how many VNs you've read with each tag."
              />
            )}
            <MetricBar
              label="Score Correlation"
              value={Math.max(0, (comparison.score_correlation + 1) / 2)}
              description="Rating agreement"
              tooltip="Pearson correlation of scores on shared VNs, normalized to 0-100%. Measures if you rate the SAME VNs similarly. Requires shared rated VNs to be meaningful."
            />
          </div>
        </div>
      )}

      {/* Common Tags */}
      {comparison.common_tags && comparison.common_tags.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
          <div className="flex items-center gap-2 mb-2">
            <Tag className="w-5 h-5 text-green-500" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Shared Favorites Tags
            </h3>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Tags you both rate highly
          </p>
          <div className="flex flex-wrap gap-2">
            {comparison.common_tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-3 py-1.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-sm font-medium"
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
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-5 h-5 text-purple-500" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Differing Tastes
            </h3>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Tags where your ratings differ significantly
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {comparison.differing_tastes.user1_prefers?.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {comparison.user1.username} prefers:
                </h4>
                <div className="flex flex-wrap gap-2">
                  {comparison.differing_tastes.user1_prefers.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center px-3 py-1.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-sm"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {comparison.differing_tastes.user2_prefers?.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {comparison.user2.username} prefers:
                </h4>
                <div className="flex flex-wrap gap-2">
                  {comparison.differing_tastes.user2_prefers.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center px-3 py-1.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 text-sm"
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
          icon={<Heart className="w-5 h-5 text-pink-500" />}
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
          icon={<AlertTriangle className="w-5 h-5 text-orange-500" />}
          vns={comparison.biggest_disagreements}
          user1Name={comparison.user1.username}
          user2Name={comparison.user2.username}
          showDifference
        />
      )}

      {/* No shared VNs message */}
      {comparison.shared_vns === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-8 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none text-center">
          <BookOpen className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No Shared VNs
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
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
  icon: React.ReactNode;
  vns: SharedVNScore[];
  user1Name: string;
  user2Name: string;
  showDifference?: boolean;
}

function SharedVNsSection({
  title,
  subtitle,
  icon,
  vns,
  user1Name,
  user2Name,
  showDifference = false,
}: SharedVNsSectionProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {title}
        </h3>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{subtitle}</p>

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
      className="flex gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg shadow-sm hover:shadow-md hover:shadow-gray-200/40 dark:hover:shadow-none hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200 group"
    >
      {/* Image */}
      <div className="w-16 h-20 flex-shrink-0 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
        {vn.image_url ? (
          <img
            src={getProxiedImageUrl(vn.image_url, { vnId: vn.vn_id }) ?? undefined}
            alt={displayTitle}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <BookOpen className="w-6 h-6" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-medium text-sm text-gray-900 dark:text-white line-clamp-2 group-hover:text-primary-600 dark:group-hover:text-primary-400">
          {displayTitle}
        </h4>
        <div className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400 truncate">{user1Name}:</span>
            <span className="font-medium text-gray-900 dark:text-white ml-2">
              {vn.user1_score.toFixed(1)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400 truncate">{user2Name}:</span>
            <span className="font-medium text-gray-900 dark:text-white ml-2">
              {vn.user2_score.toFixed(1)}
            </span>
          </div>
        </div>
        {showDifference && (
          <div className="mt-1 text-xs text-orange-600 dark:text-orange-400 font-medium">
            {scoreDiff.toFixed(1)} point difference
          </div>
        )}
        <div className="mt-1 flex items-center gap-1 text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
          <TrendingUp className="w-3 h-3" />
          View stats
        </div>
      </div>
    </Link>
  );
}

function MetricBar({
  label,
  value,
  description,
  tooltip,
  showRawCount,
}: {
  label: string;
  value: number;
  description: string;
  tooltip?: string;
  showRawCount?: number;
}) {
  const percent = Math.round(value * 100);
  const displayPercent = value > 0 && percent === 0 ? '< 1' : percent.toString();
  const barWidth = value > 0 && percent === 0 ? 1 : percent;
  const barColor = percent >= 60 ? 'bg-green-500' : percent >= 35 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div className="group relative">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1">
          {label}
          {tooltip && (
            <span className="cursor-help text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" title={tooltip}>
              <Info className="w-3.5 h-3.5" />
            </span>
          )}
        </span>
        <span className="text-sm font-bold text-gray-900 dark:text-white">
          {displayPercent}%
          {showRawCount !== undefined && <span className="font-normal text-gray-500 ml-1">({showRawCount})</span>}
        </span>
      </div>
      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-300`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{description}</p>
    </div>
  );
}
