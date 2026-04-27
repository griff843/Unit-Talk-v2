import { Card, EmptyState } from '@/components/ui';
import Link from 'next/link';
import { getResearchPlayers } from '@/lib/data';

export default async function PlayerCardPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const tab = searchParams['tab'] === 'team' ? 'team' : 'player';
  const sport = typeof searchParams['sport'] === 'string' ? searchParams['sport'] : undefined;
  const q = typeof searchParams['q'] === 'string' ? searchParams['q'] : undefined;

  const data = await getResearchPlayers({ type: tab, sport, q });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Research</p>
        <h1 className="mt-1 text-xl font-bold text-white">Player Card</h1>
        <p className="mt-1 text-sm text-gray-400">
          Browse players and teams from the participants index.
        </p>
      </div>

      {/* Tab toggle */}
      <div className="flex items-center gap-2">
        {(['player', 'team'] as const).map((t) => (
          <Link
            key={t}
            href={`/research/players?tab=${t}${sport ? `&sport=${encodeURIComponent(sport)}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              t === tab
                ? 'bg-blue-600 text-white'
                : 'border border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-gray-200'
            }`}
          >
            {t === 'player' ? 'Players' : 'Teams'}
          </Link>
        ))}
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3 rounded border border-gray-800 bg-gray-900/50 p-4">
        <input type="hidden" name="tab" value={tab} />
        <div className="flex flex-col gap-1">
          <label htmlFor="participant-query" className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
            Search
          </label>
          <input
            id="participant-query"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Player or team name..."
            className="w-56 rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="participant-sport" className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
            Sport
          </label>
          <input
            id="participant-sport"
            name="sport"
            defaultValue={sport ?? ''}
            placeholder="e.g. nba..."
            className="w-32 rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-gray-950"
          >
            Apply Filters
          </button>
          <Link
            href={`/research/players?tab=${tab}`}
            className="rounded border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-gray-200"
          >
            Clear
          </Link>
        </div>
      </form>

      {(q || sport) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span>Active filters:</span>
          {q && (
            <span className="rounded border border-blue-700/30 bg-blue-900/30 px-2 py-0.5 text-blue-300">
              q={q}
            </span>
          )}
          {sport && (
            <span className="rounded border border-blue-700/30 bg-blue-900/30 px-2 py-0.5 text-blue-300">
              sport={sport}
            </span>
          )}
        </div>
      )}

      {!data ? (
        <EmptyState
          message="Unable to load participants data."
          detail="The participants table may be empty or unavailable."
          action={{ label: 'Back to Research', href: '/research' }}
        />
      ) : data.participants.length === 0 ? (
        <EmptyState
          message={`No ${tab}s found`}
          detail={
            q || sport
              ? `No results match the current filters. Try broadening your search.`
              : `The participants index has no ${tab} records yet. Data is populated by the ingestor from provider feeds.`
          }
          action={{ label: 'Back to Research', href: '/research' }}
        />
      ) : (
        <Card title={`${tab === 'player' ? 'Players' : 'Teams'} (${data.total} total)`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-xs uppercase text-gray-400">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Sport</th>
                  <th className="py-2">ID</th>
                </tr>
              </thead>
              <tbody>
                {data.participants.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors"
                  >
                    <td className="py-2 pr-3 text-xs font-medium text-gray-200">{p.displayName ?? '—'}</td>
                    <td className="py-2 pr-3 text-xs text-gray-300">{p.sport ?? '—'}</td>
                    <td className="py-2 text-xs text-gray-500 font-mono">{p.id.slice(0, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
