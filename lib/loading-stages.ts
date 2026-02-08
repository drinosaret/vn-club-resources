/**
 * Loading stage definitions for stats and recommendations pages.
 * These provide user-visible progress feedback during long-running operations.
 */

export interface LoadingStageDefinition {
  id: string;
  name: string;
  description: string;
}

/**
 * Stages for loading user stats.
 * The backend handles most computation, but we show stages to provide feedback.
 */
export const STATS_LOADING_STAGES: LoadingStageDefinition[] = [
  {
    id: 'connecting',
    name: 'Connecting',
    description: 'Checking backend availability',
  },
  {
    id: 'fetching-stats',
    name: 'Fetching Stats',
    description: 'Loading user statistics from database',
  },
  {
    id: 'analyzing-tags',
    name: 'Analyzing Tags',
    description: 'Processing tag preferences and analytics',
  },
  {
    id: 'finalizing',
    name: 'Finalizing',
    description: 'Preparing data for display',
  },
];

/**
 * Stages for loading recommendations.
 * These can take 20-45 seconds for complex methods.
 */
export const RECOMMENDATIONS_LOADING_STAGES: LoadingStageDefinition[] = [
  {
    id: 'connecting',
    name: 'Connecting',
    description: 'Checking backend availability',
  },
  {
    id: 'loading-profile',
    name: 'Loading Profile',
    description: 'Fetching user preferences',
  },
  {
    id: 'analyzing-tastes',
    name: 'Analyzing Tastes',
    description: 'Processing tag and trait affinities',
  },
  {
    id: 'finding-matches',
    name: 'Finding Matches',
    description: 'Searching for compatible visual novels',
  },
  {
    id: 'ranking-results',
    name: 'Ranking Results',
    description: 'Scoring and sorting recommendations',
  },
  {
    id: 'loading-details',
    name: 'Loading Details',
    description: 'Fetching VN metadata and images',
  },
];

/**
 * Stages for comparing users.
 */
export const COMPARE_LOADING_STAGES: LoadingStageDefinition[] = [
  {
    id: 'connecting',
    name: 'Connecting',
    description: 'Checking backend availability',
  },
  {
    id: 'loading-users',
    name: 'Loading Users',
    description: 'Fetching user profiles',
  },
  {
    id: 'comparing-lists',
    name: 'Comparing Lists',
    description: 'Analyzing shared visual novels',
  },
  {
    id: 'calculating-compatibility',
    name: 'Calculating Compatibility',
    description: 'Computing similarity scores',
  },
  {
    id: 'finalizing',
    name: 'Finalizing',
    description: 'Preparing comparison results',
  },
];
