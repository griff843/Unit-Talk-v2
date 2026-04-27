import { Card, EmptyState } from '@/components/ui';
import { getResearchLines } from '@/lib/data';

interface LineShopperBook {
  bookmakerKey: string;
  line: number | null;
  overOdds: number | null;
  underOdds: number | null;
  isOpening: boolean;
  isClosing: boolean;
  snapshotAt: string;
}

interface LineShopperResponse {
  participant: string;
  market: string;
  books: LineShopperBook[];
  bestOver: string | null;
  bestUnder: string | null;
  observedAt: string;
}

async function fetchLineShopperData(
  participant: string,
  market: string,
): Promise<LineShopperResponse | null> {
  const result = await getResearchLines({ participant, market });
  if (!result) return null;

  const bookMap = new Map<string, LineShopperBook>();
  for (const offer of result.offers) {
    const key = String(offer['bookmaker_key'] ?? '');
    if (!key) continue;
    const existing = bookMap.get(key);
    const snapshotAt = String(offer['snapshot_at'] ?? '');
    if (!existing || snapshotAt > existing.snapshotAt) {
      bookMap.set(key, {
        bookmakerKey: key,
        line: typeof offer['line'] === 'number' ? offer['line'] : null,
        overOdds: typeof offer['over_odds'] === 'number' ? offer['over_odds'] : null,
        underOdds: typeof offer['under_odds'] === 'number' ? offer['under_odds'] : null,
        isOpening: offer['is_opening'] === true,
        isClosing: offer['is_closing'] === true,
        snapshotAt,
      });
    }
  }

  const books = Array.from(bookMap.values());
  let bestOver: string | null = null;
  let bestUnder: string | null = null;
  let bestOverOdds = -Infinity;
  let bestUnderOdds = -Infinity;
  for (const book of books) {
    if (book.overOdds != null && book.overOdds > bestOverOdds) {
      bestOverOdds = book.overOdds;
      bestOver = book.bookmakerKey;
    }
    if (book.underOdds != null && book.underOdds > bestUnderOdds) {
      bestUnderOdds = book.underOdds;
      bestUnder = book.bookmakerKey;
    }
  }

  return { participant, market, books, bestOver, bestUnder, observedAt: result.observedAt };
}

function formatOdds(value: number | null): string {
  if (value === null) return '—';
  return value > 0 ? `+${value}` : String(value);
}

function formatSnapshot(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function LineShopperPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const participant =
    typeof searchParams['participant'] === 'string' ? searchParams['participant'] : '';
  const market =
    typeof searchParams['market'] === 'string' ? searchParams['market'] : '';

  const canFetch = participant.length > 0 && market.length > 0;
  const data = canFetch ? await fetchLineShopperData(participant, market) : null;
  const fetchFailed = canFetch && data === null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Research</p>
        <h1 className="mt-1 text-xl font-bold text-white">Line-Shopper</h1>
        <p className="mt-1 text-sm text-gray-400">
          Compare lines across bookmakers for a player prop or game market.
        </p>
      </div>

      <form
        method="GET"
        className="flex flex-wrap items-end gap-3 rounded border border-gray-800 bg-gray-900/50 p-4"
      >
        <div className="flex flex-col gap-1">
          <label
            htmlFor="ls-participant"
            className="text-[10px] font-medium uppercase tracking-wide text-gray-500"
          >
            Participant ID
          </label>
          <input
            id="ls-participant"
            name="participant"
            defaultValue={participant}
            placeholder="e.g. BRAXTON_ASHCRAFT_1_MLB"
            className="w-64 rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="ls-market"
            className="text-[10px] font-medium uppercase tracking-wide text-gray-500"
          >
            Market Key
          </label>
          <input
            id="ls-market"
            name="market"
            defaultValue={market}
            placeholder="e.g. pitching-strikeouts-all-game-ou"
            className="w-64 rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <button
          type="submit"
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-gray-950"
        >
          Compare Lines
        </button>
      </form>

      {fetchFailed ? (
        <EmptyState
          message="Unable to load line data"
          detail="No matching offers found in provider_offers for this participant and market."
          action={{ label: 'Back to Research', href: '/research' }}
        />
      ) : !data ? (
        !canFetch ? (
          <div className="rounded border border-gray-800 bg-gray-900/50 p-6 text-center text-xs text-gray-500">
            Enter a participant ID and market key above to compare bookmaker lines.
          </div>
        ) : null
      ) : data.books.length === 0 ? (
        <EmptyState
          message="No offers found"
          detail={`No bookmaker lines found for participant "${data.participant}" on market "${data.market}".`}
          action={{ label: 'Back to Research', href: '/research' }}
        />
      ) : (
        <Card title={`Line Comparison — ${data.books.length} book${data.books.length === 1 ? '' : 's'}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800 text-left text-[10px] font-medium uppercase tracking-wide text-gray-500">
                  <th className="pb-2 pr-4">Bookmaker</th>
                  <th className="pb-2 pr-4">Line</th>
                  <th className="pb-2 pr-4">Over</th>
                  <th className="pb-2 pr-4">Under</th>
                  <th className="pb-2 pr-4">Opening</th>
                  <th className="pb-2 pr-4">Closing</th>
                  <th className="pb-2">Snapshot</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {data.books.map((book) => {
                  const isBestOver = book.bookmakerKey === data.bestOver;
                  const isBestUnder = book.bookmakerKey === data.bestUnder;
                  const isPinnacle = book.bookmakerKey === 'pinnacle';

                  return (
                    <tr key={book.bookmakerKey} className="align-middle">
                      <td className="py-2 pr-4">
                        <span
                          className={`font-medium ${isPinnacle ? 'text-blue-300' : 'text-gray-200'}`}
                        >
                          {book.bookmakerKey}
                          {isPinnacle && (
                            <span className="ml-1 text-[9px] uppercase tracking-wide text-blue-500">
                              sharp
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-gray-300">
                        {book.line ?? '—'}
                      </td>
                      <td className="py-2 pr-4">
                        <span
                          className={
                            isBestOver
                              ? 'font-semibold text-emerald-400'
                              : 'text-gray-300'
                          }
                        >
                          {formatOdds(book.overOdds)}
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        <span
                          className={
                            isBestUnder
                              ? 'font-semibold text-red-400'
                              : 'text-gray-300'
                          }
                        >
                          {formatOdds(book.underOdds)}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-gray-500">
                        {book.isOpening ? 'Yes' : '—'}
                      </td>
                      <td className="py-2 pr-4 text-gray-500">
                        {book.isClosing ? 'Yes' : '—'}
                      </td>
                      <td className="py-2 text-gray-500">
                        {formatSnapshot(book.snapshotAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {(data.bestOver || data.bestUnder) && (
            <div className="mt-4 flex flex-wrap gap-4 border-t border-gray-800 pt-3 text-[11px]">
              {data.bestOver && (
                <span className="text-gray-400">
                  Best over:{' '}
                  <span className="font-semibold text-emerald-400">{data.bestOver}</span>
                </span>
              )}
              {data.bestUnder && (
                <span className="text-gray-400">
                  Best under:{' '}
                  <span className="font-semibold text-red-400">{data.bestUnder}</span>
                </span>
              )}
              <span className="ml-auto text-gray-600">
                as of {formatSnapshot(data.observedAt)}
              </span>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
