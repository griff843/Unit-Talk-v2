import { PicksExplorerClient } from '@/components/PicksExplorerClient';
import { searchPicks } from '@/lib/data';

export const metadata = { title: 'Picks Explorer — Unit Talk Command Center' };

export default async function PicksPage() {
  const { picks } = await searchPicks({ limit: '250' });

  return <PicksExplorerClient picks={picks} observedAt={new Date().toISOString()} />;
}
