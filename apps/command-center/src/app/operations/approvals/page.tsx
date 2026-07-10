import Link from 'next/link';
import { StatCard, InternalLabelBadge, Table, TableHead, TableBody, Th, Td, EmptyState, SeverityBadge } from '@/components/ui';
import { getReviewQueue, getHeldQueue } from '@/lib/data/queues';
import { getAwaitingApprovalPicks } from '@/lib/data/approvals-ops';
import {
  classifyApproval,
  compareApprovalLabels,
  ageHoursFrom,
  type ApprovalLabel,
  type ApprovalQueueSource,
} from '@/lib/approvals-model';

export const dynamic = 'force-dynamic';

interface CockpitRow {
  id: string;
  queue: ApprovalQueueSource;
  label: ApprovalLabel;
  reason: string;
  market: string | null;
  selection: string | null;
  source: string | null;
  sport: string | null;
  capper: string | null;
  score: number | null;
  createdAt: string | null;
  ageHours: number | null;
  href: string;
}

async function loadCockpitRows(nowMs: number): Promise<CockpitRow[]> {
  const [review, held, awaiting] = await Promise.all([
    getReviewQueue({}),
    getHeldQueue({}),
    getAwaitingApprovalPicks(),
  ]);

  const rows: CockpitRow[] = [];
  const seen = new Set<string>();

  for (const pick of awaiting) {
    const classification = classifyApproval({
      id: pick.id,
      queue: 'awaiting_approval',
      status: pick.status,
      approvalStatus: pick.approvalStatus,
      createdAt: pick.createdAt,
    });
    seen.add(pick.id);
    rows.push({
      id: pick.id,
      queue: 'awaiting_approval',
      label: classification.label,
      reason: classification.reason,
      market: pick.market,
      selection: pick.selection,
      source: pick.source,
      sport: pick.sportDisplayName,
      capper: pick.capperDisplayName,
      score: pick.promotionScore,
      createdAt: pick.createdAt,
      ageHours: ageHoursFrom(pick.createdAt, nowMs),
      href: `/picks/${pick.id}`,
    });
  }

  for (const pick of held.picks) {
    if (seen.has(pick.id)) continue;
    seen.add(pick.id);
    const classification = classifyApproval({
      id: pick.id,
      queue: 'held',
      status: pick.status,
      approvalStatus: pick.approval_status,
      governanceQueueState: pick.governanceQueueState ?? null,
      holdReason: pick.holdReason,
      createdAt: pick.created_at,
    });
    rows.push({
      id: pick.id,
      queue: 'held',
      label: classification.label,
      reason: classification.reason,
      market: pick.market,
      selection: pick.selection,
      source: pick.source,
      sport: pick.sportDisplayName ?? null,
      capper: pick.capperDisplayName ?? null,
      score: pick.promotion_score,
      createdAt: pick.created_at,
      ageHours: ageHoursFrom(pick.created_at, nowMs),
      href: `/picks/${pick.id}`,
    });
  }

  for (const pick of review.picks) {
    if (seen.has(pick.id)) continue;
    seen.add(pick.id);
    const classification = classifyApproval({
      id: pick.id,
      queue: 'review',
      status: pick.status,
      approvalStatus: pick.approval_status,
      governanceQueueState: pick.governanceQueueState ?? null,
      createdAt: pick.created_at,
    });
    rows.push({
      id: pick.id,
      queue: 'review',
      label: classification.label,
      reason: classification.reason,
      market: pick.market,
      selection: pick.selection,
      source: pick.source,
      sport: pick.sportDisplayName ?? null,
      capper: pick.capperDisplayName ?? null,
      score: pick.promotion_score,
      createdAt: pick.created_at,
      ageHours: ageHoursFrom(pick.created_at, nowMs),
      href: '/review',
    });
  }

  return rows.sort(
    (a, b) => compareApprovalLabels(a.label, b.label) || (b.ageHours ?? 0) - (a.ageHours ?? 0),
  );
}

export default async function ApprovalsPage() {
  const nowMs = Date.now();
  const observedAt = new Date(nowMs).toISOString();

  let rows: CockpitRow[] | null = null;
  let loadError: string | null = null;
  try {
    rows = await loadCockpitRows(nowMs);
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
  }

  const countFor = (label: ApprovalLabel) => rows?.filter((row) => row.label === label).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-lg font-bold text-gray-100">PM Approval Cockpit</h1>
        <p className="text-sm cc-text-muted">
          What can the PM approve right now? Governance-brake awaiting_approval picks, held picks, and the legacy review queue.
          Observed {observedAt}. Tier labels live in Linear and are not surfaced by the data layer yet.
        </p>
      </div>

      {loadError ? (
        <div className="cc-surface p-5 border border-red-500/30">
          <div className="flex items-center gap-2">
            <SeverityBadge severity="critical" label="Load Failed" />
            <span className="text-sm text-gray-200">Approval queues could not be loaded.</span>
          </div>
          <p className="mt-2 text-xs cc-text-muted font-mono">{loadError}</p>
        </div>
      ) : rows ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Approvalable" value={countFor('Approvalable')} />
            <StatCard label="Needs PM" value={countFor('Needs PM')} />
            <StatCard label="Needs Review" value={countFor('Needs Review')} />
            <StatCard label="Blocked" value={countFor('Blocked')} />
          </div>

          <div className="cc-surface p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide cc-text-secondary">
              Approval Queue ({rows.length})
            </h2>
            {rows.length === 0 ? (
              <EmptyState
                message="Nothing awaits approval."
                detail="No awaiting_approval, held, or pending-review picks."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <Th>Label</Th>
                    <Th>Pick</Th>
                    <Th>Market / Selection</Th>
                    <Th>Sport</Th>
                    <Th>Capper</Th>
                    <Th>Source</Th>
                    <Th>Score</Th>
                    <Th>Queue</Th>
                    <Th>Age</Th>
                    <Th>Created</Th>
                    <Th>Why</Th>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-b border-gray-800/60">
                        <Td><InternalLabelBadge label={row.label} /></Td>
                        <Td>
                          <Link href={row.href} className="font-mono text-xs text-blue-400 hover:underline">
                            {row.id.slice(0, 8)}…
                          </Link>
                        </Td>
                        <Td>
                          <span className="text-gray-100">{row.market ?? '—'}</span>
                          <span className="cc-text-muted"> / {row.selection ?? '—'}</span>
                        </Td>
                        <Td>{row.sport ?? '—'}</Td>
                        <Td>{row.capper ?? '—'}</Td>
                        <Td>{row.source ?? '—'}</Td>
                        <Td>{row.score != null ? row.score.toFixed(1) : '—'}</Td>
                        <Td>{row.queue}</Td>
                        <Td>
                          <span className={row.ageHours != null && row.ageHours >= 4 ? 'text-yellow-300' : undefined}>
                            {row.ageHours != null ? `${row.ageHours}h` : '—'}
                          </span>
                        </Td>
                        <Td><span className="font-mono" title={row.createdAt ?? undefined}>{row.createdAt ?? '—'}</span></Td>
                        <Td><span className="cc-text-muted">{row.reason}</span></Td>
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
