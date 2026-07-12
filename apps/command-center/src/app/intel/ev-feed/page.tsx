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

export const metadata = { title: 'EV Feed — Unit Talk Command Center' };

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
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await searchParamsPromise;
  const thresholdRaw = typeof searchParams['threshold'] === 'string' ? searchParams['threshold'] : '0';
  const threshold = Number.isFinite(Number(thresholdRaw)) ? Number(thresholdRaw) : 0;
  const sport = typeof searchParams['sport'] === 'string' ? searchParams['sport'] : undefined;

  let rows: EvRow[] = [];
  let nearMisses: EvRow[] = [];
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
      const allRows = computeEvRows(result.groups);
      rows = allRows.filter((r) => r.evPct >= threshold);
      if (rows.length === 0) {
        // Dead air is never acceptable: with no above-threshold hits, surface
        // the scanned window's best near-misses, explicitly marked below threshold.
        nearMisses = allRows.filter((r) => r.evPct < threshold).slice(0, 25);
      }
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Unknown error loading EV feed.';
  }

  const displayRows = rows.length > 0 ? rows : nearMisses;
  const showingNearMisses = rows.length === 0 && nearMisses.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
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
      ) : displayRows.length === 0 ? (
        <EmptyState
          message="No consensus groups in the scanned window"
          detail={`No offer groups with ≥3 books at the same line were found in the ${rowCap}-row scan — near-misses would be listed here if any existed. Check ingestion freshness if this persists.`}
        />
      ) : (
        <Card
          title={
            showingNearMisses
              ? `Near Misses — best ${displayRows.length} below the ${threshold}% threshold`
              : `EV Opportunities — ${displayRows.length} rows`
          }
        >
          {showingNearMisses && (
            <div className="mb-3 rounded border border-amber-700/40 bg-amber-900/15 px-3 py-2 text-[11px] text-amber-300">
              No offers met EV ≥ {threshold}% in the scanned window. Showing the closest
              candidates instead — every row below is <span className="font-semibold">below threshold</span>.
            </div>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <Th>Event</Th>
                <Th>Market</Th>
                <Th>Selection / Side</Th>
                <Th>Book</Th>
                <Th align="right">Odds</Th>
                <Th align="right">Implied</Th>
                <Th align="right">Fair</Th>
                <Th align="right">EV %</Th>
                <Th align="right">Books</Th>
                <Th>Updated</Th>
                <Th>Flags</Th>
              </TableHead>
              <TableBody>
                {displayRows.slice(0, 200).map((r, i) => (
                  <tr key={i} className="border-b border-gray-800/50">
                    <Td>{r.eventName}</Td>
                    <Td>{r.market}</Td>
                    <Td>
                      {r.selection} <span className="uppercase text-gray-500">{r.side}</span>
                    </Td>
                    <Td>{r.book}</Td>
                    <Td num align="right">{formatAmerican(r.odds)}</Td>
                    <Td num align="right">{formatProb(r.impliedProb)}</Td>
                    <Td num align="right">{formatProb(r.fairProb)}</Td>
                    <Td num align="right">
                      <span className={r.evPct > 0 ? 'cc-num-pos font-semibold' : 'cc-num-neutral'}>
                        {formatPercent(r.evPct)}
                      </span>
                    </Td>
                    <Td num align="right">{r.booksInConsensus}</Td>
                    <Td>
                      {formatTimestamp(r.snapshotAt)}{' '}
                      <span className="text-gray-500">({formatRelativeTime(r.snapshotAt)})</span>
                    </Td>
                    <Td>
                      <span className="flex gap-1">
                        {showingNearMisses && (
                          <span className="rounded border border-amber-700/40 bg-amber-900/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-400">
                            Below Threshold
                          </span>
                        )}
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
