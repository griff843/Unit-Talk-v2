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
