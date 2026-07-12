import Link from 'next/link';
import { StatCard, InternalLabelBadge, Table, TableHead, TableBody, Td, EmptyState, SeverityBadge, DegradedState } from '@/components/ui';
import { getReviewQueue, getHeldQueue } from '@/lib/data/queues';
import { getAwaitingApprovalPicks } from '@/lib/data/approvals-ops';

export const metadata = { title: 'Approvals — Unit Talk Command Center' };
import {
  classifyApproval,
  compareApprovalLabels,
  ageHoursFrom,
  ageUrgency,
  humanizeAgeHours,
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

interface CockpitLoad {
  rows: CockpitRow[];
  degraded: string[];
}

async function loadCockpitRows(nowMs: number): Promise<CockpitLoad> {
  const [review, held, awaiting] = await Promise.all([
    getReviewQueue({}),
    getHeldQueue({}),
    getAwaitingApprovalPicks(),
  ]);

  const degraded: string[] = [];
  if (review.degraded) degraded.push(`review queue: ${review.degraded}`);
  if (held.degraded) degraded.push(`held queue: ${held.degraded}`);

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

  return { rows, degraded };
}

type SortKey = 'age' | 'score' | 'label' | 'queue';

function sortRows(rows: CockpitRow[], sort: SortKey, dir: 'asc' | 'desc'): CockpitRow[] {
  const mult = dir === 'asc' ? 1 : -1;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    switch (sort) {
      case 'score':
        return mult * ((a.score ?? -Infinity) - (b.score ?? -Infinity));
      case 'age':
        return mult * ((a.ageHours ?? -1) - (b.ageHours ?? -1));
      case 'queue':
        return mult * a.queue.localeCompare(b.queue);
      case 'label':
      default:
        return mult * -compareApprovalLabels(a.label, b.label) || (b.ageHours ?? 0) - (a.ageHours ?? 0);
    }
  });
  return sorted;
}

const URGENCY_CLASSES: Record<string, string> = {
  fresh: 'text-gray-400',
  aging: 'text-amber-300',
  stale: 'text-orange-400',
  critical: 'text-red-400 font-semibold',
};

function SortHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  align,
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  currentDir: 'asc' | 'desc';
  align?: 'right';
}) {
  const active = currentSort === sortKey;
  const nextDir = active && currentDir === 'desc' ? 'asc' : 'desc';
  return (
    <th className={`py-2 pr-4${align === 'right' ? ' text-right' : ''}`}>
      <Link
        href={`/operations/approvals?sort=${sortKey}&dir=${nextDir}`}
        className={`inline-flex items-center gap-1 hover:text-gray-200 ${active ? 'text-gray-200' : ''}`}
      >
        {label}
        <span className="text-[9px]">{active ? (currentDir === 'desc' ? '▼' : '▲') : '↕'}</span>
      </Link>
    </th>
  );
}

export default async function ApprovalsPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await searchParamsPromise;
  const sortRaw = typeof searchParams['sort'] === 'string' ? searchParams['sort'] : 'label';
  const sort: SortKey = (['age', 'score', 'label', 'queue'] as const).includes(sortRaw as SortKey)
    ? (sortRaw as SortKey)
    : 'label';
  const dir: 'asc' | 'desc' = searchParams['dir'] === 'asc' ? 'asc' : 'desc';

  const nowMs = Date.now();

  let load: CockpitLoad | null = null;
  let loadError: string | null = null;
  try {
    load = await loadCockpitRows(nowMs);
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
  }

  const rows = load ? sortRows(load.rows, sort, dir) : null;
  const countFor = (label: ApprovalLabel) => rows?.filter((row) => row.label === label).length ?? 0;

  // Grouped governance banner: collapse repeated per-row reasons into one
  // banner per reason with a count and the oldest since-date.
  const reasonGroups = new Map<string, { count: number; oldest: number | null }>();
  for (const row of rows ?? []) {
    const g = reasonGroups.get(row.reason) ?? { count: 0, oldest: null };
    g.count += 1;
    if (row.ageHours !== null && (g.oldest === null || row.ageHours > g.oldest)) g.oldest = row.ageHours;
    reasonGroups.set(row.reason, g);
  }
  const groupedReasons = Array.from(reasonGroups.entries()).sort((a, b) => b[1].count - a[1].count);
  const collapseReasons = groupedReasons.length > 0 && groupedReasons.length <= 3;
  const maxScore = Math.max(...(rows ?? []).map((r) => r.score ?? 0), 1);

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <p className="text-sm cc-text-muted">
          What can the PM approve right now? Governance-brake awaiting_approval picks, held picks, and the legacy review queue.
          Tier labels live in Linear and are not surfaced by the data layer yet.
        </p>
      </div>

      {load && load.degraded.length > 0 && (
        <DegradedState
          severity="warning"
          title="Partial data — counts exclude degraded source(s)"
          causes={load.degraded}
          action={{ label: 'Retry', href: '/operations/approvals' }}
        />
      )}

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

          {collapseReasons && rows.length > 0 && (
            <div className="cc-surface flex flex-col gap-2 p-4">
              {groupedReasons.map(([reason, g]) => (
                <div key={reason} className="flex flex-wrap items-baseline gap-2 text-xs">
                  <span className="cc-num rounded border border-gray-700 bg-gray-900/60 px-1.5 py-0.5 text-[10px] text-gray-300">
                    {g.count}
                  </span>
                  <span className="text-gray-300">{reason}</span>
                  {g.oldest !== null && (
                    <span className="cc-num cc-text-muted text-[10px]">oldest {humanizeAgeHours(g.oldest)}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="cc-surface p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide cc-text-secondary">
              Approval Queue ({rows.length})
            </h2>
            {rows.length === 0 ? (
              <EmptyState
                message="Nothing awaits approval."
                detail="No awaiting_approval, held, or pending-review picks. New governance-brake holds and operator holds appear here as they occur."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <SortHeader label="Label" sortKey="label" currentSort={sort} currentDir={dir} />
                    <th className="py-2 pr-4">Pick</th>
                    <th className="py-2 pr-4">Market / Selection</th>
                    <th className="py-2 pr-4">Sport</th>
                    <th className="py-2 pr-4">Capper</th>
                    <th className="py-2 pr-4">Source</th>
                    <SortHeader label="Score" sortKey="score" currentSort={sort} currentDir={dir} align="right" />
                    <SortHeader label="Queue" sortKey="queue" currentSort={sort} currentDir={dir} />
                    <SortHeader label="Age" sortKey="age" currentSort={sort} currentDir={dir} align="right" />
                    {!collapseReasons && <th className="py-2 pr-4">Why</th>}
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => {
                      const urgency = ageUrgency(row.ageHours);
                      return (
                        <tr key={row.id} className="border-b border-gray-800/60 transition-colors hover:bg-gray-800/30">
                          <Td><InternalLabelBadge label={row.label} /></Td>
                          <Td>
                            <Link href={row.href} className="cc-num text-xs text-blue-400 hover:underline">
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
                          <Td num align="right">
                            {row.score != null ? (
                              <span className="inline-flex items-center justify-end gap-2">
                                <span className="inline-block h-1 w-12 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
                                  <span
                                    className="block h-full rounded-full bg-blue-400/70"
                                    style={{ width: `${Math.round(((row.score ?? 0) / maxScore) * 100)}%` }}
                                  />
                                </span>
                                {row.score.toFixed(1)}
                              </span>
                            ) : (
                              '—'
                            )}
                          </Td>
                          <Td>{row.queue}</Td>
                          <Td num align="right">
                            <span className={URGENCY_CLASSES[urgency]} title={row.createdAt ?? undefined}>
                              {humanizeAgeHours(row.ageHours)}
                            </span>
                          </Td>
                          {!collapseReasons && <Td><span className="cc-text-muted">{row.reason}</span></Td>}
                        </tr>
                      );
                    })}
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
