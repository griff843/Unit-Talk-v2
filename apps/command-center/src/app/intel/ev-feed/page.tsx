import {
  Card,
  EmptyState,
  InternalLabelBadge,
  Table,
  TableHead,
  TableBody,
  Th,
  Td,
  UncertifiedBanner,
} from '@/components/ui';
import { getCurrentOfferGroups, isStaleOdds, type IntelOfferGroup } from '@/lib/data/odds-intel';
import { formatRelativeTime } from '@/lib/data/research';
import { americanToDecimal, consensusFairProbability, evPercent, impliedProbability } from '@/lib/odds-math';
import { formatAmerican, formatPercent, formatProb, formatTimestamp } from '@/lib/intel-format';

export const dynamic = 'force-dynamic';

interface EvRow {
  eventName: string;
  market: string;
  selection: string;
  side: 'over' | 'under';
  book: string;
  odds: number;
  impliedProb: number;
  fairProb: number;
  evPct: number;
  booksInConsensus: number;
  snapshotAt: string;
}

/**
 * All EV rows derive transparently from live odds: per-group consensus fair
 * probability = average proportional de-vig across books quoting both sides
 * at the SAME line; EV% = (decimal * fairProb - 1) * 100.
 */
function computeEvRows(groups: IntelOfferGroup[]): EvRow[] {
  const out: EvRow[] = [];
  for (const g of groups) {
    // consensus must compare like-for-like: split the group by line
    const byLine = new Map<string, typeof g.books>();
    for (const b of g.books) {
      const k = b.line === null ? 'null' : String(b.line);
      const list = byLine.get(k);
      if (list) list.push(b);
      else byLine.set(k, [b]);
    }
    for (const books of byLine.values()) {
      const distinct = new Set(books.map((b) => b.bookmakerKey));
      if (distinct.size < 3) continue; // require >= 3 books in consensus
      const consensus = consensusFairProbability(
        books.map((b) => ({
          overOdds: b.overOdds ?? undefined,
          underOdds: b.underOdds ?? undefined,
        })),
      );
      if (!consensus || consensus.bookCount < 3) continue;
      const eventName = g.eventName ?? g.providerEventId;
      const line = books[0]!.line;
      const selection = `${g.providerParticipantId ?? '—'}${line !== null ? ` @ ${line}` : ''}`;
      for (const b of books) {
        for (const side of ['over', 'under'] as const) {
          const odds = side === 'over' ? b.overOdds : b.underOdds;
          if (odds === null || odds === 0) continue;
          const fairProb = side === 'over' ? consensus.overProb : consensus.underProb;
          if (!(fairProb > 0 && fairProb < 1)) continue;
          out.push({
            eventName,
            market: g.providerMarketKey,
            selection,
            side,
            book: b.bookmakerKey,
            odds,
            impliedProb: impliedProbability(odds),
            fairProb,
            evPct: evPercent(americanToDecimal(odds), fairProb),
            booksInConsensus: consensus.bookCount,
            snapshotAt: b.snapshotAt,
          });
        }
      }
    }
  }
  return out.sort((a, b) => b.evPct - a.evPct);
}

export default async function EvFeedPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const thresholdRaw = typeof searchParams['threshold'] === 'string' ? searchParams['threshold'] : '0';
  const threshold = Number.isFinite(Number(thresholdRaw)) ? Number(thresholdRaw) : 0;
  const sport = typeof searchParams['sport'] === 'string' ? searchParams['sport'] : undefined;

  let rows: EvRow[] = [];
  let fetchError: string | null = null;
  let observedAt: string | null = null;
  let rowCap = 0;

  try {
    const result = await getCurrentOfferGroups({ sport, minBooks: 3, limit: 500 });
    if (!result) {
      fetchError = 'Failed to load offers from provider_offer_current.';
    } else {
      observedAt = result.observedAt;
      rowCap = result.rowCap;
      rows = computeEvRows(result.groups).filter((r) => r.evPct >= threshold);
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Unknown error loading EV feed.';
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="cc-text-muted text-xs font-medium uppercase tracking-widest">Intelligence</p>
        <h1 className="mt-1 text-xl font-bold text-white">EV Feed</h1>
        <p className="cc-text-secondary mt-1 text-sm">
          Per-book EV against consensus fair probability (proportional de-vig, ≥3 books, same line).
          Scan capped at {rowCap || 500} most-recent offer rows.
        </p>
      </div>

      <UncertifiedBanner what="Internal Model EV (consensus de-vig)" />

      <form method="GET" className="cc-surface flex flex-wrap items-end gap-3 p-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="threshold" className="cc-text-muted text-[10px] font-medium uppercase tracking-wide">
            Min EV %
          </label>
          <input
            id="threshold"
            name="threshold"
            defaultValue={thresholdRaw}
            className="w-32 rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="sport" className="cc-text-muted text-[10px] font-medium uppercase tracking-wide">
            Sport Key
          </label>
          <input
            id="sport"
            name="sport"
            defaultValue={sport ?? ''}
            placeholder="e.g. baseball"
            className="w-40 rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200"
          />
        </div>
        <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
          Apply
        </button>
      </form>

      {fetchError ? (
        <Card title="Error">
          <p className="text-xs text-red-400">{fetchError}</p>
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          message="No offers meet the EV threshold"
          detail={`No offer groups with ≥3 books at the same line yielded EV ≥ ${threshold}% in the scanned window.`}
        />
      ) : (
        <Card title={`EV Opportunities — ${rows.length} rows`}>
          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <Th>Event</Th>
                <Th>Market</Th>
                <Th>Selection / Side</Th>
                <Th>Book</Th>
                <Th>Odds</Th>
                <Th>Implied</Th>
                <Th>Fair</Th>
                <Th>EV %</Th>
                <Th>Books</Th>
                <Th>Updated</Th>
                <Th>Flags</Th>
              </TableHead>
              <TableBody>
                {rows.slice(0, 200).map((r, i) => (
                  <tr key={i} className="border-b border-gray-800/50">
                    <Td>{r.eventName}</Td>
                    <Td>{r.market}</Td>
                    <Td>
                      {r.selection} <span className="uppercase text-gray-500">{r.side}</span>
                    </Td>
                    <Td>{r.book}</Td>
                    <Td>{formatAmerican(r.odds)}</Td>
                    <Td>{formatProb(r.impliedProb)}</Td>
                    <Td>{formatProb(r.fairProb)}</Td>
                    <Td>
                      <span className={r.evPct > 0 ? 'font-semibold text-emerald-400' : 'text-gray-400'}>
                        {formatPercent(r.evPct)}
                      </span>
                    </Td>
                    <Td>{r.booksInConsensus}</Td>
                    <Td>
                      {formatTimestamp(r.snapshotAt)}{' '}
                      <span className="text-gray-500">({formatRelativeTime(r.snapshotAt)})</span>
                    </Td>
                    <Td>
                      <span className="flex gap-1">
                        {isStaleOdds(r.snapshotAt) && <InternalLabelBadge label="Stale Odds" />}
                        {r.booksInConsensus < 4 && <InternalLabelBadge label="Needs Review" />}
                      </span>
                    </Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="cc-text-muted mt-3 text-[11px]">
            Consensus with fewer than 4 books is small-sample — treat EV as directional only
            (flagged Needs Review). Observed {formatTimestamp(observedAt)}. Display capped at 200 rows.
          </p>
        </Card>
      )}
    </div>
  );
}
