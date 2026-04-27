/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDataClient } from './client.js';

// ── Shared internal type ─────────────────────────────────────────────────────

type Client = any;
type JsonObject = Record<string, unknown>;

// ── Public interfaces ────────────────────────────────────────────────────────

export interface ReviewPick {
  id: string;
  source: string;
  market: string;
  selection: string;
  line: number | null;
  odds: number | null;
  stake_units: number | null;
  promotion_score: number | null;
  created_at: string;
  status: string;
  approval_status: string;
  governanceQueueState?: string;
  metadata: Record<string, unknown>;
  eventName?: string | null;
  eventStartTime?: string | null;
  sportDisplayName?: string | null;
  capperDisplayName?: string | null;
  marketTypeDisplayName?: string | null;
  settlementResult?: string | null;
  reviewDecision?: string | null;
}

export interface HeldPick {
  id: string;
  source: string;
  market: string;
  selection: string;
  line: number | null;
  odds: number | null;
  stake_units: number | null;
  promotion_score: number | null;
  created_at: string;
  heldBy: string;
  heldAt: string;
  holdReason: string;
  ageHours: number;
  status: string;
  approval_status: string;
  governanceQueueState?: string;
  metadata?: Record<string, unknown>;
  eventName?: string | null;
  eventStartTime?: string | null;
  sportDisplayName?: string | null;
  capperDisplayName?: string | null;
  marketTypeDisplayName?: string | null;
  settlementResult?: string | null;
  reviewDecision?: string | null;
}

export interface PickDetail {
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
  confidence?: number | null;
  sport?: string | null;
  matchup?: string | null;
  eventStartTime?: string | null;
  capperName?: string | null;
  marketTypeLabel?: string | null;
  submittedBy: string | null;
  createdAt: string;
  postedAt: string | null;
  settledAt: string | null;
  submissionId: string | null;
  metadata: Record<string, unknown>;
}

export interface LifecycleRow {
  id: string;
  fromState: string | null;
  toState: string;
  writerRole: string;
  reason: string | null;
  createdAt: string;
}

export interface PromotionHistoryRow {
  id: string;
  target: string;
  status: string;
  score: number | null;
  version: string;
  decidedAt: string;
  decidedBy: string;
  overrideAction: string | null;
  reason: string | null;
}

export interface OutboxRow {
  id: string;
  target: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
  claimedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReceiptRow {
  id: string;
  outboxId: string;
  externalId: string | null;
  channel: string | null;
  status: string | null;
  recordedAt: string;
}

export interface SettlementRow {
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
  notes?: string | null;
  reviewReason?: string | null;
  clvRaw?: number | null;
  clvPercent?: number | null;
  beatsClosingLine?: boolean | null;
  clvStatus?: string | null;
  clvUnavailableReason?: string | null;
  clvResolvedMarketKey?: string | null;
  isOpeningLineFallback?: boolean | null;
  profitLossUnits?: number | null;
  gameResult?: {
    actualValue: number;
    marketKey: string;
    participantName: string | null;
    eventName: string | null;
    sourcedAt: string;
  } | null;
  outcomeExplanation?: string | null;
  correctedSettlement?: {
    id: string;
    result: string | null;
    settledAt: string | null;
    settledBy: string | null;
  } | null;
}

export interface AuditRow {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actor: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface PickDetailViewResponse {
  pick: PickDetail;
  lifecycle: LifecycleRow[];
  promotionHistory: PromotionHistoryRow[];
  outboxRows: OutboxRow[];
  receipts: ReceiptRow[];
  settlements: SettlementRow[];
  auditTrail: AuditRow[];
  submission: { id: string; payload: Record<string, unknown>; createdAt: string } | null;
}

// ── Accessor helpers ─────────────────────────────────────────────────────────

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asNumberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asBooleanOrNull(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function asRecord(v: unknown): JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {};
}

function asRecordOrNull(v: unknown): JsonObject | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// ── Fixture filter ────────────────────────────────────────────────────────────

function isFixtureLikePick(row: JsonObject): boolean {
  const metadata = asRecordOrNull(row['metadata']);
  if (!metadata) return false;
  return (
    typeof metadata['proof_fixture_id'] === 'string' ||
    typeof metadata['proof_script'] === 'string' ||
    typeof metadata['test_key'] === 'string'
  );
}

// ── Queue select columns ──────────────────────────────────────────────────────

const QUEUE_SELECT = [
  'id',
  'source',
  'market',
  'selection',
  'line',
  'odds',
  'stake_units',
  'promotion_score',
  'created_at',
  'status',
  'approval_status',
  'metadata',
  'promotion_target',
  'promotion_status',
  'sport_display_name',
  'capper_display_name',
  'market_type_display_name',
  'settlement_result',
  'review_decision',
  'review_decided_by',
  'review_decided_at',
  'posted_at',
  'settled_at',
  'event_name',
  'event_start_time',
].join(', ');

// ── Map a raw picks_current_state row to ReviewPick ───────────────────────────

function mapReviewPick(row: JsonObject): ReviewPick {
  const metadata = asRecord(row['metadata']);
  const governanceQueueState = asString(row['status']) === 'awaiting_approval'
    ? 'awaiting_approval'
    : undefined;

  return {
    id: asString(row['id']),
    source: asString(row['source']),
    market: asString(row['market']),
    selection: asString(row['selection']),
    line: asNumberOrNull(row['line']),
    odds: asNumberOrNull(row['odds']),
    stake_units: asNumberOrNull(row['stake_units']),
    promotion_score: asNumberOrNull(row['promotion_score']),
    created_at: asString(row['created_at']),
    status: asString(row['status']),
    approval_status: asString(row['approval_status']),
    governanceQueueState,
    metadata,
    eventName: asStringOrNull(row['event_name']),
    eventStartTime: asStringOrNull(row['event_start_time']),
    sportDisplayName: asStringOrNull(row['sport_display_name']),
    capperDisplayName: asStringOrNull(row['capper_display_name']),
    marketTypeDisplayName: asStringOrNull(row['market_type_display_name']),
    settlementResult: asStringOrNull(row['settlement_result']),
    reviewDecision: asStringOrNull(row['review_decision']),
  };
}

// ── getReviewQueue ────────────────────────────────────────────────────────────

export async function getReviewQueue(
  params: Record<string, string>,
): Promise<{ picks: ReviewPick[]; total: number }> {
  try {
    const client: Client = getDataClient();

    const limit = Math.min(Math.max(Number(params['limit'] ?? 50), 1), 200);
    const offset = Math.max(Number(params['offset'] ?? 0), 0);
    const source = params['source'];
    const sort = params['sort'] ?? 'created_at';
    const sortAsc = params['sortDir'] === 'asc';

    // Base query: awaiting_approval lifecycle OR pending approval_status
    let query = client
      .from('picks_current_state')
      .select(QUEUE_SELECT, { count: 'exact' })
      .or('status.eq.awaiting_approval,approval_status.eq.pending');

    // Exclude held picks (review_decision = 'hold')
    query = query.or('review_decision.is.null,review_decision.neq.hold');

    if (source) query = query.eq('source', source);

    query = query
      .order(sort, { ascending: sortAsc })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      console.error('getReviewQueue error:', error);
      return { picks: [], total: 0 };
    }

    const rows = (data ?? []) as JsonObject[];
    const picks = rows
      .filter((row) => !isFixtureLikePick(row))
      .map(mapReviewPick);

    return { picks, total: count ?? picks.length };
  } catch (err) {
    console.error('getReviewQueue exception:', err);
    return { picks: [], total: 0 };
  }
}

// ── getHeldQueue ──────────────────────────────────────────────────────────────

export async function getHeldQueue(
  params: Record<string, string>,
): Promise<{ picks: HeldPick[]; total: number }> {
  try {
    const client: Client = getDataClient();

    const limit = Math.min(Math.max(Number(params['limit'] ?? 50), 1), 200);
    const offset = Math.max(Number(params['offset'] ?? 0), 0);
    const source = params['source'];
    const sort = params['sort'] ?? 'review_decided_at';
    const sortAsc = params['sortDir'] === 'asc';

    // Base query: awaiting_approval OR pending, filtered to ONLY held (review_decision = 'hold')
    let query = client
      .from('picks_current_state')
      .select(QUEUE_SELECT, { count: 'exact' })
      .or('status.eq.awaiting_approval,approval_status.eq.pending')
      .eq('review_decision', 'hold');

    if (source) query = query.eq('source', source);

    query = query
      .order(sort, { ascending: sortAsc })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      console.error('getHeldQueue error:', error);
      return { picks: [], total: 0 };
    }

    const rows = (data ?? []) as JsonObject[];
    const now = Date.now();

    const picks: HeldPick[] = rows
      .filter((row) => !isFixtureLikePick(row))
      .map((row): HeldPick => {
        const metadata = asRecord(row['metadata']);
        const reviewDecidedAt = asStringOrNull(row['review_decided_at']);
        const heldAt = reviewDecidedAt ?? asString(row['created_at']);
        const heldBy = asString(row['review_decided_by'], 'unknown');

        // Hold reason: prefer audit log context in metadata, fallback to generic
        const holdReasonMeta = asStringOrNull(metadata['holdReason']) ??
          asStringOrNull(metadata['hold_reason']);
        const holdReason = holdReasonMeta ?? 'Held pending review';

        const ageMs = reviewDecidedAt
          ? now - new Date(reviewDecidedAt).getTime()
          : now - new Date(asString(row['created_at'])).getTime();
        const ageHours = Math.floor(ageMs / 3_600_000);

        const governanceQueueState = asString(row['status']) === 'awaiting_approval'
          ? 'awaiting_approval'
          : undefined;

        return {
          id: asString(row['id']),
          source: asString(row['source']),
          market: asString(row['market']),
          selection: asString(row['selection']),
          line: asNumberOrNull(row['line']),
          odds: asNumberOrNull(row['odds']),
          stake_units: asNumberOrNull(row['stake_units']),
          promotion_score: asNumberOrNull(row['promotion_score']),
          created_at: asString(row['created_at']),
          heldBy,
          heldAt,
          holdReason,
          ageHours,
          status: asString(row['status']),
          approval_status: asString(row['approval_status']),
          governanceQueueState,
          metadata,
          eventName: asStringOrNull(row['event_name']),
          eventStartTime: asStringOrNull(row['event_start_time']),
          sportDisplayName: asStringOrNull(row['sport_display_name']),
          capperDisplayName: asStringOrNull(row['capper_display_name']),
          marketTypeDisplayName: asStringOrNull(row['market_type_display_name']),
          settlementResult: asStringOrNull(row['settlement_result']),
          reviewDecision: asStringOrNull(row['review_decision']),
        };
      });

    return { picks, total: count ?? picks.length };
  } catch (err) {
    console.error('getHeldQueue exception:', err);
    return { picks: [], total: 0 };
  }
}

// ── searchPicks ───────────────────────────────────────────────────────────────

export async function searchPicks(
  params: Record<string, string>,
): Promise<{ picks: Array<Record<string, unknown>>; total: number; limit: number; offset: number }> {
  const DEFAULT_LIMIT = 25;
  const limit = Math.min(Math.max(Number(params['limit'] ?? DEFAULT_LIMIT), 1), 200);
  const offset = Math.max(Number(params['offset'] ?? 0), 0);

  try {
    const client: Client = getDataClient();

    const selectCols = [
      'id',
      'source',
      'market',
      'selection',
      'line',
      'odds',
      'stake_units',
      'promotion_score',
      'created_at',
      'status',
      'approval_status',
      'metadata',
      'sport_display_name',
      'capper_display_name',
      'market_type_display_name',
      'settlement_result',
      'review_decision',
      'event_name',
      'event_start_time',
      'promotion_target',
      'promotion_status',
    ].join(', ');

    let query = client
      .from('picks_current_state')
      .select(selectCols, { count: 'exact' });

    // Full-text / substring search on market + selection + source
    const q = params['q']?.trim();
    if (q) {
      query = query.or(
        `market.ilike.%${q}%,selection.ilike.%${q}%,source.ilike.%${q}%`,
      );
    }

    // Source filter
    const source = params['source']?.trim();
    if (source) query = query.eq('source', source);

    // Lifecycle status filter
    const status = params['status']?.trim();
    if (status) query = query.eq('status', status);

    // Approval status filter
    const approval = params['approval']?.trim();
    if (approval) query = query.eq('approval_status', approval);

    // Date range
    const dateFrom = params['dateFrom']?.trim();
    if (dateFrom) query = query.gte('created_at', dateFrom);

    const dateTo = params['dateTo']?.trim();
    if (dateTo) query = query.lte('created_at', dateTo);

    // Sort
    const sortCol = params['sort'] ?? 'created_at';
    const sortAsc = params['sortDir'] === 'asc';
    query = query
      .order(sortCol, { ascending: sortAsc })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      console.error('searchPicks error:', error);
      return { picks: [], total: 0, limit, offset };
    }

    const rows = (data ?? []) as JsonObject[];

    // Remap snake_case columns to camelCase expected by PickResultRow
    const picks: Array<Record<string, unknown>> = rows
      .filter((row) => !isFixtureLikePick(row))
      .map((row) => ({
        ...row,
        matchup: asStringOrNull(row['event_name']),
        eventStartTime: asStringOrNull(row['event_start_time']),
        sport: asStringOrNull(row['sport_display_name']),
        submitter: asStringOrNull(row['capper_display_name']),
      }));

    return { picks, total: count ?? picks.length, limit, offset };
  } catch (err) {
    console.error('searchPicks exception:', err);
    return { picks: [], total: 0, limit, offset };
  }
}

// ── getPickDetail ─────────────────────────────────────────────────────────────

export async function getPickDetail(pickId: string): Promise<PickDetailViewResponse | null> {
  try {
    const client: Client = getDataClient();

    // 1. Fetch pick from picks_current_state
    const pickResult = await client
      .from('picks_current_state')
      .select([
        'id',
        'source',
        'market',
        'selection',
        'line',
        'odds',
        'stake_units',
        'promotion_score',
        'created_at',
        'status',
        'approval_status',
        'metadata',
        'promotion_target',
        'promotion_status',
        'sport_display_name',
        'capper_display_name',
        'market_type_display_name',
        'settlement_result',
        'review_decision',
        'posted_at',
        'settled_at',
        'event_name',
        'event_start_time',
      ].join(', '))
      .eq('id', pickId)
      .single();

    if (pickResult.error || !pickResult.data) {
      return null;
    }

    const pickRow = pickResult.data as JsonObject;

    // 2. Parallel: lifecycle + promotion history + outbox + settlements
    const [lifecycleResult, promotionHistResult, outboxResult, settlementResult] = await Promise.all([
      client
        .from('pick_lifecycle')
        .select('id, pick_id, from_state, to_state, writer_role, reason, created_at')
        .eq('pick_id', pickId)
        .order('created_at', { ascending: false }),

      client
        .from('pick_promotion_history')
        .select('id, pick_id, promotion_target, status, score, policy_version, decided_at, decided_by, override_action, reason')
        .eq('pick_id', pickId)
        .order('decided_at', { ascending: false }),

      client
        .from('distribution_outbox')
        .select('id, pick_id, target, status, attempt_count, last_error, claimed_at, created_at, updated_at')
        .eq('pick_id', pickId)
        .order('created_at', { ascending: false }),

      client
        .from('settlement_records')
        .select('id, pick_id, result, status, confidence, evidence_ref, corrects_id, settled_by, settled_at, created_at, notes, review_reason, payload')
        .eq('pick_id', pickId)
        .order('created_at', { ascending: false }),
    ]);

    const lifecycleRows = (lifecycleResult.data ?? []) as JsonObject[];
    const promotionHistRows = (promotionHistResult.data ?? []) as JsonObject[];
    const outboxRows = (outboxResult.data ?? []) as JsonObject[];
    const settlementRows = (settlementResult.data ?? []) as JsonObject[];

    // 3. Sequential: receipts (needs outbox ids) + audit log + submission
    const outboxIds = outboxRows.map((r) => asString(r['id'])).filter(Boolean);

    const [receiptsResult, auditResult, submissionResult] = await Promise.all([
      outboxIds.length > 0
        ? client
          .from('distribution_receipts')
          .select('id, outbox_id, external_id, channel, status, recorded_at')
          .in('outbox_id', outboxIds)
          .order('recorded_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),

      client
        .from('audit_log')
        .select('id, entity_type, entity_id, action, actor, payload, created_at')
        .eq('entity_ref', pickId)
        .order('created_at', { ascending: false }),

      client
        .from('submissions')
        .select('id, pick_id, payload, created_at')
        .eq('pick_id', pickId)
        .limit(1)
        .maybeSingle(),
    ]);

    const receiptRows = (receiptsResult.data ?? []) as JsonObject[];
    const auditRows = (auditResult.data ?? []) as JsonObject[];
    const submissionRow = submissionResult.data as JsonObject | null;

    // ── Map pick ─────────────────────────────────────────────────────────────

    const metadata = asRecord(pickRow['metadata']);

    // Resolve capper/submittedBy from multiple fallback locations
    const submittedBy =
      asStringOrNull(metadata['submittedBy']) ??
      asStringOrNull(metadata['capper']) ??
      asStringOrNull(pickRow['capper_display_name']);

    // Resolve sport from view or metadata
    const sport =
      asStringOrNull(pickRow['sport_display_name']) ??
      asStringOrNull(metadata['sport']) ??
      asStringOrNull(metadata['league']);

    // Resolve matchup from event_name or metadata
    const matchup =
      asStringOrNull(pickRow['event_name']) ??
      asStringOrNull(metadata['eventName']);

    // Resolve eventStartTime from view or metadata
    const eventStartTime =
      asStringOrNull(pickRow['event_start_time']) ??
      asStringOrNull(metadata['eventStartTime']) ??
      asStringOrNull(metadata['eventTime']);

    // Resolve capperName from view or metadata
    const capperName =
      asStringOrNull(pickRow['capper_display_name']) ??
      asStringOrNull(metadata['capper']) ??
      submittedBy;

    // Resolve marketTypeLabel from view or metadata
    const marketTypeLabel =
      asStringOrNull(pickRow['market_type_display_name']) ??
      asStringOrNull(metadata['marketType']);

    // Resolve confidence
    const confidence = asNumberOrNull(metadata['confidence']);

    // Resolve submissionId from pick_id column on submission row
    const submissionId = submissionRow
      ? asStringOrNull(submissionRow['id'])
      : null;

    const pick: PickDetail = {
      id: asString(pickRow['id']),
      status: asString(pickRow['status']),
      approvalStatus: asString(pickRow['approval_status']),
      promotionStatus: asString(pickRow['promotion_status']),
      promotionTarget: asStringOrNull(pickRow['promotion_target']),
      promotionScore: asNumberOrNull(pickRow['promotion_score']),
      source: asString(pickRow['source']),
      market: asString(pickRow['market']),
      selection: asString(pickRow['selection']),
      line: asNumberOrNull(pickRow['line']),
      odds: asNumberOrNull(pickRow['odds']),
      stakeUnits: asNumberOrNull(pickRow['stake_units']),
      confidence,
      sport,
      matchup,
      eventStartTime,
      capperName,
      marketTypeLabel,
      submittedBy,
      createdAt: asString(pickRow['created_at']),
      postedAt: asStringOrNull(pickRow['posted_at']),
      settledAt: asStringOrNull(pickRow['settled_at']),
      submissionId,
      metadata,
    };

    // ── Map lifecycle ─────────────────────────────────────────────────────────

    const lifecycle: LifecycleRow[] = lifecycleRows.map((row) => ({
      id: asString(row['id']),
      fromState: asStringOrNull(row['from_state']),
      toState: asString(row['to_state']),
      writerRole: asString(row['writer_role']),
      reason: asStringOrNull(row['reason']),
      createdAt: asString(row['created_at']),
    }));

    // ── Map promotion history ─────────────────────────────────────────────────
    // promotion_target → target, policy_version → version

    const promotionHistory: PromotionHistoryRow[] = promotionHistRows.map((row) => ({
      id: asString(row['id']),
      target: asString(row['promotion_target']),
      status: asString(row['status']),
      score: asNumberOrNull(row['score']),
      version: asString(row['policy_version']),
      decidedAt: asString(row['decided_at']),
      decidedBy: asString(row['decided_by']),
      overrideAction: asStringOrNull(row['override_action']),
      reason: asStringOrNull(row['reason']),
    }));

    // ── Map outbox ────────────────────────────────────────────────────────────

    const outbox: OutboxRow[] = outboxRows.map((row) => ({
      id: asString(row['id']),
      target: asString(row['target']),
      status: asString(row['status']),
      attemptCount: asNumber(row['attempt_count']),
      lastError: asStringOrNull(row['last_error']),
      claimedAt: asStringOrNull(row['claimed_at']),
      createdAt: asString(row['created_at']),
      updatedAt: asString(row['updated_at']),
    }));

    // ── Map receipts ──────────────────────────────────────────────────────────

    const receipts: ReceiptRow[] = receiptRows.map((row) => ({
      id: asString(row['id']),
      outboxId: asString(row['outbox_id']),
      externalId: asStringOrNull(row['external_id']),
      channel: asStringOrNull(row['channel']),
      status: asStringOrNull(row['status']),
      recordedAt: asString(row['recorded_at']),
    }));

    // ── Map settlements (with CLV payload unpacking) ───────────────────────────

    const settlements: SettlementRow[] = settlementRows.map((row) => {
      const payload = asRecord(row['payload']);

      const clvRaw = asNumberOrNull(payload['clvRaw']);
      const clvPercent = asNumberOrNull(payload['clvPercent']);
      const beatsClosingLine = asBooleanOrNull(payload['beatsClosingLine']);
      const clvStatus = asStringOrNull(payload['clvStatus']);
      const clvUnavailableReason = asStringOrNull(payload['clvUnavailableReason']);
      const clvResolvedMarketKey = asStringOrNull(payload['clvResolvedMarketKey']);
      const isOpeningLineFallback = asBooleanOrNull(payload['isOpeningLineFallback']);
      const profitLossUnits = asNumberOrNull(payload['profitLossUnits']);
      const outcomeExplanation = asStringOrNull(payload['outcomeExplanation']);

      const hasClv = clvRaw !== null || clvPercent !== null;

      // gameResult sub-object
      const gameResultRaw = asRecordOrNull(payload['gameResult']);
      const gameResult = gameResultRaw
        ? {
          actualValue: asNumber(gameResultRaw['actualValue']),
          marketKey: asString(gameResultRaw['marketKey']),
          participantName: asStringOrNull(gameResultRaw['participantName']),
          eventName: asStringOrNull(gameResultRaw['eventName']),
          sourcedAt: asString(gameResultRaw['sourcedAt']),
        }
        : null;

      // correctedSettlement: populated when this row corrects another
      const correctsId = asStringOrNull(row['corrects_id']);
      const correctedSettlement = correctsId
        ? {
          id: correctsId,
          result: null as string | null,
          settledAt: null as string | null,
          settledBy: null as string | null,
        }
        : null;

      return {
        id: asString(row['id']),
        result: asStringOrNull(row['result']),
        status: asString(row['status']),
        confidence: asStringOrNull(row['confidence']),
        evidenceRef: asStringOrNull(row['evidence_ref']),
        correctsId,
        settledBy: asStringOrNull(row['settled_by']),
        settledAt: asStringOrNull(row['settled_at']),
        hasClv,
        createdAt: asString(row['created_at']),
        notes: asStringOrNull(row['notes']),
        reviewReason: asStringOrNull(row['review_reason']),
        clvRaw,
        clvPercent,
        beatsClosingLine,
        clvStatus,
        clvUnavailableReason,
        clvResolvedMarketKey,
        isOpeningLineFallback,
        profitLossUnits,
        gameResult,
        outcomeExplanation,
        correctedSettlement,
      };
    });

    // ── Map audit trail ───────────────────────────────────────────────────────

    const auditTrail: AuditRow[] = auditRows.map((row) => ({
      id: asString(row['id']),
      entityType: asString(row['entity_type']),
      entityId: asString(row['entity_id']),
      action: asString(row['action']),
      actor: asStringOrNull(row['actor']),
      payload: asRecord(row['payload']),
      createdAt: asString(row['created_at']),
    }));

    // ── Map submission ────────────────────────────────────────────────────────

    const submission = submissionRow
      ? {
        id: asString(submissionRow['id']),
        payload: asRecord(submissionRow['payload']),
        createdAt: asString(submissionRow['created_at']),
      }
      : null;

    return {
      pick,
      lifecycle,
      promotionHistory,
      outboxRows: outbox,
      receipts,
      settlements,
      auditTrail,
      submission,
    };
  } catch (err) {
    console.error('getPickDetail exception:', err);
    return null;
  }
}

// ── Re-export getDataClient for consumers that need it ────────────────────────
export { getDataClient } from './client.js';
