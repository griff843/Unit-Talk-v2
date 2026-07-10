/* eslint-disable @typescript-eslint/no-explicit-any */
// Execution-zone reads (pick builder / discord preview / scheduled / results).
// Read-only, direct Supabase via getDataClient() — same idiom as queues.ts.
import { getDataClient } from './client';

type Client = any;
type JsonObject = Record<string, unknown>;

// ── Accessor helpers (mirrors queues.ts) ─────────────────────────────────────

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
function asRecord(v: unknown): JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {};
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface ExecutionPickRow {
  id: string;
  status: string;
  source: string;
  market: string;
  selection: string;
  line: number | null;
  odds: number | null;
  eventName: string | null;
  eventStartTime: string | null;
  sportDisplayName: string | null;
  createdAt: string;
  postedAt: string | null;
  settledAt: string | null;
  settlementResult: string | null;
  metadata: JsonObject;
}

export interface OutboxDispatchRow {
  id: string;
  pickId: string;
  target: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  claimedAt: string | null;
  claimedBy: string | null;
  createdAt: string;
  updatedAt: string;
  pick: ExecutionPickRow | null;
}

export interface SettlementSummaryRow {
  id: string;
  pickId: string;
  result: string | null;
  status: string;
  confidence: string | null;
  correctsId: string | null;
  settledBy: string | null;
  settledAt: string | null;
  createdAt: string;
}

export interface ReceiptSummaryRow {
  id: string;
  outboxId: string;
  pickId: string | null;
  externalId: string | null;
  channel: string | null;
  status: string | null;
  recordedAt: string;
}

export interface ResultsTrackingData {
  picks: ExecutionPickRow[];
  settlementsByPick: Record<string, SettlementSummaryRow[]>;
  receiptsByPick: Record<string, ReceiptSummaryRow[]>;
  stats: {
    dispatchedToday: number;
    pendingResults: number;
    settled: number;
    failedSettlement: number;
    stale48h: number;
  };
  observedAt: string;
}

const PICK_SELECT = [
  'id',
  'status',
  'source',
  'market',
  'selection',
  'line',
  'odds',
  'created_at',
  'posted_at',
  'settled_at',
  'settlement_result',
  'sport_display_name',
  'metadata',
].join(', ');

function mapPick(row: JsonObject): ExecutionPickRow {
  return {
    id: asString(row['id']),
    status: asString(row['status']),
    source: asString(row['source']),
    market: asString(row['market']),
    selection: asString(row['selection']),
    line: asNumberOrNull(row['line']),
    odds: asNumberOrNull(row['odds']),
    eventName:
      asStringOrNull(asRecord(row['metadata'])['eventName']) ??
      asStringOrNull(asRecord(row['metadata'])['event_name']),
    eventStartTime:
      asStringOrNull(asRecord(row['metadata'])['eventStartTime']) ??
      asStringOrNull(asRecord(row['metadata'])['eventTime']),
    sportDisplayName: asStringOrNull(row['sport_display_name']),
    createdAt: asString(row['created_at']),
    postedAt: asStringOrNull(row['posted_at']),
    settledAt: asStringOrNull(row['settled_at']),
    settlementResult: asStringOrNull(row['settlement_result']),
    metadata: asRecord(row['metadata']),
  };
}

// ── Discord preview reads ────────────────────────────────────────────────────

export async function listPreviewablePicks(limit = 25): Promise<ExecutionPickRow[]> {
  const client: Client = getDataClient();
  const { data, error } = await client
    .from('picks_current_state')
    .select(PICK_SELECT)
    .in('status', ['queued', 'awaiting_approval', 'posted'])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('listPreviewablePicks error:', error);
    return [];
  }
  return ((data ?? []) as JsonObject[]).map(mapPick);
}

export async function getExecutionPick(pickId: string): Promise<ExecutionPickRow | null> {
  const client: Client = getDataClient();
  const { data, error } = await client
    .from('picks_current_state')
    .select(PICK_SELECT)
    .eq('id', pickId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error('getExecutionPick error:', error);
    return null;
  }
  return mapPick(data as JsonObject);
}

// ── Scheduled dispatch reads ─────────────────────────────────────────────────
// distribution_outbox has no true scheduling column (see
// src/lib/scheduled-dispatch-contract.ts). We surface queued rows as
// "next dispatch candidates" plus failed rows with a next_attempt_at
// (retry-backoff) timestamp — the only real time semantics that exist.

export interface ScheduledDispatchData {
  queued: OutboxDispatchRow[];
  retrying: OutboxDispatchRow[];
  observedAt: string;
}

function mapOutbox(row: JsonObject, picksById: Map<string, ExecutionPickRow>): OutboxDispatchRow {
  const pickId = asString(row['pick_id']);
  return {
    id: asString(row['id']),
    pickId,
    target: asString(row['target']),
    status: asString(row['status']),
    attemptCount: asNumber(row['attempt_count']),
    lastError: asStringOrNull(row['last_error']),
    nextAttemptAt: asStringOrNull(row['next_attempt_at']),
    claimedAt: asStringOrNull(row['claimed_at']),
    claimedBy: asStringOrNull(row['claimed_by']),
    createdAt: asString(row['created_at']),
    updatedAt: asString(row['updated_at']),
    pick: picksById.get(pickId) ?? null,
  };
}

const OUTBOX_SELECT =
  'id, pick_id, target, status, attempt_count, last_error, next_attempt_at, claimed_at, claimed_by, created_at, updated_at';

export async function getScheduledDispatch(limit = 50): Promise<ScheduledDispatchData> {
  const observedAt = new Date().toISOString();
  const client: Client = getDataClient();

  const [queuedResult, retryingResult] = await Promise.all([
    client
      .from('distribution_outbox')
      .select(OUTBOX_SELECT)
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(limit),
    client
      .from('distribution_outbox')
      .select(OUTBOX_SELECT)
      .not('next_attempt_at', 'is', null)
      .in('status', ['failed', 'retrying', 'queued'])
      .order('next_attempt_at', { ascending: true })
      .limit(limit),
  ]);

  if (queuedResult.error) console.error('getScheduledDispatch queued error:', queuedResult.error);
  if (retryingResult.error) console.error('getScheduledDispatch retrying error:', retryingResult.error);

  const queuedRows = (queuedResult.data ?? []) as JsonObject[];
  const retryingRows = ((retryingResult.data ?? []) as JsonObject[]).filter(
    (r) => !queuedRows.some((q) => asString(q['id']) === asString(r['id'])),
  );

  const pickIds = Array.from(
    new Set([...queuedRows, ...retryingRows].map((r) => asString(r['pick_id'])).filter(Boolean)),
  );

  const picksById = new Map<string, ExecutionPickRow>();
  if (pickIds.length > 0) {
    const { data, error } = await client
      .from('picks_current_state')
      .select(PICK_SELECT)
      .in('id', pickIds);
    if (error) console.error('getScheduledDispatch picks error:', error);
    for (const row of (data ?? []) as JsonObject[]) {
      const pick = mapPick(row);
      picksById.set(pick.id, pick);
    }
  }

  return {
    queued: queuedRows.map((r) => mapOutbox(r, picksById)),
    retrying: retryingRows.map((r) => mapOutbox(r, picksById)),
    observedAt,
  };
}

// ── Results tracking reads ───────────────────────────────────────────────────

export async function getResultsTracking(limit = 100): Promise<ResultsTrackingData> {
  const observedAt = new Date().toISOString();
  const client: Client = getDataClient();

  const { data, error } = await client
    .from('picks_current_state')
    .select(PICK_SELECT)
    .in('status', ['posted', 'settled'])
    .order('posted_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    console.error('getResultsTracking picks error:', error);
    return {
      picks: [],
      settlementsByPick: {},
      receiptsByPick: {},
      stats: { dispatchedToday: 0, pendingResults: 0, settled: 0, failedSettlement: 0, stale48h: 0 },
      observedAt,
    };
  }

  const picks = ((data ?? []) as JsonObject[]).map(mapPick);
  const pickIds = picks.map((p) => p.id);

  const settlementsByPick: Record<string, SettlementSummaryRow[]> = {};
  const receiptsByPick: Record<string, ReceiptSummaryRow[]> = {};

  if (pickIds.length > 0) {
    const [settlementResult, outboxResult] = await Promise.all([
      client
        .from('settlement_records')
        .select('id, pick_id, result, status, confidence, corrects_id, settled_by, settled_at, created_at')
        .in('pick_id', pickIds)
        .order('created_at', { ascending: false }),
      client
        .from('distribution_outbox')
        .select('id, pick_id')
        .in('pick_id', pickIds),
    ]);

    if (settlementResult.error) console.error('getResultsTracking settlements error:', settlementResult.error);
    for (const raw of (settlementResult.data ?? []) as JsonObject[]) {
      const row: SettlementSummaryRow = {
        id: asString(raw['id']),
        pickId: asString(raw['pick_id']),
        result: asStringOrNull(raw['result']),
        status: asString(raw['status']),
        confidence: asStringOrNull(raw['confidence']),
        correctsId: asStringOrNull(raw['corrects_id']),
        settledBy: asStringOrNull(raw['settled_by']),
        settledAt: asStringOrNull(raw['settled_at']),
        createdAt: asString(raw['created_at']),
      };
      (settlementsByPick[row.pickId] ??= []).push(row);
    }

    if (outboxResult.error) console.error('getResultsTracking outbox error:', outboxResult.error);
    const outboxRows = (outboxResult.data ?? []) as JsonObject[];
    const outboxToPick = new Map<string, string>(
      outboxRows.map((r) => [asString(r['id']), asString(r['pick_id'])]),
    );
    const outboxIds = Array.from(outboxToPick.keys()).filter(Boolean);

    if (outboxIds.length > 0) {
      const receiptsResult = await client
        .from('distribution_receipts')
        .select('id, outbox_id, external_id, channel, status, recorded_at')
        .in('outbox_id', outboxIds)
        .order('recorded_at', { ascending: false });
      if (receiptsResult.error) console.error('getResultsTracking receipts error:', receiptsResult.error);
      for (const raw of (receiptsResult.data ?? []) as JsonObject[]) {
        const outboxId = asString(raw['outbox_id']);
        const pickId = outboxToPick.get(outboxId) ?? null;
        const row: ReceiptSummaryRow = {
          id: asString(raw['id']),
          outboxId,
          pickId,
          externalId: asStringOrNull(raw['external_id']),
          channel: asStringOrNull(raw['channel']),
          status: asStringOrNull(raw['status']),
          recordedAt: asString(raw['recorded_at']),
        };
        if (pickId) (receiptsByPick[pickId] ??= []).push(row);
      }
    }
  }

  // Stats — computed over the fetched window (most recent `limit` dispatched picks).
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  let dispatchedToday = 0;
  let pendingResults = 0;
  let settled = 0;
  let failedSettlement = 0;
  let stale48h = 0;

  for (const pick of picks) {
    if (pick.postedAt && new Date(pick.postedAt).getTime() >= todayStart.getTime()) dispatchedToday += 1;
    const settlements = settlementsByPick[pick.id] ?? [];
    // settlement_records.status vocabulary is 'settled' | 'manual_review'
    // (packages/contracts/src/settlement.ts); manual_review = settlement failed to auto-resolve.
    const hasFailedSettlement = settlements.some((s) => s.status === 'manual_review');
    if (hasFailedSettlement) failedSettlement += 1;
    if (pick.status === 'settled' || pick.settledAt) {
      settled += 1;
    } else {
      pendingResults += 1;
      if (pick.postedAt && now - new Date(pick.postedAt).getTime() > 48 * 3_600_000) stale48h += 1;
    }
  }

  return {
    picks,
    settlementsByPick,
    receiptsByPick,
    stats: { dispatchedToday, pendingResults, settled, failedSettlement, stale48h },
    observedAt,
  };
}
