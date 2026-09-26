/**
 * Effective settlement reader for operator research scripts.
 *
 * A pick's result is the tip of its correction chain (`corrects_id` -> prior
 * record), never its root. Filtering `settlement_records` with
 * `.is('corrects_id', null)` reports every corrected pick with its superseded
 * result.
 *
 * This reader:
 *   1. selects candidate picks by their ROOT record's date window (the scripts'
 *      existing semantics), paging with an ordered `range` because PostgREST
 *      caps every response at 1000 rows whatever `.limit()` asks for;
 *   2. loads EVERY record of every candidate pick (no date filter), in chunked
 *      `.in('pick_id', ...)` reads, so a window never cuts a chain;
 *   3. resolves each pick through `resolveEffectiveSettlement` and accepts the
 *      answer only when the chain is complete: every `corrects_id` target is
 *      present and `correction_depth + 1` equals the chain's row count.
 *      `resolveEffectiveSettlement` accepts a lone record without reading
 *      `corrects_id`, and for more rows silently ignores any row its walk does
 *      not reach, so those two checks are what make a partial chain refuse.
 *
 * A pick that does not resolve is reported as unresolved, never counted with
 * its root result.
 *
 * Read-only. The client is injected; this module never constructs one.
 */
import { resolveEffectiveSettlement, type SettlementInput } from '@unit-talk/domain';

/** PostgREST `max-rows`: no response carries more rows than this. */
export const PAGE_SIZE = 1000;
/** Pick ids per `.in('pick_id', ...)` request, to stay well under URL limits. */
export const PICK_ID_CHUNK_SIZE = 200;

const BASE_COLUMNS = 'id, pick_id, status, result, confidence, corrects_id, settled_at, created_at';

export interface ReadResult {
  data: unknown[] | null;
  error: { message: string } | null;
}

/** The minimal PostgREST query surface this reader uses. */
export interface ReadQuery extends PromiseLike<ReadResult> {
  is(column: string, value: null): ReadQuery;
  gte(column: string, value: string): ReadQuery;
  lt(column: string, value: string): ReadQuery;
  in(column: string, values: readonly string[]): ReadQuery;
  order(column: string, options?: { ascending?: boolean }): ReadQuery;
  range(from: number, to: number): ReadQuery;
}

export interface ReadClient {
  from(table: string): { select(columns: string): ReadQuery };
}

export interface ChainRow {
  id: string;
  pick_id: string;
  status: string;
  result: string | null;
  confidence: string;
  corrects_id: string | null;
  settled_at: string;
  created_at: string | null;
  /** The full row as read, including any caller-requested columns. */
  raw: Record<string, unknown>;
}

export interface EffectiveSettlementRow extends ChainRow {
  correctionDepth: number;
}

export interface UnresolvedPick {
  pickId: string;
  reason: string;
  rowCount: number;
}

export type ChainResolution =
  | { ok: true; row: ChainRow; correctionDepth: number }
  | { ok: false; reason: string };

export interface RootWindow {
  /** Column of the ROOT record the window applies to. */
  dateColumn: 'settled_at' | 'created_at';
  /** Inclusive lower bound (`>=`). */
  after?: string | null;
  /** Exclusive upper bound (`<`). */
  until?: string | null;
  /** Candidate order by `dateColumn`; defaults to newest first. */
  ascending?: boolean;
  /** Keep only the first N candidate picks in that order (a sample cap). */
  maxPicks?: number;
}

export interface EffectiveSettlementLoad {
  /** One row per resolved pick, in candidate order. */
  effective: EffectiveSettlementRow[];
  unresolved: UnresolvedPick[];
  candidatePickCount: number;
}

/**
 * Resolve one pick's full record set to its effective record, fail closed.
 */
export function resolveChain(rows: ChainRow[]): ChainResolution {
  if (rows.length === 0) return { ok: false, reason: 'NO_RECORDS' };
  const ids = new Set(rows.map((row) => row.id));
  if (rows.some((row) => row.corrects_id !== null && !ids.has(row.corrects_id))) {
    return { ok: false, reason: 'MISSING_CORRECTION_TARGET' };
  }
  if (rows.some((row) => row.status !== 'settled' && row.status !== 'manual_review')) {
    return { ok: false, reason: 'UNSUPPORTED_STATUS' };
  }
  const resolved = resolveEffectiveSettlement(
    rows.map(
      (row): SettlementInput => ({
        id: row.id,
        pick_id: row.pick_id,
        status: row.status as SettlementInput['status'],
        result: row.result,
        confidence: row.confidence,
        corrects_id: row.corrects_id,
        settled_at: row.settled_at,
      }),
    ),
  );
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  if (resolved.settlement.correction_depth + 1 !== rows.length) {
    return { ok: false, reason: 'CHAIN_DEPTH_MISMATCH' };
  }
  const row = rows.find((candidate) => candidate.id === resolved.settlement.effective_record_id);
  if (!row) return { ok: false, reason: 'EFFECTIVE_RECORD_NOT_FOUND' };
  return { ok: true, row, correctionDepth: resolved.settlement.correction_depth };
}

/**
 * Resolve every pick in `pickIds` (candidate order) from the loaded rows.
 */
export function resolveEffectiveSettlements(
  pickIds: readonly string[],
  rows: readonly ChainRow[],
): EffectiveSettlementLoad {
  const rowsByPick = new Map<string, ChainRow[]>();
  for (const row of rows) {
    const group = rowsByPick.get(row.pick_id);
    if (group) group.push(row);
    else rowsByPick.set(row.pick_id, [row]);
  }
  const effective: EffectiveSettlementRow[] = [];
  const unresolved: UnresolvedPick[] = [];
  for (const pickId of pickIds) {
    const group = rowsByPick.get(pickId) ?? [];
    const resolution = resolveChain(group);
    if (resolution.ok) {
      effective.push({ ...resolution.row, correctionDepth: resolution.correctionDepth });
    } else {
      unresolved.push({ pickId, reason: resolution.reason, rowCount: group.length });
    }
  }
  return { effective, unresolved, candidatePickCount: pickIds.length };
}

/**
 * Candidate pick ids, in window order, selected by their ROOT record's date.
 * Paged with an ordered `range` (date column, then id as a unique tiebreak).
 */
export async function fetchCandidatePickIds(
  client: ReadClient,
  window: RootWindow,
): Promise<string[]> {
  const ascending = window.ascending ?? false;
  const pickIds: string[] = [];
  const seen = new Set<string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = client
      .from('settlement_records')
      .select(`id, pick_id, ${window.dateColumn}`)
      .is('corrects_id', null);
    if (window.after) query = query.gte(window.dateColumn, window.after);
    if (window.until) query = query.lt(window.dateColumn, window.until);
    const { data, error } = await query
      .order(window.dateColumn, { ascending })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to fetch root settlement records: ${error.message}`);
    const page = data ?? [];
    for (const raw of page) {
      const pickId = readString(asRecord(raw)['pick_id']);
      if (pickId === null || seen.has(pickId)) continue;
      seen.add(pickId);
      pickIds.push(pickId);
      if (window.maxPicks !== undefined && pickIds.length >= window.maxPicks) return pickIds;
    }
    if (page.length < PAGE_SIZE) return pickIds;
  }
}

/**
 * Every settlement record of every given pick, whatever its date. Pick ids are
 * chunked; each chunk is paged with an ordered `range`.
 */
export async function fetchChainRows(
  client: ReadClient,
  pickIds: readonly string[],
  extraColumns = '',
): Promise<ChainRow[]> {
  const columns = extraColumns.trim().length > 0 ? `${BASE_COLUMNS}, ${extraColumns}` : BASE_COLUMNS;
  const unique = [...new Set(pickIds)];
  const rows: ChainRow[] = [];
  for (let start = 0; start < unique.length; start += PICK_ID_CHUNK_SIZE) {
    const chunk = unique.slice(start, start + PICK_ID_CHUNK_SIZE);
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await client
        .from('settlement_records')
        .select(columns)
        .in('pick_id', chunk)
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`Failed to fetch settlement chains: ${error.message}`);
      const page = data ?? [];
      for (const raw of page) rows.push(toChainRow(raw));
      if (page.length < PAGE_SIZE) break;
    }
  }
  return rows;
}

/**
 * Candidate picks by root window, then their whole chains, then resolution.
 */
export async function loadEffectiveSettlements(
  client: ReadClient,
  window: RootWindow,
  extraColumns = '',
): Promise<EffectiveSettlementLoad> {
  const pickIds = await fetchCandidatePickIds(client, window);
  const rows = await fetchChainRows(client, pickIds, extraColumns);
  return resolveEffectiveSettlements(pickIds, rows);
}

/** One-line operator summary of unresolved picks, grouped by reason. */
export function formatUnresolvedSummary(unresolved: readonly UnresolvedPick[]): string {
  if (unresolved.length === 0) return '0';
  const byReason = new Map<string, number>();
  for (const pick of unresolved) byReason.set(pick.reason, (byReason.get(pick.reason) ?? 0) + 1);
  const detail = [...byReason.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => `${reason}=${count}`)
    .join(', ');
  return `${unresolved.length} (${detail})`;
}

function toChainRow(value: unknown): ChainRow {
  const raw = asRecord(value);
  const id = readString(raw['id']);
  const pickId = readString(raw['pick_id']);
  const settledAt = readString(raw['settled_at']);
  if (id === null || pickId === null || settledAt === null) {
    throw new Error('Malformed settlement record: id, pick_id and settled_at are required');
  }
  return {
    id,
    pick_id: pickId,
    status: readString(raw['status']) ?? '',
    result: readString(raw['result']),
    confidence: readString(raw['confidence']) ?? '',
    corrects_id: readString(raw['corrects_id']),
    settled_at: settledAt,
    created_at: readString(raw['created_at']),
    raw,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
