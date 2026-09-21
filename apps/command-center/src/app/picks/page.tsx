import { PicksExplorerClient } from '@/components/PicksExplorerClient';
import { DegradedState } from '@/components/ui';
import { searchPicks } from '@/lib/data';
import { describeOperatorFailure } from '@/lib/describe-error';
import Link from '@/components/OperatorLink';

export const metadata = { title: 'Picks Explorer — Unit Talk Command Center' };

export default async function PicksPage({
  searchParams: searchParamsPromise,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const searchParams = await searchParamsPromise;
  const fixtureMode = searchParams?.population === 'fixtures';
  try {
    const { picks, total } = await searchPicks({
      limit: '200',
      ...(fixtureMode ? { population: 'fixtures' } : {}),
    });

    if (fixtureMode) {
      return (
        <section className="flex flex-col gap-4">
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
            <p className="font-semibold">Fixture corpus — test and historical data</p>
            <p className="mt-1">These rows are intentionally excluded from the governed operator pick explorer and all governed performance figures.</p>
            <Link href="/picks" className="mt-3 inline-block font-medium text-blue-200 underline">Return to governed picks</Link>
          </div>
          <div className="cc-surface divide-y divide-gray-800">
            <div className="px-4 py-3 text-sm text-gray-400">{total} fixture rows · never operator picks</div>
            {picks.map((pick, index) => (
              <div key={String(pick['id'] ?? index)} className="flex items-center gap-3 px-4 py-3 text-sm text-gray-300">
                <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-200">Fixture</span>
                <span>{typeof pick['selection'] === 'string' ? pick['selection'] : 'Unnamed fixture'}</span>
                <span className="font-mono text-xs text-gray-500">{String(pick['id'] ?? '—').slice(0, 8)}</span>
              </div>
            ))}
          </div>
        </section>
      );
    }

    return (
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900/50 px-4 py-3 text-sm text-gray-400">
          <span>Showing governed picks only.</span>
          <Link href="/picks?population=fixtures" className="text-amber-200 underline">View fixture corpus (test data)</Link>
        </div>
        <PicksExplorerClient picks={picks} sourceTotal={total} observedAt={new Date().toISOString()} />
      </section>
    );
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
