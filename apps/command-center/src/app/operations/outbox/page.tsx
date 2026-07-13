import Link from 'next/link';
import { StatCard, InternalLabelBadge, Table, TableHead, TableBody, Th, Td, EmptyState, SeverityBadge } from '@/components/ui';
import type { InternalLabel } from '@/components/ui';
import { getOutboxOverview, OUTBOX_STATUSES, type OutboxOverview } from '@/lib/data/outbox';
import { formatRelativeAge } from '@/lib/fire-board-model';
import { describeThrown } from '@/lib/describe-error';

export const metadata = { title: 'Dispatch / Outbox — Unit Talk Command Center' };

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, InternalLabel> = {
  pending: 'Pending',
  processing: 'Pending',
  sent: 'Sent',
  failed: 'Failed',
  dead_letter: 'Dead Letter',
};

function readParam(searchParams: Record<string, string | string[] | undefined> | undefined, key: string) {
  const value = searchParams?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function pillHref(status?: string, target?: string) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (target) params.set('target', target);
  const query = params.toString();
  return query ? `/operations/outbox?${query}` : '/operations/outbox';
}

function FilterPill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-blue-500/50 bg-blue-500/20 text-blue-300'
          : 'border-gray-700 bg-gray-900/50 text-gray-400 hover:bg-gray-800'
      }`}
    >
      {children}
    </Link>
  );
}

export default async function OutboxOpsPage({
  searchParams: searchParamsPromise,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await searchParamsPromise;
  const status = readParam(searchParams, 'status');
  const target = readParam(searchParams, 'target');
  const nowMs = Date.now();
  const observedAt = new Date(nowMs).toISOString();

  let overview: OutboxOverview | null = null;
  let loadError: string | null = null;
  try {
    overview = await getOutboxOverview({ status, target });
  } catch (error) {
    loadError = describeThrown(error);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <p className="text-sm cc-text-muted">
          Are paid members receiving what they paid for? distribution_outbox + distribution_receipts, observed {observedAt}.
        </p>
      </div>

      {loadError ? (
        <div className="cc-surface p-5 border border-red-500/30">
          <div className="flex items-center gap-2">
            <SeverityBadge severity="critical" label="Load Failed" />
            <span className="text-sm text-gray-200">Outbox data could not be loaded.</span>
          </div>
          <p className="mt-2 text-xs cc-text-muted font-mono">{loadError}</p>
        </div>
      ) : overview ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <StatCard label="Pending" value={overview.counts.pending} />
            <StatCard label="Processing" value={overview.counts.processing} />
            <StatCard label="Sent" value={overview.counts.sent} />
            <StatCard label="Failed" value={overview.counts.failed} />
            <StatCard label="Dead Letter" value={overview.counts.dead_letter} />
            <div className="cc-surface p-5">
              <p className="text-xs font-semibold uppercase tracking-wide cc-text-secondary">Oldest Unsent</p>
              <p className="mt-1 text-lg font-bold text-gray-100">
                {formatRelativeAge(overview.oldestUnsentCreatedAt, nowMs) ?? '—'}
              </p>
              <p className="text-xs cc-text-muted" title={overview.oldestUnsentCreatedAt ?? undefined}>
                {overview.oldestUnsentCreatedAt ?? 'no unsent rows'}
              </p>
            </div>
          </div>

          <div className="cc-surface p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide cc-text-secondary">Filters</h2>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs cc-text-muted">Status:</span>
              <FilterPill href={pillHref(undefined, target)} active={!status}>All</FilterPill>
              {OUTBOX_STATUSES.map((s) => (
                <FilterPill key={s} href={pillHref(s, target)} active={status === s}>{s}</FilterPill>
              ))}
            </div>
            {overview.targets.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs cc-text-muted">Target:</span>
                <FilterPill href={pillHref(status, undefined)} active={!target}>All</FilterPill>
                {overview.targets.map((t) => (
                  <FilterPill key={t} href={pillHref(status, t)} active={target === t}>{t}</FilterPill>
                ))}
              </div>
            ) : null}
          </div>

          <div className="cc-surface p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide cc-text-secondary">
              Outbox Rows ({overview.rows.length}{status || target ? ' filtered' : ''})
            </h2>
            {overview.rows.length === 0 ? (
              <EmptyState
                message="No outbox rows match this filter."
                detail="Adjust the status/target pills above."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <Th>Pick</Th>
                    <Th>Status</Th>
                    <Th>Target</Th>
                    <Th>Attempts</Th>
                    <Th>Age</Th>
                    <Th>Created</Th>
                    <Th>Updated</Th>
                    <Th>Last error</Th>
                    <Th>Retry?</Th>
                  </TableHead>
                  <TableBody>
                    {overview.rows.map((row) => (
                      <tr key={row.id} className="border-b border-gray-800/60">
                        <Td>
                          <Link href={`/picks/${row.pickId}`} className="font-mono text-xs text-blue-400 hover:underline">
                            {row.pickId.slice(0, 8)}…
                          </Link>
                        </Td>
                        <Td><InternalLabelBadge label={STATUS_LABEL[row.status] ?? 'Pending'} /></Td>
                        <Td>{row.target}</Td>
                        <Td>{row.attemptCount}</Td>
                        <Td>
                          <span title={row.createdAt}>{formatRelativeAge(row.createdAt, nowMs) ?? '—'}</span>
                        </Td>
                        <Td><span className="font-mono">{row.createdAt}</span></Td>
                        <Td><span className="font-mono">{row.updatedAt}</span></Td>
                        <Td>
                          {row.lastError ? (
                            <span className="text-red-300" title={row.lastError}>
                              {row.lastError.length > 60 ? `${row.lastError.slice(0, 60)}…` : row.lastError}
                            </span>
                          ) : (
                            '—'
                          )}
                        </Td>
                        <Td>{row.retryEligible ? <InternalLabelBadge label="Retryable" /> : 'no'}</Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="cc-surface p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide cc-text-secondary">
              Recent Receipts ({overview.recentReceipts.length})
            </h2>
            {overview.recentReceipts.length === 0 ? (
              <EmptyState message="No delivery receipts recorded yet." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <Th>Recorded</Th>
                    <Th>Age</Th>
                    <Th>Channel</Th>
                    <Th>Type</Th>
                    <Th>Status</Th>
                    <Th>Outbox</Th>
                  </TableHead>
                  <TableBody>
                    {overview.recentReceipts.map((receipt) => (
                      <tr key={receipt.id} className="border-b border-gray-800/60">
                        <Td><span className="font-mono">{receipt.recordedAt}</span></Td>
                        <Td>{formatRelativeAge(receipt.recordedAt, nowMs) ?? '—'}</Td>
                        <Td>{receipt.channel ?? '—'}</Td>
                        <Td>{receipt.receiptType}</Td>
                        <Td>{receipt.status}</Td>
                        <Td><span className="font-mono text-xs">{receipt.outboxId.slice(0, 8)}…</span></Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
