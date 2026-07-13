import Link from 'next/link';
import { Card, EmptyState, InternalLabelBadge, StatCard, Table, TableHead, TableBody, Th, Td } from '@/components/ui';
import { getResultsTracking } from '@/lib/data/execution';

export const metadata = { title: 'Results Tracking — Unit Talk Command Center' };

export const dynamic = 'force-dynamic';

export default async function ResultsTrackingPage() {
  let data: Awaited<ReturnType<typeof getResultsTracking>> | null = null;
  let loadError: string | null = null;

  try {
    data = await getResultsTracking(100);
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Failed to load results data';
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <p className="text-sm cc-text-secondary">
          Internal audit of dispatched picks: settlement state, corrections, and delivery evidence.
          Window: most recent 100 posted/settled picks.
        </p>
        {data ? <p className="text-xs cc-text-muted">Observed {data.observedAt}</p> : null}
      </div>

      {loadError ? (
        <Card title="Load error">
          <p className="text-sm text-red-400">{loadError}</p>
        </Card>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <StatCard label="Dispatched Today" value={data.stats.dispatchedToday} />
            <StatCard label="Pending Results" value={data.stats.pendingResults} />
            <StatCard label="Settled" value={data.stats.settled} />
            <StatCard label="Settlement Review" value={data.stats.failedSettlement} />
            <StatCard label="Stale (>48h unsettled)" value={data.stats.stale48h} />
          </div>

          <div className="cc-surface p-5">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide cc-text-secondary">
              Dispatched Picks
            </h2>
            {data.picks.length === 0 ? (
              <EmptyState message="No dispatched picks" detail="No posted or settled picks found in the window." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <Th>Pick</Th>
                      <Th>Status</Th>
                      <Th>Posted At</Th>
                      <Th>Result</Th>
                      <Th>Settled At / By</Th>
                      <Th>Corrections</Th>
                      <Th>Delivery Evidence</Th>
                      <Th>Audit</Th>
                  </TableHead>
                  <TableBody>
                    {data.picks.map((pick) => {
                      const settlements = data.settlementsByPick[pick.id] ?? [];
                      const receipts = data.receiptsByPick[pick.id] ?? [];
                      const latest = settlements[0] ?? null;
                      const corrections = settlements.filter((s) => s.correctsId !== null);
                      const isStale =
                        !pick.settledAt &&
                        pick.postedAt &&
                        Date.now() - new Date(pick.postedAt).getTime() > 48 * 3_600_000;
                      return (
                        <tr key={pick.id}>
                          <Td>
                            <span className="font-mono text-xs">{pick.id.slice(0, 8)}…</span>
                            <div className="text-xs cc-text-muted">
                              {pick.eventName ?? '—'} · {pick.market} · {pick.selection}
                              {pick.line !== null ? ` ${pick.line}` : ''}
                            </div>
                          </Td>
                          <Td>
                            {pick.status === 'settled' ? (
                              <InternalLabelBadge label="Settled" />
                            ) : isStale ? (
                              <InternalLabelBadge label="Stale" />
                            ) : (
                              <InternalLabelBadge label="Sent" />
                            )}
                          </Td>
                          <Td>
                            <span className="text-xs cc-text-muted">{pick.postedAt ?? '—'}</span>
                          </Td>
                          <Td>
                            {latest?.result ?? pick.settlementResult ?? (
                              <span className="text-xs cc-text-muted">pending</span>
                            )}
                            {latest?.status === 'manual_review' ? (
                              <div><InternalLabelBadge label="Needs Review" /></div>
                            ) : null}
                          </Td>
                          <Td>
                            <span className="text-xs cc-text-muted">
                              {latest?.settledAt ?? pick.settledAt ?? '—'}
                              {latest?.settledBy ? ` · ${latest.settledBy}` : ''}
                            </span>
                          </Td>
                          <Td>
                            {corrections.length > 0 ? (
                              <span className="text-xs text-yellow-400">
                                {corrections.length} correction{corrections.length !== 1 ? 's' : ''}
                              </span>
                            ) : (
                              <span className="text-xs cc-text-muted">—</span>
                            )}
                          </Td>
                          <Td>
                            {receipts.length > 0 ? (
                              <span className="text-xs cc-text-secondary">
                                {receipts.length} receipt{receipts.length !== 1 ? 's' : ''}
                                {receipts[0]?.channel ? ` · ${receipts[0].channel}` : ''}
                                {receipts[0]?.recordedAt ? ` · ${receipts[0].recordedAt}` : ''}
                              </span>
                            ) : pick.status === 'posted' || pick.status === 'settled' ? (
                              <InternalLabelBadge label="Data Missing" />
                            ) : (
                              <span className="text-xs cc-text-muted">—</span>
                            )}
                          </Td>
                          <Td>
                            <Link className="text-sky-400 hover:underline text-xs" href={`/picks/${pick.id}`}>
                              Full audit
                            </Link>
                          </Td>
                        </tr>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <p className="text-xs cc-text-muted">
            Internal audit framing only. Settlement corrections never mutate the original record
            (settlement_records.corrects_id). Per-pick lifecycle and audit_log evidence available on
            the pick detail page.
          </p>
        </>
      ) : null}
    </div>
  );
}
