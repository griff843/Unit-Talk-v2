import {
  Card,
  EmptyState,
  InternalLabelBadge,
  Table,
  TableHead,
  TableBody,
  Th,
  Td,
} from '@/components/ui';
import { getCurrentOfferGroups, isStaleOdds, type IntelOfferGroup } from '@/lib/data/odds-intel';
import { formatRelativeTime } from '@/lib/data/research';
import { americanToDecimal, middleWindow } from '@/lib/odds-math';
import { formatAmerican, formatTimestamp, formatUnits } from '@/lib/intel-format';

export const dynamic = 'force-dynamic';

const STAKE_PER_LEG = 500; // units — display notional only (1000u total)

interface MiddleRow {
  eventName: string;
  market: string;
  selection: string;
  lineLow: number;
  lineHigh: number;
  overBook: string;
  overOdds: number;
  underBook: string;
  underOdds: number;
  windowWidth: number;
  /** Net units lost if no middle (worst single-leg loss net of the other leg's win) */
  riskIfNoMiddle: number;
  /** Net units won if the result lands strictly inside the window (both legs win) */
  payoutIfMiddle: number;
  oldestSnapshotAt: string;
  notes: string;
}

/**
 * Middles: over at the LOWER line at one book, under at the HIGHER line at
 * another book, same event+market+participant. Results strictly between the
 * lines win both legs.
 */
function computeMiddleRows(groups: IntelOfferGroup[]): MiddleRow[] {
  const out: MiddleRow[] = [];
  for (const g of groups) {
    const withLines = g.books.filter((b) => b.line !== null);
    const lines = Array.from(new Set(withLines.map((b) => b.line as number)));
    if (lines.length < 2) continue;
    const low = Math.min(...lines);
    const high = Math.max(...lines);
    const w = middleWindow(low, high);
    if (!w) continue;

    // best over at the low line; best under at the high line
    let over: (typeof withLines)[number] | null = null;
    let under: (typeof withLines)[number] | null = null;
    for (const b of withLines) {
      if (b.line === low && b.overOdds !== null && b.overOdds !== 0 && (over === null || b.overOdds > over.overOdds!)) over = b;
      if (b.line === high && b.underOdds !== null && b.underOdds !== 0 && (under === null || b.underOdds > under.underOdds!)) under = b;
    }
    if (!over || !under || over.bookmakerKey === under.bookmakerKey) continue;

    const overDec = americanToDecimal(over.overOdds!);
    const underDec = americanToDecimal(under.underOdds!);
    // Equal stakes per leg for transparency. If no middle, exactly one leg
    // wins (ignoring pushes at integer lines): net = winProfit - losingStake.
    const worstNet = Math.min(
      STAKE_PER_LEG * (overDec - 1) - STAKE_PER_LEG, // only over wins
      STAKE_PER_LEG * (underDec - 1) - STAKE_PER_LEG, // only under wins
    );
    const middleNet = STAKE_PER_LEG * (overDec - 1) + STAKE_PER_LEG * (underDec - 1);

    const integerInWindow = high - low > 1 || Number.isInteger((low + high) / 2);
    out.push({
      eventName: g.eventName ?? g.providerEventId,
      market: g.providerMarketKey,
      selection: g.providerParticipantId ?? '—',
      lineLow: low,
      lineHigh: high,
      overBook: over.bookmakerKey,
      overOdds: over.overOdds!,
      underBook: under.bookmakerKey,
      underOdds: under.underOdds!,
      windowWidth: w.width,
      riskIfNoMiddle: worstNet,
      payoutIfMiddle: middleNet,
      oldestSnapshotAt: over.snapshotAt < under.snapshotAt ? over.snapshotAt : under.snapshotAt,
      notes: integerInWindow
        ? 'Push possible at integer lines inside window — verify book push rules.'
        : 'Half-point lines; no push inside window.',
    });
  }
  return out.sort((a, b) => b.windowWidth - a.windowWidth || b.riskIfNoMiddle - a.riskIfNoMiddle);
}

export default async function MiddlesPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await searchParamsPromise;
  const sport = typeof searchParams['sport'] === 'string' ? searchParams['sport'] : undefined;

  let rows: MiddleRow[] = [];
  let fetchError: string | null = null;
  let observedAt: string | null = null;

  try {
    const result = await getCurrentOfferGroups({ sport, minBooks: 2, limit: 500 });
    if (!result) {
      fetchError = 'Failed to load offers from provider_offer_current.';
    } else {
      observedAt = result.observedAt;
      rows = computeMiddleRows(result.groups);
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Unknown error loading middles scan.';
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="cc-text-muted text-xs font-medium uppercase tracking-widest">Intelligence</p>
        <h1 className="mt-1 text-xl font-bold text-white">Middle Finder</h1>
        <p className="cc-text-secondary mt-1 text-sm">
          Same market, different lines across books: over the lower line + under the higher line.
          Risk/payout shown for equal 500u stakes per leg. Scan capped at 500 most-recent offer rows.
        </p>
      </div>

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
          message="No middle opportunities found"
          detail="No event+market+participant group in the scanned window has cross-book line divergence."
        />
      ) : (
        <Card title={`Middle Candidates — ${rows.length}`}>
          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <Th>Event</Th>
                <Th>Market</Th>
                <Th>Selection</Th>
                <Th>Over Line / Book / Odds</Th>
                <Th>Under Line / Book / Odds</Th>
                <Th>Window</Th>
                <Th>Risk (no middle)</Th>
                <Th>Payout (middle)</Th>
                <Th>Updated</Th>
                <Th>Notes</Th>
              </TableHead>
              <TableBody>
                {rows.slice(0, 100).map((r, i) => (
                  <tr key={i} className="border-b border-gray-800/50">
                    <Td>{r.eventName}</Td>
                    <Td>{r.market}</Td>
                    <Td>{r.selection}</Td>
                    <Td>
                      {r.lineLow} @ {r.overBook}{' '}
                      <span className="text-emerald-400">{formatAmerican(r.overOdds)}</span>
                    </Td>
                    <Td>
                      {r.lineHigh} @ {r.underBook}{' '}
                      <span className="text-red-400">{formatAmerican(r.underOdds)}</span>
                    </Td>
                    <Td>
                      {r.lineLow}–{r.lineHigh}{' '}
                      <span className="text-gray-500">({formatUnits(r.windowWidth)} wide)</span>
                    </Td>
                    <Td>
                      <span className="text-red-400">{formatUnits(r.riskIfNoMiddle)}u</span>
                    </Td>
                    <Td>
                      <span className="text-emerald-400">+{formatUnits(r.payoutIfMiddle)}u</span>
                    </Td>
                    <Td>
                      {formatTimestamp(r.oldestSnapshotAt)}{' '}
                      <span className="text-gray-500">({formatRelativeTime(r.oldestSnapshotAt)})</span>
                      {isStaleOdds(r.oldestSnapshotAt) ? (
                        <span className="ml-1">
                          <InternalLabelBadge label="Stale Odds" />
                        </span>
                      ) : null}
                    </Td>
                    <Td>{r.notes}</Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="cc-text-muted mt-3 text-[11px]">
            Risk assumes exactly one leg loses when no middle hits (pushes not modeled — see notes).
            Observed {formatTimestamp(observedAt)}. Display capped at 100 rows.
          </p>
        </Card>
      )}
    </div>
  );
}
