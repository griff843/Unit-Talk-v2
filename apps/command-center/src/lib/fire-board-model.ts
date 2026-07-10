// Fire Board — pure aggregation model.
// Converts heterogeneous health inputs into a single ranked list of
// "what is broken and what matters most" items. No I/O in this module.

import type { Severity } from '@/components/ui';

export type FireBoardSeverity = Exclude<Severity, 'healthy'>;

export interface FireBoardItem {
  severity: FireBoardSeverity;
  system: string;
  title: string;
  detail: string;
  lastSeen: string | null;
  impact: string;
  nextAction: string;
  href?: string;
}

// ── Structural input types (subset of the real data-layer shapes) ───────────

export interface FireBoardExceptionCounts {
  failedDelivery: number;
  deadLetter: number;
  pendingManualReview: number;
  staleValidated: number;
  awaitingApprovalDrift: number;
  rerunCandidates: number;
  missingBookAliases: number;
  missingMarketAliases: number;
}

export interface FireBoardProviderCycleInput {
  overallStatus: 'healthy' | 'warning' | 'critical';
  trackedLanes: number;
  failedLanes: number;
  staleLanes: number;
  blockedLanes: number;
  proofRequiredLanes: number;
  latestUpdatedAt: string | null;
}

export interface FireBoardPipelineInput {
  overallStatus: string;
  itemsInFlight: number;
  errorCount: number;
  observedAt: string;
}

export interface FireBoardRuntimeInput {
  apiStatus: 'healthy' | 'degraded' | 'down';
  warnings: string[];
}

export interface FireBoardInputs {
  exceptions: FireBoardExceptionCounts | null;
  providerCycle: FireBoardProviderCycleInput | null;
  pipeline: FireBoardPipelineInput | null;
  runtime: FireBoardRuntimeInput | null;
  /** Set when the runtime health fetch itself failed. */
  runtimeUnavailable?: boolean;
  nowMs: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<FireBoardSeverity, number> = {
  critical: 0,
  warning: 1,
  'needs-pm': 2,
  info: 3,
};

export function severityRank(severity: FireBoardSeverity): number {
  return SEVERITY_RANK[severity];
}

export function sortFireBoardItems(items: FireBoardItem[]): FireBoardItem[] {
  return [...items].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

/** "3h ago", "12m ago", "2d ago" — or null for missing/unparseable timestamps. */
export function formatRelativeAge(iso: string | null | undefined, nowMs: number): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const deltaMs = Math.max(0, nowMs - then);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function countBySeverity(items: FireBoardItem[]): Record<FireBoardSeverity, number> {
  const counts: Record<FireBoardSeverity, number> = { critical: 0, warning: 0, 'needs-pm': 0, info: 0 };
  for (const item of items) counts[item.severity] += 1;
  return counts;
}

// ── Model ────────────────────────────────────────────────────────────────────

export function buildFireBoard(inputs: FireBoardInputs): FireBoardItem[] {
  const items: FireBoardItem[] = [];
  const nowIso = new Date(inputs.nowMs).toISOString();

  const ex = inputs.exceptions;
  if (ex) {
    if (ex.deadLetter > 0) {
      items.push({
        severity: 'critical',
        system: 'Outbox',
        title: `${ex.deadLetter} dead-letter deliveries`,
        detail: 'Outbox rows exhausted retries; paid members did not receive these picks.',
        lastSeen: nowIso,
        impact: 'Member-facing delivery loss',
        nextAction: 'Inspect and requeue in the outbox console',
        href: '/operations/outbox?status=dead_letter',
      });
    }
    if (ex.failedDelivery > 0) {
      items.push({
        severity: 'critical',
        system: 'Outbox',
        title: `${ex.failedDelivery} failed deliveries`,
        detail: 'Outbox rows in failed status awaiting retry or intervention.',
        lastSeen: nowIso,
        impact: 'Delayed member delivery',
        nextAction: 'Retry via /operations/outbox',
        href: '/operations/outbox?status=failed',
      });
    }
    if (ex.pendingManualReview > 0) {
      items.push({
        severity: 'needs-pm',
        system: 'Settlement',
        title: `${ex.pendingManualReview} settlements in manual review`,
        detail: 'Settlement records flagged manual_review and blocked until resolved.',
        lastSeen: nowIso,
        impact: 'Grading truth incomplete',
        nextAction: 'Resolve in results ops',
        href: '/operations/results',
      });
    }
    if (ex.awaitingApprovalDrift > 0) {
      items.push({
        severity: 'warning',
        system: 'Governance',
        title: `${ex.awaitingApprovalDrift} awaiting-approval picks drifting`,
        detail: 'Picks stuck in awaiting_approval with stale age or lifecycle mismatch.',
        lastSeen: nowIso,
        impact: 'Approval queue latency',
        nextAction: 'Review in approvals cockpit',
        href: '/operations/approvals',
      });
    }
    if (ex.staleValidated > 0) {
      items.push({
        severity: 'warning',
        system: 'Pipeline',
        title: `${ex.staleValidated} stale validated picks`,
        detail: 'Validated picks older than 48h that never progressed.',
        lastSeen: nowIso,
        impact: 'Picks silently expiring',
        nextAction: 'Rerun promotion or void from /exceptions',
        href: '/exceptions',
      });
    }
    const aliasGaps = ex.missingBookAliases + ex.missingMarketAliases;
    if (aliasGaps > 0) {
      items.push({
        severity: 'info',
        system: 'Ingestion',
        title: `${aliasGaps} provider alias gaps`,
        detail: `${ex.missingBookAliases} book + ${ex.missingMarketAliases} market keys have no alias mapping.`,
        lastSeen: nowIso,
        impact: 'Offers unmatched to canonical markets',
        nextAction: 'Add aliases (see /exceptions)',
        href: '/exceptions',
      });
    }
  }

  const pc = inputs.providerCycle;
  if (pc) {
    const age = formatRelativeAge(pc.latestUpdatedAt, inputs.nowMs);
    if (pc.failedLanes > 0 || pc.staleLanes > 0) {
      items.push({
        severity: 'critical',
        system: 'Provider cycles',
        title: `${pc.failedLanes} failed / ${pc.staleLanes} stale ingestion lanes`,
        detail: `Of ${pc.trackedLanes} tracked provider lanes. Last cycle update ${age ?? 'unknown'}.`,
        lastSeen: pc.latestUpdatedAt,
        impact: 'Odds/data freshness at risk',
        nextAction: 'Inspect provider cycle status',
        href: '/pipeline',
      });
    } else if (pc.blockedLanes > 0 || pc.proofRequiredLanes > 0 || pc.overallStatus === 'warning') {
      items.push({
        severity: 'warning',
        system: 'Provider cycles',
        title: `${pc.blockedLanes} blocked / ${pc.proofRequiredLanes} proof-required lanes`,
        detail: `Provider ingestion degraded. Last cycle update ${age ?? 'unknown'}.`,
        lastSeen: pc.latestUpdatedAt,
        impact: 'Merge-blocked provider data',
        nextAction: 'Inspect provider cycle status',
        href: '/pipeline',
      });
    }
  }

  const pipe = inputs.pipeline;
  if (pipe && pipe.overallStatus !== 'healthy') {
    const isCritical = /critical|blocked|down|failed/i.test(pipe.overallStatus);
    items.push({
      severity: isCritical ? 'critical' : 'warning',
      system: 'Pipeline',
      title: `Pipeline status: ${pipe.overallStatus}`,
      detail: `${pipe.itemsInFlight} items in flight, ${pipe.errorCount} errors observed.`,
      lastSeen: pipe.observedAt,
      impact: 'End-to-end pick flow degraded',
      nextAction: 'Open pipeline health',
      href: '/pipeline',
    });
  }

  if (inputs.runtimeUnavailable) {
    items.push({
      severity: 'warning',
      system: 'Runtime',
      title: 'Runtime health unavailable',
      detail: 'The API /health and /api/runtime/truth endpoints could not be reached from the Command Center.',
      lastSeen: nowIso,
      impact: 'Blind spot: API runtime state unknown',
      nextAction: 'Check apps/api process and API_BASE_URL',
      href: '/runtime-dashboard',
    });
  } else if (inputs.runtime) {
    if (inputs.runtime.apiStatus === 'down') {
      items.push({
        severity: 'critical',
        system: 'Runtime',
        title: 'API reports down',
        detail: inputs.runtime.warnings.join('; ') || 'API health endpoint reports down.',
        lastSeen: nowIso,
        impact: 'All mutations and delivery blocked',
        nextAction: 'Restart / inspect apps/api',
        href: '/runtime-dashboard',
      });
    } else if (inputs.runtime.apiStatus === 'degraded') {
      items.push({
        severity: 'warning',
        system: 'Runtime',
        title: 'API degraded',
        detail: inputs.runtime.warnings.join('; ') || 'API health endpoint reports degraded.',
        lastSeen: nowIso,
        impact: 'Runtime warnings active',
        nextAction: 'Open runtime dashboard',
        href: '/runtime-dashboard',
      });
    } else if (inputs.runtime.warnings.length > 0) {
      items.push({
        severity: 'info',
        system: 'Runtime',
        title: `${inputs.runtime.warnings.length} runtime warnings`,
        detail: inputs.runtime.warnings.join('; '),
        lastSeen: nowIso,
        impact: 'Informational',
        nextAction: 'Open runtime dashboard',
        href: '/runtime-dashboard',
      });
    }
  }

  return sortFireBoardItems(items);
}
