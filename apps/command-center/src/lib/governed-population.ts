import { governedDeliveryTargets, isGovernedDeliveryTarget } from '@unit-talk/contracts';

/**
 * The one positive definition of a pick that belongs to the operator-governed
 * cohort. The metadata contract requires every governed submission to carry a
 * `distributionMode` key; a source, capper, date, or fixture marker is not a
 * substitute for that identity.
 *
 * Keep the query form here as well as the in-memory form. A caller that reads
 * a relation must apply this helper before it can present or aggregate rows.
 */
export const GOVERNED_POPULATION_METADATA_PATH = 'metadata->distributionMode';

export type PickPopulation = 'governed' | 'fixtures';

type PopulationQuery<T> = {
  not: (column: string, operator: string, value: null) => T;
  is: (column: string, value: null) => T;
};

export function hasGovernedPopulationMetadata(row: Record<string, unknown>): boolean {
  const metadata = row['metadata'];
  return metadata !== null
    && typeof metadata === 'object'
    && !Array.isArray(metadata)
    && Object.hasOwn(metadata, 'distributionMode');
}

export function readPickPopulation(value: string | undefined): PickPopulation {
  return value === 'fixtures' ? 'fixtures' : 'governed';
}

/** Applies the exact PostgreSQL `metadata ? 'distributionMode'` membership test. */
export function applyPickPopulation<T extends PopulationQuery<T>>(query: T, population: PickPopulation): T {
  return population === 'governed'
    ? query.not(GOVERNED_POPULATION_METADATA_PATH, 'is', null)
    : query.is(GOVERNED_POPULATION_METADATA_PATH, null);
}

/**
 * Resolves a settlement row's pick against a governed-only map.
 *
 * The map is built from a query that already carries {@link applyPickPopulation},
 * so an absent id means the settlement belongs to the fixture corpus. Returning
 * `null` here is what keeps governed membership the *driving* predicate: the
 * alternative — substituting an empty object — silently admits the settlement
 * with an `unknown` source and null stake/odds, which distorts every units and
 * ROI figure computed from it.
 */
export function resolveGovernedPick<T>(picksById: Map<string, T>, pickId: string): T | null {
  return picksById.get(pickId) ?? null;
}

const OUTBOX_TARGET_TRANSPORT_PREFIX = 'discord:';

export type DeliveryTargetPopulation = 'governed' | 'non-governed';

/**
 * Outbox targets are transport addresses (`discord:best-bets`), while the
 * contracts registry owns the destination name (`best-bets`). Keep that
 * transport normalization here and delegate membership to the shared
 * contracts predicate; Command Center must not maintain its own target list.
 */
export function isGovernedOutboxTarget(target: unknown): boolean {
  if (typeof target !== 'string') return false;
  const deliveryTarget = target.startsWith(OUTBOX_TARGET_TRANSPORT_PREFIX)
    ? target.slice(OUTBOX_TARGET_TRANSPORT_PREFIX.length)
    : target;
  return isGovernedDeliveryTarget(deliveryTarget);
}

/**
 * The same membership, enumerated as the literal `target` values the outbox
 * stores, so the partition can be pushed into the query instead of being
 * applied after an unbounded read. Derived from the contracts registry — adding
 * a governed destination there extends this automatically.
 */
export const governedOutboxTargets: readonly string[] = governedDeliveryTargets.map(
  (target) => `${OUTBOX_TARGET_TRANSPORT_PREFIX}${target}`,
);

/** PostgREST list literal for `.not('target', 'in', ...)` — the complement. */
export function governedOutboxTargetListLiteral(): string {
  return `(${governedOutboxTargets.map((target) => `"${target}"`).join(',')})`;
}

export function filterDeliveryTargetPopulation<T extends { target: unknown }>(
  rows: T[],
  population: DeliveryTargetPopulation,
): T[] {
  return rows.filter((row) => isGovernedOutboxTarget(row.target) === (population === 'governed'));
}

/** Dead letters older than one day are retained as history, never live fires. */
export function isHistoricalDeadLetter(
  row: { status: unknown; updated_at: unknown },
  nowMs: number,
): boolean {
  if (row.status !== 'dead_letter' || typeof row.updated_at !== 'string') return false;
  const updatedAtMs = Date.parse(row.updated_at);
  return Number.isFinite(updatedAtMs) && nowMs - updatedAtMs >= 24 * 60 * 60 * 1000;
}
