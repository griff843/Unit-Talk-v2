'use client';

import { useEffect, useState, useTransition } from 'react';
import { loadPickDetail } from '@/app/actions/picks';
import { bulkReviewPicks, reviewPick, type ReviewDecision } from '@/app/actions/review';
import { PickIdentityPanel } from '@/components/PickIdentityPanel';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { PickDetailViewResponse } from '@/lib/data/queues';
import {
  buildOperatorPickCsv,
  filterOperatorPicks,
  sortOperatorPicks,
  type OperatorPickRow,
  type PicksSortKey,
  type PicksWorkflowFilters,
} from '@/lib/picks-workflow';

const TIER_STYLES: Record<string, string> = {
  S: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200',
  A: 'border-blue-500/40 bg-blue-500/10 text-blue-200',
  B: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  C: 'border-orange-500/40 bg-orange-500/10 text-orange-200',
  D: 'border-red-500/40 bg-red-500/10 text-red-200',
};

const STATUS_STYLES: Record<OperatorPickRow['statusLabel'], string> = {
  Pending: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  Approved: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  Rejected: 'border-red-500/40 bg-red-500/10 text-red-200',
};

function formatPct(value: number | null) {
  return value != null ? `${value.toFixed(1)}%` : '—';
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return '—';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function readString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function readNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function Toast({
  message,
  tone,
  onDismiss,
}: {
  message: string;
  tone: 'success' | 'error';
  onDismiss: () => void;
}) {
  return (
    <div
      className={`fixed right-5 top-5 z-50 rounded-lg border px-4 py-3 text-sm shadow-2xl ${
        tone === 'success'
          ? 'border-emerald-500/40 bg-emerald-950 text-emerald-100'
          : 'border-red-500/40 bg-red-950 text-red-100'
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <p>{message}</p>
        <button type="button" className="text-xs opacity-70 hover:opacity-100" onClick={onDismiss}>
          Close
        </button>
      </div>
    </div>
  );
}

function SkeletonShimmer({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-16 rounded-xl bg-gray-900/80" />
      ))}
    </div>
  );
}

function PickStatusBadge({ label }: { label: OperatorPickRow['statusLabel'] }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${STATUS_STYLES[label]}`}>
      {label}
    </span>
  );
}

function TierBadge({ tier }: { tier: string | null }) {
  return (
    <span
      className={`inline-flex min-w-8 justify-center rounded-full border px-2 py-1 text-[11px] font-semibold ${
        tier ? TIER_STYLES[tier] ?? 'border-gray-700 bg-gray-900 text-gray-300' : 'border-gray-700 bg-gray-900 text-gray-400'
      }`}
    >
      {tier ?? '—'}
    </span>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function KeyValueGrid({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <div className="text-[11px] uppercase tracking-wide text-gray-500">{item.label}</div>
          <div className="mt-1 break-all text-gray-200">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function PickDetailPanelBody({ detail }: { detail: PickDetailViewResponse }) {
  const { pick } = detail;
  const metadata = readObject(pick.metadata) ?? {};
  const promotionScores = readObject(metadata['promotionScores']);
  const domainAnalysis = readObject(metadata['domainAnalysis']);
  const tierRationale = readString(
    metadata['tierRationale'],
    metadata['bandReason'],
    domainAnalysis?.['summary'],
  );

  return (
    <div className="space-y-4">
      <Card>
        <div className="space-y-4">
          <PickIdentityPanel
            pickId={pick.id.slice(0, 12)}
            pick={{
              source: pick.source,
              market: pick.market,
              selection: pick.selection,
              line: pick.line,
              odds: pick.odds,
              metadata: pick.metadata,
              matchup: pick.matchup ?? null,
              eventStartTime: pick.eventStartTime ?? null,
              sport: pick.sport ?? null,
              submittedBy: pick.submittedBy,
              capperName: pick.capperName ?? null,
              marketTypeLabel: pick.marketTypeLabel ?? null,
              settlementResult: detail.settlements[0]?.result ?? null,
            }}
          />
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-gray-800 bg-gray-950/80 p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Lifecycle</div>
              <div className="mt-1 text-gray-100">{pick.status}</div>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-950/80 p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Approval</div>
              <div className="mt-1 text-gray-100">{pick.approvalStatus}</div>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-950/80 p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Promotion Score</div>
              <div className="mt-1 text-gray-100">{pick.promotionScore != null ? pick.promotionScore.toFixed(1) : '—'}</div>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-950/80 p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Confidence</div>
              <div className="mt-1 text-gray-100">{formatPct(readNumber(metadata['confidence'], pick.confidence))}</div>
            </div>
          </div>
        </div>
      </Card>

      <DetailSection title="Submission">
        <KeyValueGrid
          items={[
            { label: 'Submitted By', value: pick.submittedBy ?? '—' },
            { label: 'Capper', value: pick.capperName ?? '—' },
            { label: 'Sport', value: pick.sport ?? '—' },
            { label: 'Market Type', value: pick.marketTypeLabel ?? pick.market },
            { label: 'Created', value: formatTimestamp(pick.createdAt) },
            { label: 'Event Start', value: formatTimestamp(pick.eventStartTime) },
          ]}
        />
      </DetailSection>

      <DetailSection title="EV Breakdown">
        <KeyValueGrid
          items={[
            { label: 'Expected Value', value: formatPct(readNumber(metadata['ev'], metadata['expectedValue'], metadata['edgePercent'], metadata['edge'])) },
            { label: 'Promotion Score', value: pick.promotionScore != null ? pick.promotionScore.toFixed(1) : '—' },
            { label: 'Edge', value: promotionScores && typeof promotionScores['edge'] === 'number' ? String(promotionScores['edge']) : '—' },
            { label: 'Trust', value: promotionScores && typeof promotionScores['trust'] === 'number' ? String(promotionScores['trust']) : '—' },
            { label: 'Readiness', value: promotionScores && typeof promotionScores['readiness'] === 'number' ? String(promotionScores['readiness']) : '—' },
            { label: 'Board Fit', value: promotionScores && typeof promotionScores['boardFit'] === 'number' ? String(promotionScores['boardFit']) : '—' },
          ]}
        />
      </DetailSection>

      <DetailSection title="Tier Rationale">
        <p className="text-sm leading-6 text-gray-300">
          {tierRationale ?? 'No explicit tier rationale was persisted for this pick.'}
        </p>
      </DetailSection>

      <DetailSection title="Activity History">
        <div className="space-y-3 text-sm text-gray-300">
          {detail.lifecycle.slice(0, 5).map((row) => (
            <div key={row.id} className="rounded-lg border border-gray-800 bg-gray-900/70 p-3">
              <div className="font-medium text-gray-100">{row.fromState ?? '—'} → {row.toState}</div>
              <div className="mt-1 text-xs text-gray-500">{row.writerRole} • {formatTimestamp(row.createdAt)}</div>
              <div className="mt-2 text-xs text-gray-400">{row.reason ?? 'No reason recorded.'}</div>
            </div>
          ))}
          {detail.lifecycle.length === 0 ? <p className="text-xs text-gray-500">No lifecycle rows recorded.</p> : null}
        </div>
      </DetailSection>

      <DetailSection title="Audit Trail">
        <div className="space-y-3 text-sm text-gray-300">
          {detail.auditTrail.slice(0, 5).map((row) => (
            <div key={row.id} className="rounded-lg border border-gray-800 bg-gray-900/70 p-3">
              <div className="font-medium text-gray-100">{row.action}</div>
              <div className="mt-1 text-xs text-gray-500">{row.entityType} • {formatTimestamp(row.createdAt)}</div>
            </div>
          ))}
          {detail.auditTrail.length === 0 ? <p className="text-xs text-gray-500">No audit rows recorded.</p> : null}
        </div>
      </DetailSection>
    </div>
  );
}

export function PicksWorkflowClient({ initialPicks }: { initialPicks: OperatorPickRow[] }) {
  const [picks, setPicks] = useState(initialPicks);
  const [filters, setFilters] = useState<PicksWorkflowFilters>({
    sport: 'All',
    tiers: [],
    status: 'all',
    dateFrom: '',
    dateTo: '',
    search: '',
  });
  const [sortKey, setSortKey] = useState<PicksSortKey>('submitted');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeDecision, setActiveDecision] = useState<ReviewDecision | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [selectedPickId, setSelectedPickId] = useState<string | null>(null);
  const [selectedPickDetail, setSelectedPickDetail] = useState<PickDetailViewResponse | null>(null);
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [isMutating, startMutation] = useTransition();
  const [isLoadingDetail, startDetailTransition] = useTransition();

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const sports = Array.from(
    new Set(
      picks
        .map((pick) => pick.sport)
        .filter((sport): sport is string => typeof sport === 'string' && sport.length > 0),
    ),
  ).sort();
  const filtered = filterOperatorPicks(picks, filters);
  const sorted = sortOperatorPicks(filtered, sortKey, sortDirection);
  const selectedPick = selectedPickId ? picks.find((pick) => pick.id === selectedPickId) ?? null : null;
  const allVisibleSelected = sorted.length > 0 && sorted.every((pick) => selectedIds.includes(pick.id));

  function toggleTier(tier: string) {
    setFilters((current) => ({
      ...current,
      tiers: current.tiers.includes(tier) ? current.tiers.filter((value) => value !== tier) : [...current.tiers, tier],
    }));
  }

  function toggleSelection(pickId: string) {
    setSelectedIds((current) => (current.includes(pickId) ? current.filter((value) => value !== pickId) : [...current, pickId]));
  }

  function toggleSelectAll() {
    setSelectedIds(allVisibleSelected ? [] : sorted.map((pick) => pick.id));
  }

  function setSort(nextKey: PicksSortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(nextKey === 'submitted' ? 'desc' : 'asc');
  }

  function openDetail(pickId: string) {
    setSelectedPickId(pickId);
    setSelectedPickDetail(null);
    startDetailTransition(async () => {
      const detail = await loadPickDetail(pickId);
      setSelectedPickDetail(detail);
    });
  }

  function updateLocalPickState(ids: string[], decision: ReviewDecision) {
    setPicks((current) =>
      current.map((pick) => {
        if (!ids.includes(pick.id)) {
          return pick;
        }
        if (decision === 'approve') {
          return { ...pick, status: 'queued', approvalStatus: 'approved', reviewDecision: 'approve', statusLabel: 'Approved' };
        }
        if (decision === 'deny') {
          return { ...pick, status: 'voided', approvalStatus: 'rejected', reviewDecision: 'deny', statusLabel: 'Rejected' };
        }
        return pick;
      }),
    );
  }

  function handleReview(ids: string[], decision: ReviewDecision) {
    if (ids.length === 0 || decisionReason.trim().length === 0) {
      return;
    }

    startMutation(async () => {
      const result =
        ids.length === 1
          ? await reviewPick(ids[0]!, decision, decisionReason.trim())
          : await bulkReviewPicks(ids, decision, decisionReason.trim());

      if ('ok' in result) {
        if (!result.ok) {
          setToast({ tone: 'error', message: result.error });
          return;
        }
        updateLocalPickState(ids, decision);
        setToast({ tone: 'success', message: `${decision === 'approve' ? 'Approved' : 'Rejected'} pick and recorded the review decision.` });
      } else {
        const failedCount = result.failed.length;
        if (failedCount > 0) {
          setToast({ tone: 'error', message: `${failedCount} selected pick${failedCount === 1 ? '' : 's'} failed during bulk review.` });
          return;
        }
        updateLocalPickState(ids, decision);
        setToast({ tone: 'success', message: `${decision === 'approve' ? 'Approved' : 'Rejected'} ${ids.length} selected pick${ids.length === 1 ? '' : 's'}.` });
      }

      setDecisionReason('');
      setActiveDecision(null);
      if (ids.length > 1) {
        setSelectedIds([]);
      }
      if (ids.length === 1 && selectedPickId === ids[0]) {
        const detail = await loadPickDetail(ids[0]!);
        setSelectedPickDetail(detail);
      }
    });
  }

  function exportSelected() {
    const rows = picks.filter((pick) => selectedIds.includes(pick.id));
    const csv = buildOperatorPickCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `unit-talk-picks-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast({ tone: 'success', message: `Exported ${rows.length} selected pick${rows.length === 1 ? '' : 's'} to CSV.` });
  }

  return (
    <>
      {toast ? <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} /> : null}

      <div className="space-y-6">
        <Card>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {['All', ...sports].map((sport) => (
                <button
                  key={sport}
                  type="button"
                  onClick={() => setFilters((current) => ({ ...current, sport }))}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    filters.sport === sport
                      ? 'border-blue-500 bg-blue-500/15 text-blue-100'
                      : 'border-gray-700 bg-gray-900/70 text-gray-400 hover:border-gray-500 hover:text-gray-200'
                  }`}
                >
                  {sport}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {['S', 'A', 'B', 'C', 'D'].map((tier) => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => toggleTier(tier)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    filters.tiers.includes(tier)
                      ? TIER_STYLES[tier]
                      : 'border-gray-700 bg-gray-900/70 text-gray-400 hover:border-gray-500 hover:text-gray-200'
                  }`}
                >
                  {tier}
                </button>
              ))}
            </div>

            <div className="grid gap-3 lg:grid-cols-[160px_1fr_170px_170px]">
              <select
                value={filters.status}
                onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as PicksWorkflowFilters['status'] }))}
                className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200"
              >
                <option value="all">All statuses</option>
                <option value="Pending">Pending</option>
                <option value="Approved">Approved</option>
                <option value="Rejected">Rejected</option>
              </select>

              <input
                value={filters.search}
                onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                placeholder="Search player, team, capper, or pick"
                className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500"
              />

              <input
                type="date"
                value={filters.dateFrom}
                onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))}
                className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200"
              />

              <input
                type="date"
                value={filters.dateTo}
                onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))}
                className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200"
              />
            </div>
          </div>
        </Card>

        <Card title={`Operator Queue (${sorted.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-3 pr-3">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-gray-600 bg-gray-900"
                      aria-label="Select all visible picks"
                    />
                  </th>
                  {[
                    ['tier', 'Tier'],
                    ['player', 'Player'],
                    ['sport', 'Sport'],
                    ['market', 'Market'],
                    ['odds', 'Odds'],
                    ['ev', 'EV'],
                    ['confidence', 'Confidence'],
                    ['status', 'Status'],
                    ['submitted', 'Submitted'],
                  ].map(([key, label]) => (
                    <th key={key} className="py-3 pr-3">
                      <button type="button" className="flex items-center gap-1 text-left hover:text-gray-300" onClick={() => setSort(key as PicksSortKey)}>
                        {label}
                        <span className="text-[10px]">{sortKey === key ? (sortDirection === 'asc' ? '▲' : '▼') : '⇅'}</span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((pick) => (
                  <tr key={pick.id} className="border-b border-gray-900/80 transition-colors hover:bg-gray-900/70">
                    <td className="py-3 pr-3 align-top">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(pick.id)}
                        onChange={() => toggleSelection(pick.id)}
                        className="mt-1 h-4 w-4 rounded border-gray-600 bg-gray-900"
                        aria-label={`Select ${pick.id}`}
                      />
                    </td>
                    <td className="py-3 pr-3 align-top"><TierBadge tier={pick.tier} /></td>
                    <td className="py-3 pr-3 align-top">
                      <button type="button" className="block text-left" onClick={() => openDetail(pick.id)}>
                        <PickIdentityPanel
                          compact
                          pickId={pick.id.slice(0, 8)}
                          pick={{
                            source: pick.source,
                            market: pick.market,
                            selection: pick.selection,
                            line: pick.line,
                            odds: pick.odds,
                            metadata: pick.metadata,
                            matchup: pick.matchup,
                            eventStartTime: pick.eventStartTime,
                            sport: pick.sport,
                            submitter: pick.submitter,
                            capperDisplayName: pick.capperDisplayName,
                            marketTypeDisplayName: pick.marketTypeDisplayName,
                          }}
                        />
                      </button>
                    </td>
                    <td className="py-3 pr-3 align-top text-gray-300">{pick.sport ?? '—'}</td>
                    <td className="py-3 pr-3 align-top text-gray-300">{pick.marketTypeDisplayName ?? pick.market}</td>
                    <td className="py-3 pr-3 align-top text-gray-300">{pick.odds != null ? pick.odds : '—'}</td>
                    <td className="py-3 pr-3 align-top text-gray-300">{formatPct(pick.ev)}</td>
                    <td className="py-3 pr-3 align-top text-gray-300">{formatPct(pick.confidence)}</td>
                    <td className="py-3 pr-3 align-top"><PickStatusBadge label={pick.statusLabel} /></td>
                    <td className="py-3 align-top text-gray-400">{formatTimestamp(pick.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sorted.length === 0 ? <div className="py-10 text-center text-sm text-gray-500">No picks match the current operator filters.</div> : null}
          </div>
        </Card>
      </div>

      <div
        className={`fixed inset-y-0 right-0 z-40 w-full max-w-[420px] transform border-l border-gray-800 bg-gray-950/98 shadow-2xl transition-transform duration-300 ease-out ${
          selectedPickId ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-hidden={selectedPickId ? undefined : true}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between border-b border-gray-800 px-5 py-4">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Pick Detail</div>
              <div className="mt-1 text-sm font-semibold text-gray-100">{selectedPick?.selection ?? 'Loading pick'}</div>
            </div>
            <button type="button" className="text-sm text-gray-400 hover:text-gray-200" onClick={() => setSelectedPickId(null)}>
              Close
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {isLoadingDetail || (selectedPickId && !selectedPickDetail) ? <SkeletonShimmer rows={6} /> : null}
            {!isLoadingDetail && selectedPickDetail ? <PickDetailPanelBody detail={selectedPickDetail} /> : null}
          </div>

          {selectedPickId ? (
            <div className="border-t border-gray-800 px-5 py-4">
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-gray-500">
                Review Reason
              </label>
              <textarea
                value={decisionReason}
                onChange={(event) => setDecisionReason(event.target.value)}
                rows={3}
                placeholder="Required reason for operator approval or rejection"
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500"
              />
              <div className="mt-3 flex gap-2">
                <Button variant="success" size="sm" loading={isMutating && activeDecision === 'approve'} onClick={() => { setActiveDecision('approve'); handleReview([selectedPickId], 'approve'); }}>
                  Approve
                </Button>
                <Button variant="danger" size="sm" loading={isMutating && activeDecision === 'deny'} onClick={() => { setActiveDecision('deny'); handleReview([selectedPickId], 'deny'); }}>
                  Reject
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {selectedIds.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-800 bg-gray-950/95 px-4 py-4 shadow-[0_-12px_30px_rgba(0,0,0,0.35)] backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-100">{selectedIds.length} pick{selectedIds.length === 1 ? '' : 's'} selected</div>
              <textarea
                value={decisionReason}
                onChange={(event) => setDecisionReason(event.target.value)}
                rows={2}
                placeholder="Required reason for bulk approval or rejection"
                className="w-full min-w-[280px] rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 lg:w-[420px]"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="success" size="sm" loading={isMutating && activeDecision === 'approve'} onClick={() => { setActiveDecision('approve'); handleReview(selectedIds, 'approve'); }}>
                Approve
              </Button>
              <Button variant="danger" size="sm" loading={isMutating && activeDecision === 'deny'} onClick={() => { setActiveDecision('deny'); handleReview(selectedIds, 'deny'); }}>
                Reject
              </Button>
              <Button variant="secondary" size="sm" onClick={exportSelected}>
                Export CSV
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
                Clear
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
