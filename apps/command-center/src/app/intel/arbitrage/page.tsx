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
import { americanToDecimal, arbPercent, arbStakeSplit } from '@/lib/odds-math';
import { formatAmerican, formatPercent, formatTimestamp, formatUnits } from '@/lib/intel-format';

export const metadata = { title: 'Arbitrage Finder — Unit Talk Command Center' };

export const dynamic = 'force-dynamic';

const NOTIONAL_BANKROLL = 1000; // units — display notional only

interface ArbRow {
  eventName: string;
  market: string;
  selection: string;
  line: number | null;
  overBook: string;
  overOdds: number;
  underBook: string;
  underOdds: number;
  arbPct: number;
  overStake: number;
  underStake: number;
  guaranteedReturn: number;
  oldestSnapshotAt: string;
}

/** Best over at one book vs best under at another, same identity + line. */
function computeArbRows(groups: IntelOfferGroup[]): ArbRow[] {
  const out: ArbRow[] = [];
  for (const g of groups) {
    const byLine = new Map<string, typeof g.books>();
    for (const b of g.books) {
      const k = b.line === null ? 'null' : String(b.line);
      const list = byLine.get(k);
      if (list) list.push(b);
      else byLine.set(k, [b]);
    }
    for (const books of byLine.values()) {
      let bestOver: (typeof books)[number] | null = null;
      let bestUnder: (typeof books)[number] | null = null;
      for (const b of books) {
        if (b.overOdds !== null && b.overOdds !== 0 && (bestOver === null || b.overOdds > bestOver.overOdds!)) bestOver = b;
        if (b.underOdds !== null && b.underOdds !== 0 && (bestUnder === null || b.underOdds > bestUnder.underOdds!)) bestUnder = b;
      }
      if (!bestOver || !bestUnder) continue;
      if (bestOver.bookmakerKey === bestUnder.bookmakerKey) continue; // cross-book only
      const overDec = americanToDecimal(bestOver.overOdds!);
      const underDec = americanToDecimal(bestUnder.underOdds!);
      const pct = arbPercent(overDec, underDec);
      if (pct <= 0) continue; // combined implied prob must be < 1
      const split = arbStakeSplit(NOTIONAL_BANKROLL, overDec, underDec);
      out.push({
        eventName: g.eventName ?? g.providerEventId,
        market: g.providerMarketKey,
        selection: g.providerParticipantId ?? '—',
        line: bestOver.line,
        overBook: bestOver.bookmakerKey,
        overOdds: bestOver.overOdds!,
        underBook: bestUnder.bookmakerKey,
        underOdds: bestUnder.underOdds!,
        arbPct: pct,
        overStake: split.stakeA,
        underStake: split.stakeB,
        guaranteedReturn: split.guaranteedReturn,
        oldestSnapshotAt:
          bestOver.snapshotAt < bestUnder.snapshotAt ? bestOver.snapshotAt : bestUnder.snapshotAt,
      });
    }
  }
  return out.sort((a, b) => b.arbPct - a.arbPct);
}

export default async function ArbitragePage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await searchParamsPromise;
  const sport = typeof searchParams['sport'] === 'string' ? searchParams['sport'] : undefined;

  let rows: ArbRow[] = [];
  let fetchError: string | null = null;
  let observedAt: string | null = null;

  try {
    const result = await getCurrentOfferGroups({ sport, minBooks: 2, limit: 500 });
    if (!result) {
      fetchError = 'Failed to load offers from provider_offer_current.';
    } else {
      observedAt = result.observedAt;
      rows = computeArbRows(result.groups);
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Unknown error loading arbitrage scan.';
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="cc-text-muted text-xs font-medium uppercase tracking-widest">Intelligence</p>
        <h1 className="mt-1 text-xl font-bold text-white">Arbitrage Finder</h1>
        <p className="cc-text-secondary mt-1 text-sm">
          Two-way markets where best over (book A) + best under (book B) at the same line imply
          combined probability &lt; 1. Internal research surface only. Scan capped at 500 most-recent
          offer rows.
        </p>
      </div>

      <Card title="Execution Risk — Read Before Acting">
        <ul className="cc-text-secondary list-disc space-y-1 pl-5 text-xs">
          <li>Stale quotes: rows below reflect the last stored snapshot per book, not live prices. Any leg flagged Stale Odds must be re-verified at the book before consideration.</li>
          <li>Bet limits: books may limit stakes below the split shown; a partial fill on one leg leaves open exposure.</li>
          <li>Void/settlement risk: books may void one leg (line change, rule difference, palpable error) while the other stands.</li>
          <li>Line moves between legs: placing sequentially exposes the second leg to movement.</li>
        </ul>
      </Card>

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
          message="No cross-book arbitrage found"
          detail="No identity/line pair in the scanned window has combined implied probability below 1 across two books."
        />
      ) : (
        <Card title={`Arbitrage Candidates — ${rows.length}`}>
          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <Th>Event</Th>
                <Th>Market</Th>
                <Th>Selection</Th>
                <Th>Line</Th>
                <Th>Over (book / odds)</Th>
                <Th>Under (book / odds)</Th>
                <Th>Arb %</Th>
                <Th>Split (1000u)</Th>
                <Th>Est. Return</Th>
                <Th>Updated</Th>
                <Th>Flags</Th>
              </TableHead>
              <TableBody>
                {rows.slice(0, 100).map((r, i) => (
                  <tr key={i} className="border-b border-gray-800/50">
                    <Td>{r.eventName}</Td>
                    <Td>{r.market}</Td>
                    <Td>{r.selection}</Td>
                    <Td>{r.line ?? '—'}</Td>
                    <Td>
                      {r.overBook} <span className="text-emerald-400">{formatAmerican(r.overOdds)}</span>
                    </Td>
                    <Td>
                      {r.underBook} <span className="text-red-400">{formatAmerican(r.underOdds)}</span>
                    </Td>
                    <Td>
                      <span className="font-semibold text-emerald-400">{formatPercent(r.arbPct)}</span>
                    </Td>
                    <Td>
                      {formatUnits(r.overStake)}u over / {formatUnits(r.underStake)}u under
                    </Td>
                    <Td>{formatUnits(r.guaranteedReturn)}u</Td>
                    <Td>
                      {formatTimestamp(r.oldestSnapshotAt)}{' '}
                      <span className="text-gray-500">({formatRelativeTime(r.oldestSnapshotAt)})</span>
                    </Td>
                    <Td>{isStaleOdds(r.oldestSnapshotAt) ? <InternalLabelBadge label="Stale Odds" /> : null}</Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="cc-text-muted mt-3 text-[11px]">
            Stake split for a notional 1000-unit bankroll; est. return is the equalized payout if
            both legs stand at the quoted prices. Observed {formatTimestamp(observedAt)}. Display
            capped at 100 rows.
          </p>
        </Card>
      )}
    </div>
  );
}
