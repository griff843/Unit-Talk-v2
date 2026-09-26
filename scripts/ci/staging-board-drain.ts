/**
 * WORK-2026092602 — drain leaked CI fixture picks off the staging best-bets board.
 *
 * The staging project is shared by every PR's "Writable DB proof (staging only)"
 * job. Several live proof suites leave picks behind that still hold best-bets
 * board capacity (`getPromotionBoardState`, packages/db/src/runtime-repositories.ts:
 * best-bets target, promotion_status qualified/promoted, source set, status not
 * settled/voided, created in the last 7 days, not Track Only). Measured
 * 2026-09-26 from CI run 36218675767: `currentBoardCount 476`, `sameSportCount 106`
 * against caps of 15 per slate and 10 per sport, so every staging proof that
 * expects a real best-bets decision got `not_eligible` for board cap.
 *
 * This module is the selection logic (pure, unit-tested) plus the one write it
 * performs. It is run only by `scripts/ci/seed-staging-fixtures.ts`, which has
 * already refused any target that is not the approved staging project.
 *
 * Selection is POSITIVE, never broad: a row is voided only if it matches one
 * named fixture signature in full — every field the writing suite stamps on it,
 * including the per-run id it embeds in the selection text. Hard exclusions run
 * first and no signature can override them:
 *   - a Track Only pick is never selected;
 *   - a row younger than the safety margin is never selected, so a concurrently
 *     running job's in-flight fixture is never voided under it;
 *   - a row that does not hold board capacity is never selected.
 *
 * What the write is and is not. It is an UPDATE, never a DELETE: the pick row,
 * its submission, its promotion history and its outbox rows all remain. It goes
 * through `transition_pick_lifecycle`, which compares-and-sets on `from_state`
 * and records a `pick_lifecycle` row naming this drain, so every void is
 * auditable and a row that changed state since it was read is left alone. It is
 * NOT reversible through the application: `voided` is terminal in the picks FSM
 * trigger (`picks_fsm_transition_guard`), so restoring a row would need an
 * operator write outside the FSM. That is acceptable only because every row it
 * touches is a positively identified CI fixture on the staging project.
 */
import type { BoundarySupabaseClient } from '@unit-talk/db/privileged-client-boundary';

export const BOARD_DRAIN_TARGET = 'best-bets';
/** Mirrors the 7-day window `getPromotionBoardState` counts. Older rows hold no capacity. */
export const BOARD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Rows younger than this are never selected: a concurrent job may still be asserting on them. */
export const DEFAULT_DRAIN_MARGIN_MS = 2 * 60 * 60 * 1000;
/** PostgREST caps every response at 1000 rows whatever `.limit()` asks, so reads page. */
const PAGE_SIZE = 1000;

const BOARD_PROMOTION_STATUSES = new Set(['qualified', 'promoted']);
/** Only states the picks FSM lets move to `voided` and that a leaked fixture sits in. */
const DRAINABLE_STATUSES = new Set(['validated', 'queued']);

export interface BoardDrainCandidate {
  id: string;
  source: string | null;
  market: string | null;
  selection: string | null;
  status: string | null;
  promotion_target: string | null;
  promotion_status: string | null;
  created_at: string | null;
  metadata: unknown;
}

export type FixtureSignatureId =
  | 't1-proof-atomicity-enqueue'
  | 'utv2-1022-risk-proof'
  | 'utv2-1251-reject-proof'
  | 'utv2-1842-server-authorized';

export type DrainSkipReason =
  | 'not_on_board'
  | 'track_only'
  | 'not_drainable_status'
  | 'unparseable_created_at'
  | 'younger_than_margin'
  | 'outside_board_window'
  | 'no_fixture_signature';

export interface DrainSelection {
  selected: { row: BoardDrainCandidate; signature: FixtureSignatureId }[];
  skipped: Record<DrainSkipReason, number>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const RUN_ID_8 = /^[0-9a-f]{8}$/u;
const RISK_FIXTURE_ID = new RegExp(`^utv2-1022-risk-${UUID}$`, 'u');
const REJECT_SELECTION = new RegExp(`^UTV2-1251 REJECT PROOF ${UUID}$`, 'u');

/**
 * The fixture signatures, each copied from the suite that writes it. A row must
 * match every clause of one signature; there is no partial or fuzzy match.
 */
export function matchFixtureSignature(row: BoardDrainCandidate): FixtureSignatureId | null {
  const metadata = asRecord(row.metadata);
  if (!metadata) return null;

  // apps/api/src/t1-proof-atomicity.test.ts STEP 3 — inserted directly, `metadata: {}`,
  // then enqueued. Its submission source is `t1-enq`.
  if (
    row.source === 't1-proof' &&
    row.market === 'nba-total' &&
    row.selection === 'Over 220.5' &&
    Object.keys(metadata).length === 0
  ) {
    return 't1-proof-atomicity-enqueue';
  }

  if (row.source !== 'smart-form') return null;
  const proofIssue = metadata['proof_issue'];
  const hasDistributionMode = Object.prototype.hasOwnProperty.call(metadata, 'distributionMode');

  // apps/api/src/t1-proof-risk-score.test.ts — `selection` embeds `proof_fixture_id`.
  if (proofIssue === 'UTV2-1022' && row.market === 'nba-spread' && !hasDistributionMode) {
    const fixtureId = metadata['proof_fixture_id'];
    if (
      typeof fixtureId === 'string' &&
      RISK_FIXTURE_ID.test(fixtureId) &&
      row.selection === `UTV2-1022 RISK PROOF ${fixtureId}`
    ) {
      return 'utv2-1022-risk-proof';
    }
    return null;
  }

  // apps/api/src/t1-proof-utv2-1251-evidence-settlement.test.ts — the reject case.
  if (proofIssue === 'UTV2-1251-reject' && row.market === 'nba-spread' && !hasDistributionMode) {
    const runId = metadata['proof_run'];
    if (
      typeof runId === 'string' &&
      RUN_ID_8.test(runId) &&
      typeof row.selection === 'string' &&
      REJECT_SELECTION.test(row.selection)
    ) {
      return 'utv2-1251-reject-proof';
    }
    return null;
  }

  // apps/api/src/t1-proof-utv2-1842-fallback-event-gate.test.ts — the server-authorized
  // delivery-eligible case. Both the selection and the authorization's capper id embed
  // this run's own RUN_ID; a real operator submission carries neither.
  if (proofIssue === 'UTV2-1842' && row.market === 'nba-spread') {
    const runId = metadata['proof_run'];
    const authorization = asRecord(metadata['deliveryAuthorization']);
    if (
      typeof runId === 'string' &&
      RUN_ID_8.test(runId) &&
      metadata['distributionMode'] === 'delivery-eligible' &&
      row.selection === `utv2-1842-${runId}-server-authorized Challenger Alpha` &&
      authorization?.['capperId'] === `utv2-1938-proof-${runId}`
    ) {
      return 'utv2-1842-server-authorized';
    }
    return null;
  }

  return null;
}

export function selectLeakedBoardFixtures(
  rows: readonly BoardDrainCandidate[],
  now: Date,
  marginMs: number = DEFAULT_DRAIN_MARGIN_MS,
): DrainSelection {
  if (!Number.isFinite(marginMs) || marginMs < DEFAULT_DRAIN_MARGIN_MS) {
    // A shorter margin would let one job void another job's in-flight fixture.
    throw new Error(`drain margin must be at least ${DEFAULT_DRAIN_MARGIN_MS}ms, got ${marginMs}`);
  }
  const cutoff = now.getTime() - marginMs;
  const windowStart = now.getTime() - BOARD_WINDOW_MS;
  const skipped: Record<DrainSkipReason, number> = {
    not_on_board: 0,
    track_only: 0,
    not_drainable_status: 0,
    unparseable_created_at: 0,
    younger_than_margin: 0,
    outside_board_window: 0,
    no_fixture_signature: 0,
  };
  const selected: DrainSelection['selected'] = [];

  for (const row of rows) {
    if (
      row.promotion_target !== BOARD_DRAIN_TARGET ||
      !BOARD_PROMOTION_STATUSES.has(row.promotion_status ?? '') ||
      row.source === null
    ) {
      skipped.not_on_board += 1;
      continue;
    }
    if (asRecord(row.metadata)?.['distributionMode'] === 'track-only') {
      skipped.track_only += 1;
      continue;
    }
    if (!DRAINABLE_STATUSES.has(row.status ?? '')) {
      skipped.not_drainable_status += 1;
      continue;
    }
    const createdAt = row.created_at === null ? Number.NaN : Date.parse(row.created_at);
    if (!Number.isFinite(createdAt)) {
      skipped.unparseable_created_at += 1;
      continue;
    }
    if (createdAt >= cutoff) {
      skipped.younger_than_margin += 1;
      continue;
    }
    if (createdAt < windowStart) {
      skipped.outside_board_window += 1;
      continue;
    }
    const signature = matchFixtureSignature(row);
    if (!signature) {
      skipped.no_fixture_signature += 1;
      continue;
    }
    selected.push({ row, signature });
  }

  return { selected, skipped };
}

export interface DrainResult {
  scanned: number;
  voided: number;
  raced: number;
  bySignature: Record<FixtureSignatureId, number>;
  skipped: Record<DrainSkipReason, number>;
}

/**
 * Read every candidate row, select positively, and void each selected row
 * through the lifecycle FSM. Throws on any unexpected database error so the
 * caller can fail the job closed rather than run the suites on a dirty board.
 */
export async function drainLeakedBoardFixtures(
  client: BoundarySupabaseClient,
  options: { now?: Date; marginMs?: number } = {},
): Promise<DrainResult> {
  const now = options.now ?? new Date();
  const marginMs = options.marginMs ?? DEFAULT_DRAIN_MARGIN_MS;
  const cutoffIso = new Date(now.getTime() - marginMs).toISOString();
  const windowStartIso = new Date(now.getTime() - BOARD_WINDOW_MS).toISOString();

  const rows: BoardDrainCandidate[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('picks')
      .select('id,source,market,selection,status,promotion_target,promotion_status,created_at,metadata')
      .eq('promotion_target', BOARD_DRAIN_TARGET)
      .in('promotion_status', [...BOARD_PROMOTION_STATUSES])
      .in('status', [...DRAINABLE_STATUSES])
      .in('source', ['t1-proof', 'smart-form'])
      .gte('created_at', windowStartIso)
      .lt('created_at', cutoffIso)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`board drain read failed: ${error.message}`);
    const page = (data ?? []) as BoardDrainCandidate[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  // The query narrows the read; the pure selection is what decides. It re-applies
  // every exclusion, so a query that drifted could only select less, never more.
  const { selected, skipped } = selectLeakedBoardFixtures(rows, now, marginMs);
  const bySignature: Record<FixtureSignatureId, number> = {
    't1-proof-atomicity-enqueue': 0,
    'utv2-1022-risk-proof': 0,
    'utv2-1251-reject-proof': 0,
    'utv2-1842-server-authorized': 0,
  };
  let voided = 0;
  let raced = 0;
  for (const { row, signature } of selected) {
    const { error } = await client.rpc('transition_pick_lifecycle', {
      p_pick_id: row.id,
      p_from_state: row.status,
      p_to_state: 'voided',
      p_writer_role: 'operator_override',
      p_reason: `WORK-2026092602 staging CI fixture drain: ${signature} held best-bets board capacity`,
      p_payload: { drain: 'WORK-2026092602', signature, marginMs },
    });
    if (error) {
      // Compare-and-set lost: the row moved since it was read. Leave it alone.
      if (/INVALID_LIFECYCLE_TRANSITION|PICK_NOT_FOUND/u.test(error.message)) {
        raced += 1;
        continue;
      }
      throw new Error(`board drain void failed for pick ${row.id}: ${error.message}`);
    }
    voided += 1;
    bySignature[signature] += 1;
  }

  return { scanned: rows.length, voided, raced, bySignature, skipped };
}
