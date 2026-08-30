import { PicksExplorerClient } from '@/components/PicksExplorerClient';
import { DegradedState } from '@/components/ui';
import { searchPicks } from '@/lib/data';
import { describeOperatorFailure } from '@/lib/describe-error';

export const metadata = { title: 'Picks Explorer — Unit Talk Command Center' };

export default async function PicksPage() {
  try {
    const { picks, total } = await searchPicks({ limit: '200' });

    return <PicksExplorerClient picks={picks} sourceTotal={total} observedAt={new Date().toISOString()} />;
  } catch (error) {
    return (
      <DegradedState
        severity="critical"
        title="Active picks unavailable"
        causes={[describeOperatorFailure(error, 'Canonical pick state could not be loaded.')]}
        action={{ label: 'System Health', href: '/api-health' }}
      />
    );
  }
}
