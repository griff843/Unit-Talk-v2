import Link from 'next/link';
import { StatCard, InternalLabelBadge, Table, TableHead, TableBody, Th, Td, EmptyState, SeverityBadge } from '@/components/ui';
import { getResultsOpsSnapshot, type ResultsOpsSnapshot, type SettlementOpsRow } from '@/lib/data/results-ops';
import { formatRelativeAge } from '@/lib/fire-board-model';

export const dynamic = 'force-dynamic';

function SettlementTable({ rows, nowMs }: { rows: SettlementOpsRow[]; nowMs: number }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHead>
          <Th>Pick</Th>
          <Th>Status</Th>
          <Th>Result</Th>
          <Th>Source</Th>
          <Th>Confidence</Th>
          <Th>Correction of</Th>
          <Th>Review reason</Th>
          <Th>Settled by</Th>
          <Th>Settled at</Th>
          <Th>Age</Th>
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
              <Td>{row.result ?? '—'}</Td>
              <Td>{row.source}</Td>
              <Td>{row.confidence}</Td>
              <Td>{row.correctsId ? <span className="font-mono text-xs">{row.correctsId.slice(0, 8)}…</span> : '—'}</Td>
              <Td>{row.reviewReason ? <span className="text-yellow-300">{row.reviewReason}</span> : '—'}</Td>
              <Td>{row.settledBy ?? '—'}</Td>
              <Td><span className="font-mono">{row.settledAt}</span></Td>
              <Td>{formatRelativeAge(row.settledAt, nowMs) ?? '—'}</Td>
            </tr>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function ResultsOpsPage() {
  const nowMs = Date.now();
  const observedAt = new Date(nowMs).toISOString();

  let snapshot: ResultsOpsSnapshot | null = null;
  let loadError: string | null = null;
  try {
    snapshot = await getResultsOpsSnapshot();
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-lg font-bold text-gray-100">Results / Settlement Ops</h1>
        <p className="text-sm cc-text-muted">
          Internal settlement truth: throughput, manual-review blockers, corrections, and picks stuck in posted.
          Observed {observedAt}.
        </p>
      </div>

      {loadError ? (
        <div className="cc-surface p-5 border border-red-500/30">
          <div className="flex items-center gap-2">
            <SeverityBadge severity="critical" label="Load Failed" />
            <span className="text-sm text-gray-200">Results ops data could not be loaded.</span>
          </div>
          <p className="mt-2 text-xs cc-text-muted font-mono">{loadError}</p>
        </div>
      ) : snapshot ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Settled (24h)" value={snapshot.counts.settled24h} />
            <StatCard label="Manual Review Open" value={snapshot.counts.manualReviewOpen} />
            <StatCard label="Corrections" value={snapshot.counts.corrections} />
            <StatCard label="Stuck Posted" value={snapshot.counts.stuckPosted} />
            <div className="cc-surface p-5">
              <p className="text-xs font-semibold uppercase tracking-wide cc-text-secondary">Game Results Freshness</p>
              <p className="mt-1 text-lg font-bold text-gray-100">
                {formatRelativeAge(snapshot.gameResults.latestSourcedAt, nowMs) ?? '—'}
              </p>
              <p className="text-xs cc-text-muted" title={snapshot.gameResults.latestSourcedAt ?? undefined}>
                {snapshot.gameResults.count24h} rows sourced in 24h
              </p>
            </div>
          </div>

          <div className="cc-surface p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide cc-text-secondary">
              Manual Review ({snapshot.manualReview.length})
            </h2>
            {snapshot.manualReview.length === 0 ? (
              <EmptyState message="No settlements pending manual review." />
            ) : (
              <SettlementTable rows={snapshot.manualReview} nowMs={nowMs} />
            )}
          </div>

          <div className="cc-surface p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide cc-text-secondary">
              Stuck in Posted ({snapshot.stuckPosted.length})
            </h2>
            <p className="mb-3 text-xs cc-text-muted">
              Picks in lifecycle status posted for more than 24h. Age-based proxy — event-start join is a pending
              data-contract improvement (see src/lib/data/results-ops.ts).
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
                        <Td><span className="text-yellow-300">{pick.ageHours}h</span></Td>
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
              Corrections ({snapshot.corrections.length})
            </h2>
            <p className="mb-3 text-xs cc-text-muted">
              Settlement records with corrects_id set — originals are never mutated.
            </p>
            {snapshot.corrections.length === 0 ? (
              <EmptyState message="No correction records." />
            ) : (
              <SettlementTable rows={snapshot.corrections} nowMs={nowMs} />
            )}
          </div>

          <div className="cc-surface p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide cc-text-secondary">
              Recent Settlements ({snapshot.recentSettlements.length})
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
