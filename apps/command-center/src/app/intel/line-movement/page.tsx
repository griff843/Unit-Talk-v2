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
import {
  getCurrentOfferGroups,
  getOfferHistory,
  isStaleOdds,
  type HistoryOfferRow,
} from '@/lib/data/odds-intel';
import { formatRelativeTime } from '@/lib/data/research';
import { formatAmerican, formatTimestamp } from '@/lib/intel-format';

export const metadata = { title: 'Line Movement — Unit Talk Command Center' };

export const dynamic = 'force-dynamic';

interface MovementRow {
  eventName: string;
  market: string;
  selection: string;
  book: string;
  openingLine: number | null;
  currentLine: number | null;
  highLine: number | null;
  lowLine: number | null;
  openingOverOdds: number | null;
  currentOverOdds: number | null;
  lineMove: number | null;
  snapshots: number;
  firstSnapshotAt: string;
  lastSnapshotAt: string;
}

function historyKey(r: {
  providerEventId: string;
  providerMarketKey: string;
  providerParticipantId: string | null;
  bookmakerKey: string | null;
}): string {
  return [r.providerEventId, r.providerMarketKey, r.providerParticipantId ?? '', r.bookmakerKey ?? ''].join('|');
}

function buildMovementFromHistory(rows: HistoryOfferRow[], eventNames: Map<string, string>): MovementRow[] {
  const byKey = new Map<string, HistoryOfferRow[]>();
  for (const r of rows) {
    if (!r.bookmakerKey) continue;
    const k = historyKey(r);
    const list = byKey.get(k);
    if (list) list.push(r);
    else byKey.set(k, [r]);
  }
  const out: MovementRow[] = [];
  for (const series of byKey.values()) {
    if (series.length < 2) continue; // no movement observable from a single snapshot
    series.sort((a, b) => a.snapshotAt.localeCompare(b.snapshotAt));
    const first = series[0]!;
    const last = series[series.length - 1]!;
    const opening = series.find((s) => s.isOpening) ?? first;
    const lines = series.map((s) => s.line).filter((l): l is number => l !== null);
    const lineMove =
      last.line !== null && opening.line !== null ? last.line - opening.line : null;
    out.push({
      eventName: eventNames.get(first.providerEventId) ?? first.providerEventId,
      market: first.providerMarketKey,
      selection: first.providerParticipantId ?? '—',
      book: first.bookmakerKey ?? '—',
      openingLine: opening.line,
      currentLine: last.line,
      highLine: lines.length > 0 ? Math.max(...lines) : null,
      lowLine: lines.length > 0 ? Math.min(...lines) : null,
      openingOverOdds: opening.overOdds,
      currentOverOdds: last.overOdds,
      lineMove,
      snapshots: series.length,
      firstSnapshotAt: first.snapshotAt,
      lastSnapshotAt: last.snapshotAt,
    });
  }
  return out.sort((a, b) => Math.abs(b.lineMove ?? 0) - Math.abs(a.lineMove ?? 0));
}

export default async function LineMovementPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await searchParamsPromise;
  const market = typeof searchParams['market'] === 'string' ? searchParams['market'] : undefined;
  const eventId = typeof searchParams['event'] === 'string' ? searchParams['event'] : undefined;

  let rows: MovementRow[] = [];
  let fetchError: string | null = null;
  let usedFallback = false;
  let observedAt: string | null = null;

  try {
    // Primary source: provider_offer_history (per-snapshot movement).
    const history = await getOfferHistory({ market, eventId, limit: 1000 });
    if (history && history.rows.length > 0) {
      const groups = await getCurrentOfferGroups({ market, eventId, limit: 200 });
      const eventNames = new Map<string, string>();
      for (const g of groups?.groups ?? []) {
        if (g.eventName) eventNames.set(g.providerEventId, g.eventName);
      }
      rows = buildMovementFromHistory(history.rows, eventNames);
      observedAt = new Date().toISOString();
    }

    // Fallback: provider_offer_current is_opening vs current rows only.
    if (rows.length === 0) {
      usedFallback = true;
      const result = await getCurrentOfferGroups({ market, eventId, minBooks: 1, limit: 500 });
      if (!result) {
        fetchError = 'Failed to load offers from provider_offer_current.';
      } else {
        observedAt = result.observedAt;
        for (const g of result.groups) {
          for (const b of g.books) {
            // With only current rows, opening vs current is observable solely
            // when the current row still carries is_opening=false and no other
            // snapshot exists — so this fallback reports single-point rows.
            rows.push({
              eventName: g.eventName ?? g.providerEventId,
              market: g.providerMarketKey,
              selection: g.providerParticipantId ?? '—',
              book: b.bookmakerKey,
              openingLine: b.isOpening ? b.line : null,
              currentLine: b.line,
              highLine: b.line,
              lowLine: b.line,
              openingOverOdds: b.isOpening ? b.overOdds : null,
              currentOverOdds: b.overOdds,
              lineMove: null,
              snapshots: 1,
              firstSnapshotAt: b.snapshotAt,
              lastSnapshotAt: b.snapshotAt,
            });
          }
        }
        rows = rows.slice(0, 200);
      }
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Unknown error loading line movement.';
  }

  const movers = rows.filter((r) => r.lineMove !== null && r.lineMove !== 0).slice(0, 5);

  const allStale = rows.length > 1 && rows.every((r) => isStaleOdds(r.lastSnapshotAt));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="cc-text-muted text-xs font-medium uppercase tracking-widest">Intelligence</p>
        <h1 className="mt-1 text-xl font-bold text-white">Line Movement</h1>
        <p className="cc-text-secondary mt-1 text-sm">
          Per-book movement from provider_offer_history (opening / current / high / low). History
          scan capped at 1000 rows.
        </p>
      </div>

      {usedFallback ? (
        <Card title="Data Limitation">
          <p className="cc-text-secondary text-xs">
            provider_offer_history returned no usable multi-snapshot series for this filter, so
            this view falls back to provider_offer_current rows (is_opening flag vs current only).
            Single-snapshot rows cannot show movement — high/low equal the current line and Line Δ
            is unavailable.
          </p>
        </Card>
      ) : null}

      <form method="GET" className="cc-surface flex flex-wrap items-end gap-3 p-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="market" className="cc-text-muted text-[10px] font-medium uppercase tracking-wide">
            Market Key (contains)
          </label>
          <input
            id="market"
            name="market"
            defaultValue={market ?? ''}
            placeholder="e.g. strikeouts"
            className="w-56 rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="event" className="cc-text-muted text-[10px] font-medium uppercase tracking-wide">
            Provider Event ID
          </label>
          <input
            id="event"
            name="event"
            defaultValue={eventId ?? ''}
            className="w-56 rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200"
          />
        </div>
        <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
          Apply
        </button>
      </form>

      {movers.length > 0 ? (
        <Card title="Biggest Movers">
          <ul className="cc-text-secondary space-y-1 text-xs">
            {movers.map((m, i) => (
              <li key={i}>
                {m.eventName} · {m.market} · {m.selection} @ {m.book}: {m.openingLine} →{' '}
                {m.currentLine} ({m.lineMove! > 0 ? '+' : ''}
                {m.lineMove})
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {fetchError ? (
        <Card title="Error">
          <p className="text-xs text-red-400">{fetchError}</p>
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          message="No movement data found"
          detail="Neither provider_offer_history nor provider_offer_current returned rows for this filter."
        />
      ) : (
        <Card title={`Per-Book Movement — ${rows.length} series${usedFallback ? ' (fallback: current rows only)' : ''}`}>
          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <Th>Event</Th>
                <Th>Market</Th>
                <Th>Selection</Th>
                <Th>Book</Th>
                <Th align="right">Opening</Th>
                <Th align="right">Current</Th>
                <Th align="right">High</Th>
                <Th align="right">Low</Th>
                <Th>Line Δ</Th>
                <Th>Over Odds (open → cur)</Th>
                <Th>Snapshots</Th>
                <Th>Updated</Th>
              </TableHead>
              <TableBody>
                {rows.slice(0, 200).map((r, i) => (
                  <tr key={i} className="border-b border-gray-800/50">
                    <Td>{r.eventName}</Td>
                    <Td>{r.market}</Td>
                    <Td>{r.selection}</Td>
                    <Td>{r.book}</Td>
                    <Td num align="right">{r.openingLine ?? '—'}</Td>
                    <Td num align="right">{r.currentLine ?? '—'}</Td>
                    <Td num align="right">{r.highLine ?? '—'}</Td>
                    <Td num align="right">{r.lowLine ?? '—'}</Td>
                    <Td>
                      {r.lineMove === null ? (
                        '—'
                      ) : (
                        <span className={r.lineMove > 0 ? 'text-emerald-400' : r.lineMove < 0 ? 'text-red-400' : ''}>
                          {r.lineMove > 0 ? '+' : ''}
                          {r.lineMove}
                        </span>
                      )}
                    </Td>
                    <Td num>
                      {formatAmerican(r.openingOverOdds)} → {formatAmerican(r.currentOverOdds)}
                    </Td>
                    <Td num align="right">{r.snapshots}</Td>
                    <Td>
                      {formatTimestamp(r.lastSnapshotAt)}{' '}
                      <span className="text-gray-500">({formatRelativeTime(r.lastSnapshotAt)})</span>
                      {!allStale && isStaleOdds(r.lastSnapshotAt) ? (
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
            Opening = earliest snapshot with is_opening (else earliest row). Observed{' '}
            {formatTimestamp(observedAt)}. Display capped at 200 series.
          </p>
        </Card>
      )}
    </div>
  );
}
