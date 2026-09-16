/**
 * UTV2-1907 (C1a) — canonical capper identity for the pipeline.
 *
 * `picks.capper_id` is the canonical attribution column. It carries a real
 * foreign key (`picks_capper_id_fkey` -> `cappers.id`) and is populated on the
 * write path by `derivePickForeignKeyCandidates` in
 * `packages/db/src/pick-foreign-keys.ts`.
 *
 * Every capper-facing read in this app previously re-derived identity from
 * `metadata.capper` and fell back to `pick.source` when that key was absent.
 * `source` is an intake *channel* — `smart-form`, `discord-bot`, `feed` — not a
 * capper. That fallback silently collapses every unattributed pick into a
 * pseudo-capper named after its channel, which is how two real cappers stop
 * being separable and how a channel acquires a performance record it never
 * earned.
 *
 * This module is the single resolution point. It reads the column, and it does
 * not fall back to anything. A pick with no `capper_id` resolves to the
 * explicit {@link UNATTRIBUTED_CAPPER} sentinel, which callers must refuse to
 * treat as a capper rather than aggregate under.
 */

/**
 * Explicit marker for a pick that carries no canonical capper attribution.
 *
 * It is deliberately not a valid `cappers.id` — it is a sentinel that reads as
 * an absence at every call site, so an unattributed pick can never be mistaken
 * for a capper with that name.
 */
export const UNATTRIBUTED_CAPPER = 'unattributed';

/** The shape this module needs: the canonical attribution column alone. */
export interface CapperAttributedRecord {
  capper_id?: string | null;
}

/**
 * Resolve the canonical capper identity of a persisted pick row.
 *
 * Returns the trimmed `capper_id` when the column holds a non-empty string, and
 * {@link UNATTRIBUTED_CAPPER} otherwise. There is no fallback to `source`, to
 * `metadata.capper`, or to `metadata.submittedBy`.
 */
export function resolveCapperIdentity(record: CapperAttributedRecord): string {
  const raw = typeof record.capper_id === 'string' ? record.capper_id.trim() : '';
  return raw.length > 0 ? raw : UNATTRIBUTED_CAPPER;
}

/**
 * True when an identity is the unattributed sentinel rather than a real capper.
 *
 * Aggregations, trust feedback and statistics must consult this before treating
 * an identity as a capper. Aggregating the sentinel would build one synthetic
 * "capper" out of every unattributed pick in the database — the same conflation
 * the `source` fallback produced, under a different name.
 */
export function isUnattributedCapper(identity: string): boolean {
  return identity === UNATTRIBUTED_CAPPER;
}
