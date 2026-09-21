import { PicksExplorerClient } from '@/components/PicksExplorerClient';
import { DegradedState } from '@/components/ui';
import { searchPicks } from '@/lib/data';
import { describeOperatorFailure } from '@/lib/describe-error';
import Link from '@/components/OperatorLink';
import { PICK_PAGE_SIZES, PICK_STATUS_OPTIONS, readPicksExplorerQuery, picksExplorerHref } from '@/lib/picks-explorer-query';

export const metadata = { title: 'Picks Explorer — Unit Talk Command Center' };

export default async function PicksPage({
  searchParams: searchParamsPromise,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const searchParams = await searchParamsPromise;
  const query = readPicksExplorerQuery(searchParams);
  const fixtureMode = query.fixtures;
  const offset = (query.page - 1) * query.limit;
  try {
    const { picks, total } = await searchPicks({
      q: query.q, status: query.status, limit: String(query.limit), offset: String(offset),
      ...(fixtureMode ? { population: 'fixtures' } : {}),
    });

    const pagination = (
      <nav aria-label="Pick pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span>Page {query.page} · {Math.max(1, Math.ceil(total / query.limit))} pages</span>
        <div className="flex gap-4">
          {query.page > 1 ? <Link href={picksExplorerHref(query, query.page - 1)} className="text-blue-200 underline">Previous page</Link> : null}
          {offset + picks.length < total && picks.length > 0 ? <Link href={picksExplorerHref(query, query.page + 1)} className="text-blue-200 underline">Next page</Link> : null}
          {offset >= total && query.page > 1 ? <Link href={picksExplorerHref(query, 1)} className="text-blue-200 underline">First page</Link> : null}
        </div>
      </nav>
    );
    const filters = (
      <form action="/picks" method="get" key={`${query.q}:${query.status}:${query.limit}`} className="flex flex-wrap items-end gap-3">
        {fixtureMode ? <input type="hidden" name="population" value="fixtures" /> : null}
        <label className="flex w-full flex-col gap-1 text-sm sm:w-auto sm:min-w-[220px] sm:flex-1">Search picks
          <input name="q" defaultValue={query.q} maxLength={200} placeholder="Selection, market or source" className="cc-input min-w-0" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Lifecycle status
          <select name="status" defaultValue={query.status} className="cc-select">
            <option value="">All statuses</option>
            {PICK_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">Picks per page
          <select name="limit" defaultValue={query.limit} className="cc-select">
            {PICK_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">Apply filters</button>
        <Link href={fixtureMode ? '/picks?population=fixtures' : '/picks'} className="py-2 text-sm text-blue-200 underline">Clear filters</Link>
      </form>
    );

    if (fixtureMode) {
      return (
        <section className="flex flex-col gap-4">
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
            <p className="font-semibold">Fixture corpus — test and historical data</p>
            <p className="mt-1">These rows are intentionally excluded from the governed operator pick explorer and all governed performance figures.</p>
            <Link href="/picks" className="mt-3 inline-block font-medium text-blue-200 underline">Return to governed picks</Link>
          </div>
          {filters}
          {pagination}
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
        {filters}
        {pagination}
        <PicksExplorerClient picks={picks} sourceTotal={total} offset={offset} observedAt={new Date().toISOString()} />
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
