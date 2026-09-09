/**
 * The read/write classification of every method an `IngestorRepositoryBundle` exposes.
 *
 * This exists so a *behavioural* claim about the ingestor -- "a results-only run touches
 * only these tables" -- can be enforced by a test rather than re-derived by reading
 * `ingest-league.ts` every time somebody needs to bound a backfill's blast radius.
 * UTV2-1866: that reading was the only evidence available when Milestone 2 needed to
 * state what an operator-run results backfill would write, and a reading is not a
 * control -- an edit that moved one write out of the odds branch would be invisible.
 *
 * Keys are `<repository>.<method>`. `INGESTOR_WRITE_SURFACE` maps a write to the
 * physical table it touches; `INGESTOR_READ_SURFACE` names the reads explicitly rather
 * than treating "not a write" as the default, so a newly added method fails the
 * completeness assertion in `ingestor.test.ts` instead of being silently classified.
 */
export const INGESTOR_WRITE_SURFACE: Readonly<Record<string, string>> = Object.freeze({
  'providerOffers.upsertBatch': 'provider_offers',
  'providerOffers.upsertCurrentOffer': 'provider_offers',
  'providerOffers.stageBatch': 'provider_offers_staging',
  'providerOffers.mergeStagedCycle': 'provider_offers',
  'providerOffers.upsertCycleStatus': 'provider_offer_cycle_status',
  'providerOffers.markClosingLines': 'provider_offers',
  'runs.startRun': 'system_runs',
  'runs.completeRun': 'system_runs',
  'runs.reapStaleRuns': 'system_runs',
  'events.upsertByExternalId': 'events',
  'eventParticipants.upsert': 'event_participants',
  'participants.upsertByExternalId': 'participants',
  'participants.updateMetadata': 'participants',
  'gradeResults.insert': 'game_results',
  'rawPayloads.insert': 'raw_payloads',
  'oddsSnapshots.insert': 'odds_snapshots',
});

export const INGESTOR_READ_SURFACE: ReadonlySet<string> = new Set([
  'providerOffers.findClosingLine',
  'providerOffers.findExistingCombinations',
  'providerOffers.findLatestByMarketKey',
  'providerOffers.findOpeningLine',
  'providerOffers.getCycleStatus',
  'providerOffers.listAliasLookup',
  'providerOffers.listAll',
  'providerOffers.listByProvider',
  'providerOffers.listClosingOffers',
  'providerOffers.listOpeningCurrentOffers',
  'providerOffers.listOpeningOffers',
  'providerOffers.listParticipantAliasLookup',
  'providerOffers.listRecentOffers',
  'providerOffers.listStagedOffers',
  'providerOffers.resolveCanonicalMarketKey',
  'providerOffers.resolveProviderMarketKey',
  'runs.listByType',
  'events.findByExternalId',
  'events.findById',
  'events.listByName',
  'events.listStartedBySnapshot',
  'events.listUpcoming',
  'eventParticipants.listByEvent',
  'eventParticipants.listByParticipant',
  'participants.findByExternalId',
  'participants.findById',
  'participants.listByType',
  'gradeResults.findResult',
  'gradeResults.listByEvent',
  'oddsSnapshots.findLatestByProviderLeague',
  'oddsSnapshots.queryAtTimestamp',
]);

/**
 * Every method reachable on a repository instance, including inherited prototype
 * methods -- `for...in` sees none of them, because class methods are non-enumerable.
 */
export function enumerateRepositoryMethods(repository: object): string[] {
  const names = new Set<string>();
  let current: object | null = repository;
  while (current && current !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (name === 'constructor') continue;
      const descriptor = Object.getOwnPropertyDescriptor(current, name);
      if (descriptor && typeof descriptor.value === 'function') {
        names.add(name);
      }
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return [...names].sort();
}
