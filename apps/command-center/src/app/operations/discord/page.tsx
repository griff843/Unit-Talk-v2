import Link from 'next/link';
import { InternalLabelBadge, Table, TableHead, TableBody, Th, Td, EmptyState, SeverityBadge } from '@/components/ui';
import { getDiscordOpsSnapshot, type DiscordOpsSnapshot } from '@/lib/data/discord-ops';
import { formatRelativeAge } from '@/lib/fire-board-model';
import { describeThrown } from '@/lib/describe-error';

export const metadata = { title: 'Discord Control — Unit Talk Command Center' };

export const dynamic = 'force-dynamic';

function ShellSection({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="cc-surface p-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide cc-text-secondary">{title}</h2>
        <InternalLabelBadge label="Data Missing" />
      </div>
      <EmptyState message={`No data source for ${title.toLowerCase()} yet.`} detail={detail} />
    </div>
  );
}

export default async function DiscordOpsPage() {
  const nowMs = Date.now();
  const observedAt = new Date(nowMs).toISOString();

  let snapshot: DiscordOpsSnapshot | null = null;
  let loadError: string | null = null;
  try {
    snapshot = await getDiscordOpsSnapshot();
  } catch (error) {
    loadError = describeThrown(error);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <p className="text-sm cc-text-muted">
          Delivery truth derived from distribution_outbox + distribution_receipts. Observed {observedAt}.
        </p>
      </div>

      {loadError ? (
        <div className="cc-surface p-5 border border-red-500/30">
          <div className="flex items-center gap-2">
            <SeverityBadge severity="critical" label="Load Failed" />
            <span className="text-sm text-gray-200">Discord delivery data could not be loaded.</span>
          </div>
          <p className="mt-2 text-xs cc-text-muted font-mono">{loadError}</p>
        </div>
      ) : snapshot ? (
        <>
          <div className="cc-surface p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide cc-text-secondary">
              Per-Channel Delivery ({snapshot.channelStats.length} channels, last {snapshot.receiptsSampled} receipts)
            </h2>
            {snapshot.channelStats.length === 0 ? (
              <EmptyState message="No delivery receipts recorded yet." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <Th>Channel</Th>
                    <Th>Last success</Th>
                    <Th>Age</Th>
                    <Th>Success</Th>
                    <Th>Failure</Th>
                    <Th>Last receipt</Th>
                  </TableHead>
                  <TableBody>
                    {snapshot.channelStats.map((stat) => (
                      <tr key={stat.channel} className="border-b border-gray-800/60">
                        <Td><span className="font-mono">{stat.channel}</span></Td>
                        <Td><span className="font-mono">{stat.lastSuccessAt ?? '—'}</span></Td>
                        <Td>{formatRelativeAge(stat.lastSuccessAt, nowMs) ?? '—'}</Td>
                        <Td>{stat.successCount}</Td>
                        <Td>
                          <span className={stat.failureCount > 0 ? 'text-red-300' : undefined}>{stat.failureCount}</span>
                        </Td>
                        <Td><span className="font-mono">{stat.lastReceiptAt ?? '—'}</span></Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="cc-surface p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide cc-text-secondary">
              Failed Posts ({snapshot.failedPosts.length})
            </h2>
            {snapshot.failedPosts.length === 0 ? (
              <EmptyState message="No failed or dead-letter deliveries." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <Th>Pick</Th>
                    <Th>Target</Th>
                    <Th>Status</Th>
                    <Th>Attempts</Th>
                    <Th>Updated</Th>
                    <Th>Age</Th>
                    <Th>Last error</Th>
                  </TableHead>
                  <TableBody>
                    {snapshot.failedPosts.map((post) => (
                      <tr key={post.id} className="border-b border-gray-800/60">
                        <Td>
                          <Link href={`/picks/${post.pickId}`} className="font-mono text-xs text-blue-400 hover:underline">
                            {post.pickId.slice(0, 8)}…
                          </Link>
                        </Td>
                        <Td>{post.target}</Td>
                        <Td>
                          <InternalLabelBadge label={post.status === 'dead_letter' ? 'Dead Letter' : 'Failed'} />
                        </Td>
                        <Td>{post.attemptCount}</Td>
                        <Td><span className="font-mono">{post.updatedAt}</span></Td>
                        <Td>{formatRelativeAge(post.updatedAt, nowMs) ?? '—'}</Td>
                        <Td>
                          {post.lastError ? (
                            <span className="text-red-300" title={post.lastError}>
                              {post.lastError.length > 60 ? `${post.lastError.slice(0, 60)}…` : post.lastError}
                            </span>
                          ) : (
                            '—'
                          )}
                        </Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </>
      ) : null}

      {/* Shell sections — no data source yet; contracts in src/lib/discord-ops-contract.ts */}
      {/* TODO(data-contract): bot heartbeat, role/permission audits, and VIP-leakage
          scans must be persisted (or exposed via apps/api) before these leave shell state. */}
      <ShellSection
        title="Bot Health"
        detail="Needs bot heartbeat persisted to Supabase or exposed via apps/api (DiscordBotHealth contract)."
      />
      <ShellSection
        title="Role / Permission Audit"
        detail="Needs guild role audit snapshots (RolePermissionAuditRow contract)."
      />
      <ShellSection
        title="VIP Leakage Checks"
        detail="Needs channel-visibility scans comparing expected vs observed audience (VipLeakageCheck contract)."
      />
    </div>
  );
}
