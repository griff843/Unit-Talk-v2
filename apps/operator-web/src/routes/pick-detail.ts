import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

export interface PickDetailView {
  pick: {
    id: string;
    status: string;
    approvalStatus: string;
    promotionStatus: string;
    promotionTarget: string | null;
    promotionScore: number | null;
    source: string;
    market: string;
    selection: string;
    line: number | null;
    odds: number | null;
    stakeUnits: number | null;
    submittedBy: string | null;
    createdAt: string;
    postedAt: string | null;
    settledAt: string | null;
    submissionId: string | null;
    metadata: Record<string, unknown>;
  };
  lifecycle: Array<{
    id: string;
    fromState: string | null;
    toState: string;
    writerRole: string;
    reason: string | null;
    createdAt: string;
  }>;
  promotionHistory: Array<{
    id: string;
    target: string;
    status: string;
    score: number | null;
    version: string;
    decidedAt: string;
    decidedBy: string;
    overrideAction: string | null;
    reason: string | null;
  }>;
  outboxRows: Array<{
    id: string;
    target: string;
    status: string;
    attemptCount: number;
    lastError: string | null;
    claimedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  receipts: Array<{
    id: string;
    outboxId: string;
    externalId: string | null;
    channel: string | null;
    status: string | null;
    recordedAt: string;
  }>;
  settlements: Array<{
    id: string;
    result: string | null;
    status: string;
    confidence: string | null;
    evidenceRef: string | null;
    correctsId: string | null;
    settledBy: string | null;
    settledAt: string | null;
    hasClv: boolean;
    createdAt: string;
  }>;
  auditTrail: Array<{
    id: string;
    entityType: string;
    entityId: string;
    action: string;
    actor: string | null;
    payload: Record<string, unknown>;
    createdAt: string;
  }>;
  submission: {
    id: string;
    payload: Record<string, unknown>;
    createdAt: string;
  } | null;
}

// Static fixture used by in-memory / demo providers
export const PICK_DETAIL_FIXTURE: PickDetailView = {
  pick: {
    id: 'pick-fixture-1',
    status: 'posted',
    approvalStatus: 'approved',
    promotionStatus: 'qualified',
    promotionTarget: 'best-bets',
    promotionScore: 82.5,
    source: 'smart-form',
    market: 'player-props',
    selection: 'LeBron James Over 25.5 pts',
    line: 25.5,
    odds: -110,
    stakeUnits: 1,
    submittedBy: 'griff843',
    createdAt: '2026-03-20T10:00:00.000Z',
    postedAt: '2026-03-20T10:05:00.000Z',
    settledAt: null,
    submissionId: 'sub-fixture-1',
    metadata: { promotionScores: { edge: 85, trust: 80, readiness: 90, uniqueness: 75, boardFit: 82 } },
  },
  lifecycle: [
    {
      id: 'lc-1',
      fromState: null,
      toState: 'validated',
      writerRole: 'submission-service',
      reason: null,
      createdAt: '2026-03-20T10:00:00.000Z',
    },
    {
      id: 'lc-2',
      fromState: 'validated',
      toState: 'queued',
      writerRole: 'distribution-service',
      reason: null,
      createdAt: '2026-03-20T10:01:00.000Z',
    },
    {
      id: 'lc-3',
      fromState: 'queued',
      toState: 'posted',
      writerRole: 'distribution-worker',
      reason: null,
      createdAt: '2026-03-20T10:05:00.000Z',
    },
  ],
  promotionHistory: [
    {
      id: 'ph-1',
      target: 'best-bets',
      status: 'qualified',
      score: 82.5,
      version: 'best-bets-v2',
      decidedAt: '2026-03-20T10:00:30.000Z',
      decidedBy: 'promotion-service',
      overrideAction: null,
      reason: null,
    },
  ],
  outboxRows: [
    {
      id: 'outbox-fixture-1',
      target: 'discord:best-bets',
      status: 'sent',
      attemptCount: 1,
      lastError: null,
      claimedAt: '2026-03-20T10:04:00.000Z',
      createdAt: '2026-03-20T10:01:00.000Z',
      updatedAt: '2026-03-20T10:05:00.000Z',
    },
  ],
  receipts: [
    {
      id: 'receipt-fixture-1',
      outboxId: 'outbox-fixture-1',
      externalId: 'discord-msg-12345',
      channel: 'discord:best-bets',
      status: 'sent',
      recordedAt: '2026-03-20T10:05:01.000Z',
    },
  ],
  settlements: [],
  auditTrail: [
    {
      id: 'audit-1',
      entityType: 'pick',
      entityId: 'pick-fixture-1',
      action: 'promotion.qualified',
      actor: 'promotion-service',
      payload: { target: 'best-bets', score: 82.5 },
      createdAt: '2026-03-20T10:00:30.000Z',
    },
    {
      id: 'audit-2',
      entityType: 'outbox',
      entityId: 'outbox-fixture-1',
      action: 'distribution.sent',
      actor: 'worker',
      payload: { target: 'discord:best-bets' },
      createdAt: '2026-03-20T10:05:00.000Z',
    },
  ],
  submission: {
    id: 'sub-fixture-1',
    payload: { market: 'player-props', selection: 'LeBron James Over 25.5 pts' },
    createdAt: '2026-03-20T09:59:00.000Z',
  },
};

export async function handlePickDetailRequest(
  _request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
  pickId: string,
): Promise<void> {
  if (!pickId) {
    writeJson(response, 400, { ok: false, error: { code: 'BAD_REQUEST', message: 'Pick ID is required' } });
    return;
  }

  // In-memory / demo providers: use fixture or 404
  const supabaseProvider = deps.provider as unknown as { _supabaseClient?: unknown };
  const hasSupabaseClient =
    typeof supabaseProvider === 'object' &&
    supabaseProvider !== null &&
    '_supabaseClient' in supabaseProvider;

  if (!hasSupabaseClient) {
    // Demo / in-memory path: return fixture for known ID, 404 for unknown
    if (pickId === PICK_DETAIL_FIXTURE.pick.id || pickId === 'known-id') {
      const view: PickDetailView =
        pickId === 'known-id'
          ? { ...PICK_DETAIL_FIXTURE, pick: { ...PICK_DETAIL_FIXTURE.pick, id: 'known-id' } }
          : PICK_DETAIL_FIXTURE;
      writeJson(response, 200, { ok: true, data: view });
      return;
    }

    writeJson(response, 404, { ok: false, error: { code: 'NOT_FOUND', message: `Pick not found: ${pickId}` } });
    return;
  }

  // Live database path — provider wraps a Supabase client
  const client = (deps.provider as unknown as { _supabaseClient: Record<string, unknown> })._supabaseClient;

  const supabase = client as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          single: () => Promise<{ data: unknown; error: unknown }>;
          order: (col: string, opts?: unknown) => Promise<{ data: unknown[]; error: unknown }>;
        };
        in: (col: string, vals: string[]) => Promise<{ data: unknown[]; error: unknown }>;
      };
    };
  };

  const [pickResult, lifecycleResult, promotionHistoryResult, outboxResult, settlementsResult, auditResult] =
    await Promise.all([
      supabase.from('picks').select('*').eq('id', pickId).single(),
      supabase.from('pick_lifecycle').select('*').eq('pick_id', pickId).order('created_at'),
      supabase.from('pick_promotion_history').select('*').eq('pick_id', pickId).order('created_at'),
      supabase.from('distribution_outbox').select('*').eq('pick_id', pickId).order('created_at'),
      supabase.from('settlement_records').select('*').eq('pick_id', pickId).order('created_at'),
      supabase.from('audit_log').select('*').eq('entity_ref', pickId).order('created_at'),
    ]);

  if ((pickResult as { error: unknown; data: unknown }).error || !(pickResult as { data: unknown }).data) {
    writeJson(response, 404, { ok: false, error: { code: 'NOT_FOUND', message: `Pick not found: ${pickId}` } });
    return;
  }

  const pick = (pickResult as { data: Record<string, unknown> }).data;
  const outboxRows = ((outboxResult as { data: unknown[] }).data ?? []) as Array<Record<string, unknown>>;
  const outboxIds = outboxRows.map((r) => r['id'] as string).filter(Boolean);

  const receiptsResult =
    outboxIds.length > 0
      ? await supabase.from('distribution_receipts').select('*').in('outbox_id', outboxIds)
      : { data: [] as unknown[] };

  const submissionId = pick['submission_id'] as string | null;
  const submissionResult: { data: unknown } | null = submissionId
    ? await supabase.from('submissions').select('*').eq('id', submissionId).single()
    : null;

  const lifecycle = ((lifecycleResult as { data: unknown[] }).data ?? []) as Array<Record<string, unknown>>;
  const promotionHistory = ((promotionHistoryResult as { data: unknown[] }).data ?? []) as Array<Record<string, unknown>>;
  const settlements = ((settlementsResult as { data: unknown[] }).data ?? []) as Array<Record<string, unknown>>;
  const audit = ((auditResult as { data: unknown[] }).data ?? []) as Array<Record<string, unknown>>;
  const receipts = ((receiptsResult as { data: unknown[] }).data ?? []) as Array<Record<string, unknown>>;
  const submission = submissionResult ? (submissionResult.data as Record<string, unknown> | null) : null;
  const submittedBy = readSubmittedBy(pick, submission);

  const view: PickDetailView = {
    pick: {
      id: pick['id'] as string,
      status: pick['status'] as string,
      approvalStatus: pick['approval_status'] as string,
      promotionStatus: pick['promotion_status'] as string,
      promotionTarget: (pick['promotion_target'] as string | null) ?? null,
      promotionScore: (pick['promotion_score'] as number | null) ?? null,
      source: pick['source'] as string,
      market: pick['market'] as string,
      selection: pick['selection'] as string,
      line: (pick['line'] as number | null) ?? null,
      odds: (pick['odds'] as number | null) ?? null,
      stakeUnits: (pick['stake_units'] as number | null) ?? null,
      submittedBy,
      createdAt: pick['created_at'] as string,
      postedAt: (pick['posted_at'] as string | null) ?? null,
      settledAt: (pick['settled_at'] as string | null) ?? null,
      submissionId: (pick['submission_id'] as string | null) ?? null,
      metadata: (pick['metadata'] as Record<string, unknown>) ?? {},
    },
    lifecycle: lifecycle.map((row) => ({
      id: row['id'] as string,
      fromState: (row['from_state'] as string | null) ?? null,
      toState: row['to_state'] as string,
      writerRole: (row['writer_role'] as string) ?? '',
      reason: (row['reason'] as string | null) ?? null,
      createdAt: row['created_at'] as string,
    })),
    promotionHistory: promotionHistory.map((row) => ({
      id: row['id'] as string,
      target: row['promotion_target'] as string,
      status: row['status'] as string,
      score: (row['score'] as number | null) ?? null,
      version: (row['policy_version'] as string) ?? '',
      decidedAt: row['decided_at'] as string,
      decidedBy: (row['decided_by'] as string) ?? '',
      overrideAction: (row['override_action'] as string | null) ?? null,
      reason: (row['reason'] as string | null) ?? null,
    })),
    outboxRows: outboxRows.map((row) => ({
      id: row['id'] as string,
      target: row['target'] as string,
      status: row['status'] as string,
      attemptCount: (row['attempt_count'] as number) ?? 0,
      lastError: (row['last_error'] as string | null) ?? null,
      claimedAt: (row['claimed_at'] as string | null) ?? null,
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    })),
    receipts: receipts.map((row) => ({
      id: row['id'] as string,
      outboxId: row['outbox_id'] as string,
      externalId: (row['external_id'] as string | null) ?? null,
      channel: (row['channel'] as string | null) ?? null,
      status: (row['status'] as string | null) ?? null,
      recordedAt: row['recorded_at'] as string,
    })),
    settlements: settlements.map((row) => ({
      id: row['id'] as string,
      result: (row['result'] as string | null) ?? null,
      status: row['status'] as string,
      confidence: (row['confidence'] as string | null) ?? null,
      evidenceRef: (row['evidence_ref'] as string | null) ?? null,
      correctsId: (row['corrects_id'] as string | null) ?? null,
      settledBy: (row['settled_by'] as string | null) ?? null,
      settledAt: (row['settled_at'] as string | null) ?? null,
      hasClv: hasClvPayload(row['payload']),
      createdAt: row['created_at'] as string,
    })),
    auditTrail: audit.map((row) => ({
      id: row['id'] as string,
      entityType: (row['entity_type'] as string) ?? '',
      entityId: (row['entity_id'] as string) ?? '',
      action: row['action'] as string,
      actor: (row['actor'] as string | null) ?? null,
      payload: (row['payload'] as Record<string, unknown>) ?? {},
      createdAt: row['created_at'] as string,
    })),
    submission: submission
      ? {
          id: submission['id'] as string,
          payload: (submission['payload'] as Record<string, unknown>) ?? {},
          createdAt: submission['created_at'] as string,
        }
      : null,
  };

  writeJson(response, 200, { ok: true, data: view });
}

function hasClvPayload(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return typeof record['clvRaw'] === 'number' || typeof record['clvPercent'] === 'number';
}

function readSubmittedBy(
  pick: Record<string, unknown>,
  submission: Record<string, unknown> | null,
): string | null {
  const metadata =
    typeof pick['metadata'] === 'object' &&
    pick['metadata'] !== null &&
    !Array.isArray(pick['metadata'])
      ? (pick['metadata'] as Record<string, unknown>)
      : null;
  const submissionPayload =
    submission != null &&
    typeof submission['payload'] === 'object' &&
    submission['payload'] !== null &&
    !Array.isArray(submission['payload'])
      ? (submission['payload'] as Record<string, unknown>)
      : null;

  const candidates = [
    pick['submitted_by'],
    submission?.['submitted_by'],
    metadata?.['capper'],
    metadata?.['submittedBy'],
    submissionPayload?.['submittedBy'],
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return null;
}
