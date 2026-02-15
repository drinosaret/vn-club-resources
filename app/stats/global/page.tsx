import GlobalStatsClient from './GlobalStatsClient';

export const metadata = {
  title: 'Global Statistics',
  description:
    'Explore global visual novel statistics from VNDB — top rated VNs, score distributions, release trends, and more.',
};

export default function GlobalStatsPage() {
  return <GlobalStatsClient />;
}
