import Link from '@/components/OperatorLink';
import { StatCard, InternalLabelBadge, Table, TableHead, TableBody, Th, Td, EmptyState, SeverityBadge } from '@/components/ui';
import { getResultsOpsSnapshot, type ResultsOpsSnapshot, type SettlementOpsRow, type DeliveredAwaitingSettlementRow } from '@/lib/data/results-ops';
import { formatRelativeAge } from '@/lib/fire-board-model';
import { renderClvSummary, isClvUnresolved } from '@/lib/clv-summary';
import { SettlementWorkbench } from '@/components/SettlementWorkbench';
import { getPickDetail } from '@/lib/data';
import { getDeliveryKillSwitchStatuses } from '@/lib/data/discord-ops';
import { predictRecapDelivery } from '@/lib/human-capper-recap';
import { isPickAlreadySettled } from '@/lib/settlement-state';

export const metadata = { title: 'Settlement — Unit Talk Command Center' };

export const dynamic = 'force-dynamic';

function SettlementTable({ rows, nowMs }: { rows: SettlementOpsRow[]; nowMs: number }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHead>
          <Th>Pick</Th>
          <Th>Status</Th>
          <Th>Result</Th>
          <Th>CLV</Th>
          <Th>Source</Th>
          <Th>Confidence</Th>
          <Th>Correction of</Th>
          <Th>Review reason</Th>
          <Th>Settled by</Th>
          <Th>Settled at</Th>
          <Th>Age</Th>
          <Th>Action</Th>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-gray-800/60">
              <Td>
                <Link href={`/picks/${row.pickId}`} className="font-mono text-xs text-blue-400 hover:underline">
                  {row.pickId.slice(0, 8)}…
                </Link>
              </Td>
              <Td>
                {row.status === 'manual_review' ? (
                  <InternalLabelBadge label="Needs Review" />
                ) : (
                  <InternalLabelBadge label="Settled" />
                )}
              </Td>
              <Td>{row.result ?? <span className="cc-text-muted">unsettled</span>}</Td>
              <Td>
                {isClvUnresolved(row) ? (
                  <span className="cc-text-muted text-xs" title="Closing-line capture requires a live provider, which is deliberately off.">
                    {renderClvSummary(row)}
                  </span>
                ) : (
                  <span className="cc-num text-xs text-gray-200">{renderClvSummary(row)}</span>
                )}
              </Td>
              <Td>{row.source}</Td>
              <Td>{row.confidence}</Td>
              <Td>{row.correctsId ? <span className="font-mono text-xs">{row.correctsId.slice(0, 8)}…</span> : '—'}</Td>
              <Td>{row.reviewReason ? <span className="text-yellow-300">{row.reviewReason}</span> : '—'}</Td>
              <Td>{row.settledBy ?? '—'}</Td>
              <Td><span className="font-mono">{row.settledAt}</span></Td>
              <Td>{formatRelativeAge(row.settledAt, nowMs) ?? '—'}</Td>
              <Td>
                {row.status === 'manual_review' ? (
                  <Link
                    href={`/settlement?pickId=${row.pickId}`}
                    className="text-xs text-blue-400 hover:underline"
                  >
                    Settle
                  </Link>
                ) : (
                  <Link href={`/settlement?pickId=${row.pickId}`} className="text-xs text-blue-400 hover:underline">Correct settlement</Link>
                )}
              </Td>
            </tr>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DeliveredAwaitingTable({ rows, nowMs }: { rows: DeliveredAwaitingSettlementRow[]; nowMs: number }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHead>
          <Th>Pick</Th>
          <Th>Capper</Th>
          <Th>Sport</Th>
          <Th>Market / Selection</Th>
          <Th>Odds</Th>
          <Th>Units</Th>
          <Th>Delivered</Th>
          <Th>Action</Th>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-gray-800/60">
              <Td>
                <Link href={`/picks/${row.id}`} className="font-mono text-xs text-blue-400 hover:underline">
                  {row.id.slice(0, 8)}…
                </Link>
              </Td>
              <Td>{row.capperId ?? '—'}</Td>
              <Td>{row.sportDisplayName ?? '—'}</Td>
              <Td>
                {row.market ?? '—'}
                {row.selection ? <span className="cc-text-muted"> · {row.selection}</span> : null}
              </Td>
              <Td><span className="cc-num">{row.odds ?? '—'}</span></Td>
              <Td><span className="cc-num">{row.stakeUnits ?? '—'}</span></Td>
              <Td>{formatRelativeAge(row.postedAt, nowMs) ?? '—'}</Td>
              <Td>
                <Link
                  href={`/settlement?pickId=${row.id}`}
                  className="text-xs font-medium text-blue-400 hover:underline"
                >
                  Settle
                </Link>
              </Td>
            </tr>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function SettlementPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await searchParamsPromise;
  const requestedPickId = typeof searchParams['pickId'] === 'string'
    ? searchParams['pickId'].trim() || null
    : null;
  const nowMs = Date.now();
  const observedAt = new Date(nowMs).toISOString();

  let snapshot: ResultsOpsSnapshot | null = null;
  let loadError: string | null = null;
  try {
    snapshot = await getResultsOpsSnapshot();
  } catch (error) {
    console.error('command_center.settlement_read_failed', error);
    loadError = 'Settlement history is temporarily unavailable. Refresh to try again or check System Health.';
  }

  // UTV2-1939: the per-pick recap posts by direct fetch rather than through the
  // outbox, so `settle-pick-controller.ts` consults the kill switch itself and
  // silently declines. Reading the switch here lets the operator see that
  // consequence BEFORE settling instead of discovering it afterwards. A failed
  // read stays null, and `predictRecapDelivery` fails closed on null -- it
  // reports the outcome as unknown rather than promising a recap.
  let officialPicksKilled: boolean | null = null;
  try {
    const switches = await getDeliveryKillSwitchStatuses();
    const official = switches.find((entry) => entry.target === 'official-picks');
    officialPicksKilled = official ? official.killed : null;
  } catch {
    officialPicksKilled = null;
  }

  let isAlreadySettled: boolean | null = null;
  let pickLoadError: string | null = null;
  if (snapshot && requestedPickId) {
    try {
      const detail = await getPickDetail(requestedPickId);
      if (!detail) {
        pickLoadError = 'Canonical pick was not found.';
      } else {
        isAlreadySettled = isPickAlreadySettled(detail.pick.status, detail.settlements.length);
      }
    } catch (error) {
      console.error('command_center.settlement_pick_read_failed', error);
      pickLoadError = 'This pick could not be loaded. Refresh to try again.';
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <p className="text-sm cc-text-muted">
          Settlement history, manual review, corrections, and delivered picks awaiting outcomes. Only governed operator picks are included; test fixtures are excluded.
          Observed {observedAt}.
        </p>
      </div>

      {loadError ? (
        <div className="cc-surface p-5 border border-red-500/30">
          <div className="flex items-center gap-2">
            <SeverityBadge severity="critical" label="Load Failed" />
            <span className="text-sm text-gray-200">Settlement truth could not be loaded.</span>
          </div>
          <p className="mt-2 text-xs cc-text-muted font-mono">{loadError}</p>
        </div>
      ) : snapshot ? (
        <>
          <SettlementWorkbench
            pickId={requestedPickId}
            isAlreadySettled={isAlreadySettled}
            pickLoadError={pickLoadError}
          />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Settlement Records (24h)" value={snapshot.counts.settled24h} />
            <StatCard label="Manual Review Open" value={snapshot.counts.manualReviewOpen} />
            <StatCard label="Corrections" value={snapshot.counts.corrections} />
            <StatCard label="Stuck Posted" value={snapshot.counts.stuckPosted} />
            <StatCard
              label="Delivered — Awaiting Settlement"
              value={snapshot.counts.deliveredAwaitingSettlement}
            />
            <div className="cc-surface p-5">
              <p className="text-xs font-semibold uppercase tracking-wide cc-text-secondary">Game Results Freshness</p>
              <p className="mt-1 text-lg font-bold text-gray-100">
                {snapshot.gameResults.unavailable ? 'Unavailable' : formatRelativeAge(snapshot.gameResults.latestSourcedAt, nowMs) ?? 'No results recorded'}
              </p>
              <p className="text-xs cc-text-muted" title={snapshot.gameResults.latestSourcedAt ?? undefined}>
                {snapshot.gameResults.unavailable ? 'Results-feed evidence could not be read. Settlement history is still available.' : `${snapshot.gameResults.count24h} results received in the last 24 hours`}
              </p>
            </div>
          </div>

          <div className="cc-surface p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide cc-text-secondary">
              Delivered — Awaiting Settlement ({snapshot.counts.deliveredAwaitingSettlement})
            </h2>
            <p className="mb-3 text-xs cc-text-muted">
              Human-capper picks that carry a server delivery authorization, reached members, and have no
              settlement record yet. No age threshold applies — a pick delivered today appears here as soon
              as it is delivered, because the per-pick recap is part of the same transaction.
            </p>
            {snapshot.deliveredAwaitingSettlement.length > 0 && (() => {
              // `hasSentDelivery: true` is sound for this list specifically: the query
              // filters `status = 'posted'`, and `posted` is the lifecycle state written
              // only once downstream delivery is confirmed. It is not an assumption about
              // picks in general.
              const prediction = predictRecapDelivery({
                isHumanCapperDelivery: true,
                officialPicksKilled,
                hasSentDelivery: true,
              });
              return (
                <p
                  className={`mb-3 rounded-md border px-3 py-2 text-xs ${
                    prediction.willAttempt
                      ? 'border-blue-700 bg-blue-950/50 text-blue-200'
                      : 'border-amber-600 bg-amber-950/40 text-amber-200'
                  }`}
                >
                  {prediction.summary}
                </p>
              );
            })()}
            {snapshot.deliveredAwaitingSettlement.length === 0 ? (
              <EmptyState message="No delivered picks are awaiting settlement." />
            ) : (
              <DeliveredAwaitingTable rows={snapshot.deliveredAwaitingSettlement} nowMs={nowMs} />
            )}
          </div>

          <div className="cc-surface p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide cc-text-secondary">
              Manual Review ({snapshot.counts.manualReviewOpen})
            </h2>
            {snapshot.manualReview.length === 0 ? (
              <EmptyState message="No settlements pending manual review." />
            ) : (
              <SettlementTable rows={snapshot.manualReview} nowMs={nowMs} />
            )}
          </div>

          <div className="cc-surface p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide cc-text-secondary">
              Posted for More Than 24 Hours ({snapshot.counts.stuckPosted})
            </h2>
            <p className="mb-3 text-xs cc-text-muted">
              Picks still in the posted lifecycle state more than 24 hours after posting.
              This measures time since posting, not time since the game ended. Showing up to 50 oldest picks.
            </p>
            {snapshot.stuckPosted.length === 0 ? (
              <EmptyState message="No picks stuck in posted." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <Th>Pick</Th>
                    <Th>Market / Selection</Th>
                    <Th>Sport</Th>
                    <Th>Posted at</Th>
                    <Th>Created</Th>
                    <Th>Age</Th>
                    <Th>Status</Th>
                  </TableHead>
                  <TableBody>
                    {snapshot.stuckPosted.map((pick) => (
                      <tr key={pick.id} className="border-b border-gray-800/60">
                        <Td>
                          <Link href={`/picks/${pick.id}`} className="font-mono text-xs text-blue-400 hover:underline">
                            {pick.id.slice(0, 8)}…
                          </Link>
                        </Td>
                        <Td>
                          <span className="text-gray-100">{pick.market ?? '—'}</span>
                          <span className="cc-text-muted"> / {pick.selection ?? '—'}</span>
                        </Td>
                        <Td>{pick.sportDisplayName ?? '—'}</Td>
                        <Td><span className="font-mono">{pick.postedAt ?? '—'}</span></Td>
                        <Td><span className="font-mono">{pick.createdAt ?? '—'}</span></Td>
                        <Td><span className="text-yellow-300">{pick.ageHours == null ? '—' : `${pick.ageHours}h`}</span></Td>
                        <Td><InternalLabelBadge label="Stale" /></Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="cc-surface p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide cc-text-secondary">
              Corrections ({snapshot.counts.corrections})
            </h2>
            <p className="mb-3 text-xs cc-text-muted">
              Corrections preserve the original settlement and record who changed the outcome. Showing up to 50 most recent corrections.
            </p>
            {snapshot.corrections.length === 0 ? (
              <EmptyState message="No correction records." />
            ) : (
              <SettlementTable rows={snapshot.corrections} nowMs={nowMs} />
            )}
          </div>

          <div className="cc-surface p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide cc-text-secondary">
              Recent Settlement Records ({snapshot.recentSettlements.length} shown)
            </h2>
            {snapshot.recentSettlements.length === 0 ? (
              <EmptyState message="No settlement records yet." />
            ) : (
              <SettlementTable rows={snapshot.recentSettlements} nowMs={nowMs} />
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
