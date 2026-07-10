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
import {
  getCurrentOfferGroups,
  getDistinctBookmakers,
  isStaleOdds,
  type IntelOfferGroup,
} from '@/lib/data/odds-intel';
import { formatRelativeTime } from '@/lib/data/research';
import { consensusFairProbability, devigTwoWay, impliedProbability } from '@/lib/odds-math';
import { formatAmerican, formatProb, formatTimestamp } from '@/lib/intel-format';

export const metadata = { title: 'Sharp Book Compare — Unit Talk Command Center' };

export const dynamic = 'force-dynamic';

/** Book keys treated as sharp when present in the live data, in priority order. */
const SHARP_CANDIDATES = ['pinnacle', 'circa', 'bookmaker', 'betcris'];

interface GapRow {
  eventName: string;
  market: string;
  selection: string;
  line: number | null;
  referenceLabel: string;
  referenceOverProb: number; // de-vigged over prob at reference
  retailBook: string;
  retailOverOdds: number | null;
  retailUnderOdds: number | null;
  retailOverProb: number | null; // raw implied (vig included)
  gapPct: number; // retail implied over prob - reference fair over prob, in pct pts
  direction: 'retail high on over' | 'retail high on under';
  wasOpening: boolean;
  snapshotAt: string;
}

function computeGapRows(groups: IntelOfferGroup[], sharpBook: string | null): GapRow[] {
  const out: GapRow[] = [];
  for (const g of groups) {
    const byLine = new Map<string, typeof g.books>();
    for (const b of g.books) {
      const k = b.line === null ? 'null' : String(b.line);
      const list = byLine.get(k);
      if (list) list.push(b);
      else byLine.set(k, [b]);
    }
    for (const books of byLine.values()) {
      let referenceOverProb: number | null = null;
      let referenceLabel = '';
      if (sharpBook) {
        const sharp = books.find(
          (b) => b.bookmakerKey === sharpBook && b.overOdds !== null && b.underOdds !== null && b.overOdds !== 0 && b.underOdds !== 0,
        );
        if (!sharp) continue;
        referenceOverProb = devigTwoWay(sharp.overOdds!, sharp.underOdds!).overProb;
        referenceLabel = `${sharpBook} (de-vig)`;
      } else {
        const consensus = consensusFairProbability(
          books.map((b) => ({ overOdds: b.overOdds ?? undefined, underOdds: b.underOdds ?? undefined })),
        );
        if (!consensus || consensus.bookCount < 3) continue;
        referenceOverProb = consensus.overProb;
        referenceLabel = `consensus of ${consensus.bookCount} books (de-vig)`;
      }
      for (const b of books) {
        if (sharpBook && b.bookmakerKey === sharpBook) continue;
        const retailOverProb = b.overOdds !== null && b.overOdds !== 0 ? impliedProbability(b.overOdds) : null;
        if (retailOverProb === null || referenceOverProb === null) continue;
        const gapPct = (retailOverProb - referenceOverProb) * 100;
        out.push({
          eventName: g.eventName ?? g.providerEventId,
          market: g.providerMarketKey,
          selection: `${g.providerParticipantId ?? '—'}${b.line !== null ? ` @ ${b.line}` : ''}`,
          line: b.line,
          referenceLabel,
          referenceOverProb,
          retailBook: b.bookmakerKey,
          retailOverOdds: b.overOdds,
          retailUnderOdds: b.underOdds,
          retailOverProb,
          gapPct,
          direction: gapPct >= 0 ? 'retail high on over' : 'retail high on under',
          wasOpening: b.isOpening,
          snapshotAt: b.snapshotAt,
        });
      }
    }
  }
  return out.sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct));
}

export default async function SharpBooksPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await searchParamsPromise;
  const sport = typeof searchParams['sport'] === 'string' ? searchParams['sport'] : undefined;

  let rows: GapRow[] = [];
  let fetchError: string | null = null;
  let observedAt: string | null = null;
  let sharpBook: string | null = null;
  let availableBooks: string[] = [];

  try {
    const [books, result] = await Promise.all([
      getDistinctBookmakers(),
      getCurrentOfferGroups({ sport, minBooks: 2, limit: 500 }),
    ]);
    availableBooks = books ?? [];
    sharpBook = SHARP_CANDIDATES.find((c) => availableBooks.includes(c)) ?? null;
    if (!result) {
      fetchError = 'Failed to load offers from provider_offer_current.';
    } else {
      observedAt = result.observedAt;
      rows = computeGapRows(result.groups, sharpBook);
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Unknown error loading sharp comparison.';
  }

  const allStale = rows.length > 1 && rows.every((r) => isStaleOdds(r.snapshotAt));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="cc-text-muted text-xs font-medium uppercase tracking-widest">Intelligence</p>
        <h1 className="mt-1 text-xl font-bold text-white">Sharp Book Compare</h1>
        <p className="cc-text-secondary mt-1 text-sm">
          {sharpBook
            ? `Reference book detected in live data: ${sharpBook}. Retail implied probabilities compared to the ${sharpBook} de-vigged price at the same line.`
            : 'No identifiable sharp book present in current data — comparing each retail price against de-vigged consensus (≥3 books) instead.'}
          {' '}Scan capped at 500 most-recent offer rows.
        </p>
        {availableBooks.length > 0 ? (
          <p className="cc-text-muted mt-1 text-xs">Books present: {availableBooks.join(', ')}</p>
        ) : null}
      </div>

      <UncertifiedBanner what="Sharp/consensus reference pricing (internal de-vig)" />

      <form method="GET" className="cc-surface flex flex-wrap items-end gap-3 p-4">
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
          message="No comparable offers found"
          detail="No group in the scanned window has both a reference price and retail quotes at the same line."
        />
      ) : (
        <Card title={`Price Gaps vs ${sharpBook ?? 'Consensus'} — ${rows.length} rows`}>
          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <Th>Event</Th>
                <Th>Market</Th>
                <Th>Selection</Th>
                <Th>Reference (fair over)</Th>
                <Th>Retail Book</Th>
                <Th>Retail Over / Under</Th>
                <Th>Retail Implied (over)</Th>
                <Th>Gap (pct pts)</Th>
                <Th>Direction</Th>
                <Th>Opening?</Th>
                <Th>Updated</Th>
              </TableHead>
              <TableBody>
                {rows.slice(0, 150).map((r, i) => (
                  <tr key={i} className="border-b border-gray-800/50">
                    <Td>{r.eventName}</Td>
                    <Td>{r.market}</Td>
                    <Td>{r.selection}</Td>
                    <Td>
                      {formatProb(r.referenceOverProb)}{' '}
                      <span className="text-gray-500">({r.referenceLabel})</span>
                    </Td>
                    <Td>{r.retailBook}</Td>
                    <Td>
                      {formatAmerican(r.retailOverOdds)} / {formatAmerican(r.retailUnderOdds)}
                    </Td>
                    <Td>{formatProb(r.retailOverProb)}</Td>
                    <Td>
                      <span className={Math.abs(r.gapPct) >= 3 ? 'font-semibold text-yellow-400' : 'text-gray-300'}>
                        {r.gapPct >= 0 ? '+' : ''}
                        {r.gapPct.toFixed(2)}
                      </span>
                    </Td>
                    <Td>{r.direction}</Td>
                    <Td>{r.wasOpening ? 'opening' : 'current'}</Td>
                    <Td>
                      {formatTimestamp(r.snapshotAt)}{' '}
                      <span className="text-gray-500">({formatRelativeTime(r.snapshotAt)})</span>
                      {!allStale && isStaleOdds(r.snapshotAt) ? (
                        <span className="ml-1">
                          <InternalLabelBadge label="Stale Odds" />
                        </span>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="cc-text-muted mt-3 text-[11px]">
            Retail implied probability includes vig; positive gap means retail prices the over as
            more likely than the reference does. Opening column reflects the row&apos;s is_opening
            flag in provider_offer_current. Observed {formatTimestamp(observedAt)}. Display capped
            at 150 rows.
          </p>
        </Card>
      )}
    </div>
  );
}
