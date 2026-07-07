import Link from 'next/link';
import { Card, EmptyState, InternalLabelBadge, Table, TableHead, TableBody, Th, Td } from '@/components/ui';
import { getScheduledDispatch, type OutboxDispatchRow } from '@/lib/data/execution';

export const dynamic = 'force-dynamic';

function DispatchTable({ rows, showNextAttempt }: { rows: OutboxDispatchRow[]; showNextAttempt: boolean }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHead>
          <tr>
            <Th>Pick</Th>
            <Th>Target</Th>
            <Th>Status</Th>
            <Th>Attempts</Th>
            {showNextAttempt ? <Th>Next Attempt</Th> : <Th>Queued At</Th>}
            <Th>Last Error</Th>
            <Th>Readiness</Th>
          </tr>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const pick = row.pick;
            const failed = row.status === 'failed' || Boolean(row.lastError);
            return (
              <tr key={row.id}>
                <Td>
                  <Link className="text-sky-400 hover:underline font-mono text-xs" href={`/picks/${row.pickId}`}>
                    {row.pickId.slice(0, 8)}…
                  </Link>
                  <div className="text-xs cc-text-muted">
                    {pick ? `${pick.market} · ${pick.selection}${pick.line !== null ? ` ${pick.line}` : ''}` : 'pick row unavailable'}
                  </div>
                </Td>
                <Td>{row.target}</Td>
                <Td>
                  <InternalLabelBadge label={failed ? 'Failed' : 'Pending'} />
                </Td>
                <Td>{row.attemptCount}</Td>
                <Td>
                  <span className="text-xs cc-text-muted">
                    {showNextAttempt ? row.nextAttemptAt ?? '—' : row.createdAt}
                  </span>
                </Td>
                <Td>
                  <span className="text-xs text-red-400">{row.lastError ?? '—'}</span>
                </Td>
                <Td>
                  {pick?.status === 'awaiting_approval' ? (
                    <InternalLabelBadge label="Approval Required" />
                  ) : pick ? (
                    <span className="text-xs cc-text-secondary">{pick.status}</span>
                  ) : (
                    <InternalLabelBadge label="Data Missing" />
                  )}
                </Td>
              </tr>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function ScheduledDispatchPage() {
  let data: Awaited<ReturnType<typeof getScheduledDispatch>> | null = null;
  let loadError: string | null = null;

  try {
    data = await getScheduledDispatch(50);
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Failed to load outbox';
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-lg font-bold text-gray-100">Scheduled Dispatch</h1>
        <p className="text-sm cc-text-secondary">
          Outbox-backed dispatch queue. The Postgres outbox is the only delivery queue; no
          operator-facing time-based scheduling exists yet.
        </p>
        {data ? <p className="text-xs cc-text-muted">Observed {data.observedAt}</p> : null}
      </div>

      {loadError ? (
        <Card title="Load error">
          <p className="text-sm text-red-400">{loadError}</p>
        </Card>
      ) : data ? (
        <>
          <div className="cc-surface p-5">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide cc-text-secondary">
              Next Dispatch Candidates (queued outbox rows)
            </h2>
            {data.queued.length === 0 ? (
              <EmptyState message="Outbox is drained" detail="No queued deliveries. New approved picks will appear here when enqueued." />
            ) : (
              <DispatchTable rows={data.queued} showNextAttempt={false} />
            )}
          </div>

          <div className="cc-surface p-5">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide cc-text-secondary">
              Retry Backoff (next_attempt_at)
            </h2>
            {data.retrying.length === 0 ? (
              <EmptyState message="No deliveries in retry backoff" />
            ) : (
              <DispatchTable rows={data.retrying} showNextAttempt />
            )}
          </div>

          <div className="cc-surface p-5">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide cc-text-secondary">
              Future: True Scheduled Dispatch
            </h2>
            <p className="text-sm cc-text-secondary">
              distribution_outbox has no dispatch-after / visible-at column — queued rows are claimed
              as soon as a worker polls. Contract types for the future capability live in
              <span className="font-mono text-xs"> src/lib/scheduled-dispatch-contract.ts</span>.
            </p>
            <p className="mt-2 text-xs cc-text-muted">
              {/* TODO(data-contract): needs dispatch_after column on distribution_outbox (or a
                  scheduled_dispatches table) plus a worker claim-query change before this section
                  can show real scheduled rows. No cancel/edit actions exist — no safe API endpoint. */}
              Data contract pending: dispatch_after semantics on distribution_outbox.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
