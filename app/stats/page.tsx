import StatsPageClient from './StatsPageClient';

export const metadata = {
  title: 'VNDB Stats',
  description:
    'Look up any VNDB user to see their visual novel reading statistics, score distributions, and reading history.',
};

export default function StatsPage() {
  return <StatsPageClient />;
}
