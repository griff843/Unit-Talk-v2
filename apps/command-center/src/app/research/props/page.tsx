import { Card, EmptyState } from '@/components/ui';
import Link from 'next/link';
import { getPropOffers } from '@/lib/data';

function formatOdds(odds: number | null): string {
  if (odds === null) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

function formatBookmaker(key: string | null): string {
  if (!key) return '—';
  const labels: Record<string, string> = {
    pinnacle: 'Pinnacle',
    draftkings: 'DraftKings',
    fanduel: 'FanDuel',
    betmgm: 'BetMGM',
    caesars: 'Caesars',
    pointsbet: 'PointsBet',
  };
  return labels[key] ?? key;
}

function formatMarket(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const BOOKMAKER_OPTIONS = [
  { value: '', label: 'All Books' },
  { value: 'pinnacle', label: 'Pinnacle' },
  { value: 'draftkings', label: 'DraftKings' },
  { value: 'fanduel', label: 'FanDuel' },
  { value: 'betmgm', label: 'BetMGM' },
];

const SPORT_OPTIONS = [
  { value: '', label: 'All Sports' },
  { value: 'NBA', label: 'NBA' },
  { value: 'NFL', label: 'NFL' },
  { value: 'MLB', label: 'MLB' },
  { value: 'NHL', label: 'NHL' },
];

export default async function PropExplorerPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const sport = typeof searchParams['sport'] === 'string' ? searchParams['sport'] : undefined;
  const market = typeof searchParams['market'] === 'string' ? searchParams['market'] : undefined;
  const bookmaker = typeof searchParams['bookmaker'] === 'string' ? searchParams['bookmaker'] : undefined;
  const participant = typeof searchParams['participant'] === 'string' ? searchParams['participant'] : undefined;
  const since = typeof searchParams['since'] === 'string' ? searchParams['since'] : undefined;
  const rawOffset = typeof searchParams['offset'] === 'string' ? Number.parseInt(searchParams['offset'], 10) : 0;
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

  const hasFilters = Boolean(sport || market || bookmaker || participant || since);

  const data = hasFilters || offset > 0
    ? await getPropOffers({ sport, market, bookmaker, participant, since, offset })
    : null;

  const activeFilterCount = [sport, market, bookmaker, participant, since].filter(Boolean).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Research</p>
        <h1 className="mt-1 text-xl font-bold text-white">Props Explorer</h1>
        <p className="mt-1 text-sm text-gray-400">
          Browse live prop offers from ingested provider data. Source: <code className="text-gray-300">provider_offers</code>.
        </p>
      </div>

      {/* Filter form */}
      <form
        method="GET"
        className="flex flex-wrap items-end gap-3 rounded border border-gray-800 bg-gray-900/50 p-4"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="po-sport" className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
            Sport
          </label>
          <select
            id="po-sport"
            name="sport"
            defaultValue={sport ?? ''}
            className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {SPORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="po-bookmaker" className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
            Bookmaker
          </label>
          <select
            id="po-bookmaker"
            name="bookmaker"
            defaultValue={bookmaker ?? ''}
            className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {BOOKMAKER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="po-market" className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
            Market Key
          </label>
          <input
            id="po-market"
            name="market"
            defaultValue={market ?? ''}
            placeholder="e.g. player_points"
            className="w-44 rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="po-participant" className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
            Player / Participant
          </label>
          <input
            id="po-participant"
            name="participant"
            defaultValue={participant ?? ''}
            placeholder="Search participant ID..."
            className="w-48 rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="po-since" className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
            Since (UTC)
          </label>
          <input
            id="po-since"
            name="since"
            type="date"
            defaultValue={since?.slice(0, 10) ?? ''}
            className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-gray-950"
          >
            Search
          </button>
          <Link
            href="/research/props"
            className="rounded border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-gray-200"
          >
            Clear
          </Link>
        </div>
      </form>

      {/* Active filters */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span>Active filters ({activeFilterCount}):</span>
          {sport && (
            <span className="rounded border border-blue-700/30 bg-blue-900/30 px-2 py-0.5 text-blue-300">
              sport={sport}
            </span>
          )}
          {bookmaker && (
            <span className="rounded border border-blue-700/30 bg-blue-900/30 px-2 py-0.5 text-blue-300">
              book={bookmaker}
            </span>
          )}
          {market && (
            <span className="rounded border border-blue-700/30 bg-blue-900/30 px-2 py-0.5 text-blue-300">
              market={market}
            </span>
          )}
          {participant && (
            <span className="rounded border border-blue-700/30 bg-blue-900/30 px-2 py-0.5 text-blue-300">
              participant~{participant}
            </span>
          )}
          {since && (
            <span className="rounded border border-blue-700/30 bg-blue-900/30 px-2 py-0.5 text-blue-300">
              since={since.slice(0, 10)}
            </span>
          )}
        </div>
      )}

      {/* No-filter prompt */}
      {!hasFilters && offset === 0 && (
        <div className="rounded border border-gray-800 bg-gray-900/50 p-6 text-center">
          <p className="text-sm text-gray-400">Apply at least one filter to browse prop offers.</p>
          <p className="mt-1 text-xs text-gray-600">
            The <code className="text-gray-500">provider_offers</code> table has 300k+ rows — filters required to keep results useful.
          </p>
        </div>
      )}

      {/* Error state */}
      {hasFilters && !data && (
        <EmptyState
          message="Unable to load prop offers."
          detail="Prop offers could not be read from the database. Check Supabase connectivity."
          action={{ label: 'Back to Research', href: '/research' }}
        />
      )}

      {/* Empty results */}
      {data && data.offers.length === 0 && (
        <EmptyState
          message="No prop offers match your filters."
          detail="Try broadening the search — adjust sport, bookmaker, or date range."
          action={{ label: 'Clear Filters', href: '/research/props' }}
        />
      )}

      {/* Results table */}
      {data && data.offers.length > 0 && (
        <Card title={`Prop Offers — ${data.total.toLocaleString()} total`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                  <th className="py-2 pr-3">Participant</th>
                  <th className="py-2 pr-3">Market</th>
                  <th className="py-2 pr-3">Sport</th>
                  <th className="py-2 pr-3">Book</th>
                  <th className="py-2 pr-3 text-right">Line</th>
                  <th className="py-2 pr-3 text-right">Over</th>
                  <th className="py-2 pr-3 text-right">Under</th>
                  <th className="py-2 pr-3">Flags</th>
                  <th className="py-2 text-right">Snapshot</th>
                </tr>
              </thead>
              <tbody>
                {data.offers.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-gray-800 transition-colors hover:bg-gray-800/40"
                  >
                    <td className="py-2 pr-3 text-xs font-medium text-gray-200 font-mono">
                      {row.providerParticipantId ?? '—'}
                    </td>
                    <td className="py-2 pr-3 text-xs text-gray-300">
                      {formatMarket(row.providerMarketKey)}
                    </td>
                    <td className="py-2 pr-3 text-xs text-gray-400">{row.sportKey ?? '—'}</td>
                    <td className="py-2 pr-3 text-xs text-gray-300">
                      {formatBookmaker(row.bookmakerKey)}
                    </td>
                    <td className="py-2 pr-3 text-right text-xs font-mono text-gray-200">
                      {row.line ?? '—'}
                    </td>
                    <td className="py-2 pr-3 text-right text-xs font-mono text-emerald-400">
                      {formatOdds(row.overOdds)}
                    </td>
                    <td className="py-2 pr-3 text-right text-xs font-mono text-red-400">
                      {formatOdds(row.underOdds)}
                    </td>
                    <td className="py-2 pr-3 text-xs text-gray-500">
                      {row.isOpening && (
                        <span className="mr-1 rounded border border-yellow-700/40 bg-yellow-900/20 px-1 py-0.5 text-[9px] font-medium text-yellow-400">
                          O
                        </span>
                      )}
                      {row.isClosing && (
                        <span className="rounded border border-purple-700/40 bg-purple-900/20 px-1 py-0.5 text-[9px] font-medium text-purple-400">
                          C
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right text-[10px] text-gray-500">
                      {new Date(row.snapshotAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
            <span>
              Showing {offset + 1}–{offset + data.offers.length} of {data.total.toLocaleString()}
            </span>
            <div className="flex gap-2">
              {offset > 0 && (
                <Link
                  href={`/research/props?${new URLSearchParams({
                    ...(sport ? { sport } : {}),
                    ...(market ? { market } : {}),
                    ...(bookmaker ? { bookmaker } : {}),
                    ...(participant ? { participant } : {}),
                    ...(since ? { since } : {}),
                    offset: String(Math.max(0, offset - 50)),
                  }).toString()}`}
                  className="rounded border border-gray-700 px-2 py-1 transition-colors hover:bg-gray-800 hover:text-gray-200"
                >
                  ← Prev
                </Link>
              )}
              {data.hasMore && (
                <Link
                  href={`/research/props?${new URLSearchParams({
                    ...(sport ? { sport } : {}),
                    ...(market ? { market } : {}),
                    ...(bookmaker ? { bookmaker } : {}),
                    ...(participant ? { participant } : {}),
                    ...(since ? { since } : {}),
                    offset: String(offset + 50),
                  }).toString()}`}
                  className="rounded border border-gray-700 px-2 py-1 transition-colors hover:bg-gray-800 hover:text-gray-200"
                >
                  Next →
                </Link>
              )}
            </div>
          </div>

          <p className="mt-2 text-[10px] text-gray-600">
            Observed at {new Date(data.observedAt).toLocaleTimeString()}. O = opening line, C = closing line.
          </p>
        </Card>
      )}
    </div>
  );
}
