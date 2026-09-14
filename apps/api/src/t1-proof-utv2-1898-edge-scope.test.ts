/**
 * T1 Live-DB Proof: scoped provider-offer lookup (UTV2-1898)
 *
 * The unit suite for this repair (`real-edge-scope-regression.test.ts`, 22
 * tests) exercises the InMemory repository, whose `findLatestScopedOffer` is a
 * hand-written array predicate. The behaviour that actually decides whether a
 * production pick borrows an unrelated book offer lives in the PostgREST query
 * in `DatabaseProviderOfferRepository.findLatestScopedOffer`, and no unit test
 * in this repository reaches it — a fact recorded in the lane's mutation
 * battery, where the two repository mutations had to be aimed at the InMemory
 * predicates because mutating the DB implementation turns nothing red.
 *
 * That is exactly the InMemory-vs-Database drift class UTV2-519 and UTV2-521
 * shipped broken. This proof closes it against the real staging database.
 *
 * Four assumptions here are live-DB assumptions, not logic assumptions:
 *
 *   1. A row written through `upsertBatch` is reachable through
 *      `provider_offer_current` at all. That table is a real table, not a view
 *      over history, and it is populated by a second upsert keyed on
 *      `identity_key` — so "the write succeeded" and "the read can see it" are
 *      independent facts.
 *   2. Each of the four discriminating predicates actually discriminates in
 *      SQL. The refusal direction is what matters: a near-miss row must NOT be
 *      returned, because returning it is how a pick silently inherits another
 *      event's price.
 *   3. `.is('provider_participant_id', null)` matches SQL NULL and nothing
 *      else, and `.eq(id)` does not match the NULL row. The InMemory predicate
 *      uses `== null`, which cannot prove either direction.
 *   4. The `snapshot_at` Postgres returns is parseable by `Date.parse`, which
 *      is what `resolveMatchingOffer` calls before comparing against
 *      `PROVIDER_OFFER_MAX_AGE_MS`. An unparseable timestamp reads as NaN and
 *      refuses every offer — fail-closed, but silently edgeless.
 *
 * Every fixture is namespaced by a per-run id, so a rerun cannot read a prior
 * run's rows and two concurrent runs cannot see each other.
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY. Test-created rows are NOT deleted.
 *
 * Run: UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-1898-edge-scope.test.ts
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type ProviderOfferUpsertInput,
  type RepositoryBundle,
  type ScopedProviderOfferLookup,
} from '@unit-talk/db';
import { PROVIDER_OFFER_MAX_AGE_MS } from './real-edge-service.js';

function hasSupabaseEnv(): boolean {
  try {
    const env = loadEnvironment();
    return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  } catch {
    return false;
  }
}

const skipReason = hasSupabaseEnv()
  ? false
  : 'SUPABASE_SERVICE_ROLE_KEY not configured — skipping live DB proof';

const RUN_ID = randomUUID().slice(0, 8);

const SPORT = 'NBA';
const EVENT = `utv2-1898-evt-${RUN_ID}`;
const MARKET = 'points-all-game-ou';
const PARTICIPANT = `utv2-1898-player-${RUN_ID}`;
const PROVIDER = 'sgo';

let repositories: RepositoryBundle;

before(() => {
  if (skipReason) return;
  const env = loadEnvironment();
  repositories = createDatabaseRepositoryBundle(
    createServiceRoleDatabaseConnectionConfig(env),
  );
});

function offer(
  overrides: Partial<ProviderOfferUpsertInput> & { idempotencyKey: string },
): ProviderOfferUpsertInput {
  return {
    providerKey: PROVIDER,
    providerEventId: EVENT,
    providerMarketKey: MARKET,
    providerParticipantId: PARTICIPANT,
    sportKey: SPORT,
    line: 24.5,
    overOdds: -110,
    underOdds: -110,
    devigMode: 'PAIRED',
    isOpening: false,
    isClosing: false,
    snapshotAt: new Date().toISOString(),
    bookmakerKey: null,
    ...overrides,
  };
}

function lookup(
  overrides: Partial<ScopedProviderOfferLookup> = {},
): ScopedProviderOfferLookup {
  return {
    sportKey: SPORT,
    providerEventId: EVENT,
    providerMarketKey: MARKET,
    providerParticipantId: PARTICIPANT,
    ...overrides,
  };
}

test(
  'every near-miss row is refused before any matching row exists (UTV2-1898)',
  { skip: skipReason },
  async () => {
    // Seeded FIRST and alone: four rows that each differ from the target scope
    // in exactly one field. If any predicate were dropped, the query would have
    // a row to return, and the pick would inherit its price. The assertion is
    // that it returns nothing at all.
    await repositories.providerOffers.upsertBatch([
      offer({
        idempotencyKey: `utv2-1898-${RUN_ID}-wrong-sport`,
        sportKey: 'NFL',
      }),
      offer({
        idempotencyKey: `utv2-1898-${RUN_ID}-wrong-event`,
        providerEventId: `${EVENT}-other`,
      }),
      offer({
        idempotencyKey: `utv2-1898-${RUN_ID}-wrong-market`,
        providerMarketKey: 'rebounds-all-game-ou',
      }),
      offer({
        idempotencyKey: `utv2-1898-${RUN_ID}-wrong-participant`,
        providerParticipantId: `${PARTICIPANT}-other`,
      }),
    ]);

    const found =
      await repositories.providerOffers.findLatestScopedOffer(lookup());

    assert.equal(
      found,
      null,
      'four one-field-off offers exist; an exact-scope lookup must match none of them',
    );
  },
);

test(
  'each predicate is individually load-bearing against the seeded near-misses (UTV2-1898)',
  { skip: skipReason },
  async () => {
    // The control for the test above: each near-miss row IS findable by the
    // lookup that names its own scope. Without this, "returns null" would be
    // consistent with the rows never having been written, and the refusal
    // assertion would be vacuous.
    const cases: Array<[string, ScopedProviderOfferLookup]> = [
      ['sport', lookup({ sportKey: 'NFL' })],
      ['event', lookup({ providerEventId: `${EVENT}-other` })],
      ['market', lookup({ providerMarketKey: 'rebounds-all-game-ou' })],
      ['participant', lookup({ providerParticipantId: `${PARTICIPANT}-other` })],
    ];

    for (const [label, criteria] of cases) {
      const found =
        await repositories.providerOffers.findLatestScopedOffer(criteria);
      assert.ok(
        found,
        `the ${label} near-miss row must be findable by its own scope, or the refusal above proves nothing`,
      );
    }
  },
);

test(
  'an exact-scope offer is found, and its snapshot_at is parseable (UTV2-1898)',
  { skip: skipReason },
  async () => {
    const snapshotAt = new Date().toISOString();
    await repositories.providerOffers.upsertBatch([
      offer({ idempotencyKey: `utv2-1898-${RUN_ID}-exact`, snapshotAt }),
    ]);

    const found =
      await repositories.providerOffers.findLatestScopedOffer(lookup());

    assert.ok(found, 'the exact-scope offer must be found');
    assert.equal(found.provider_event_id, EVENT);
    assert.equal(found.provider_market_key, MARKET);
    assert.equal(found.provider_participant_id, PARTICIPANT);
    assert.equal(found.sport_key, SPORT);

    // Assumption 4. `resolveMatchingOffer` calls Date.parse on exactly this
    // value; Postgres renders timestamptz as '+00' rather than 'Z', and a
    // format Date.parse cannot read would refuse every offer as stale.
    const parsed = Date.parse(found.snapshot_at as unknown as string);
    assert.ok(
      Number.isFinite(parsed),
      `snapshot_at must be Date.parse-able; got ${String(found.snapshot_at)}`,
    );
    assert.ok(
      Date.now() - parsed < PROVIDER_OFFER_MAX_AGE_MS,
      'a row written seconds ago must read as inside the 6-hour freshness window',
    );
  },
);

test(
  'participant NULL and participant-attributed are disjoint in SQL (UTV2-1898)',
  { skip: skipReason },
  async () => {
    // A game-level row on the SAME sport, event and market as the attributed
    // row above. `== null` in the InMemory predicate cannot distinguish SQL
    // NULL from a missing column; `.is(null)` versus `.eq(id)` can, and both
    // directions have to hold or a player prop matches the game line.
    const gameLevelEvent = `${EVENT}-gl`;
    await repositories.providerOffers.upsertBatch([
      offer({
        idempotencyKey: `utv2-1898-${RUN_ID}-null-participant`,
        providerEventId: gameLevelEvent,
        providerParticipantId: null,
      }),
      offer({
        idempotencyKey: `utv2-1898-${RUN_ID}-attributed-participant`,
        providerEventId: gameLevelEvent,
        providerParticipantId: PARTICIPANT,
      }),
    ]);

    const nullSide = await repositories.providerOffers.findLatestScopedOffer(
      lookup({ providerEventId: gameLevelEvent, providerParticipantId: null }),
    );
    assert.ok(nullSide, 'a NULL-participant lookup must find the NULL row');
    assert.equal(
      nullSide.provider_participant_id,
      null,
      'a NULL-participant lookup must not return the attributed row',
    );

    const attributedSide =
      await repositories.providerOffers.findLatestScopedOffer(
        lookup({ providerEventId: gameLevelEvent }),
      );
    assert.ok(
      attributedSide,
      'an attributed lookup must find the attributed row',
    );
    assert.equal(
      attributedSide.provider_participant_id,
      PARTICIPANT,
      'an attributed lookup must not fall through to the NULL-participant row',
    );
  },
);

test(
  'the current row carries the newest snapshot in the batch (UTV2-1898)',
  { skip: skipReason },
  async () => {
    // Freshness is read off the row this lookup returns. If the older snapshot
    // of the same identity won the upsert, a fresh offer would read as stale
    // and the edge would be refused — fail-closed, and wrong.
    const freshEvent = `${EVENT}-fresh`;
    const older = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    const newer = new Date().toISOString();

    await repositories.providerOffers.upsertBatch([
      offer({
        idempotencyKey: `utv2-1898-${RUN_ID}-newer`,
        providerEventId: freshEvent,
        snapshotAt: newer,
      }),
      offer({
        idempotencyKey: `utv2-1898-${RUN_ID}-older`,
        providerEventId: freshEvent,
        snapshotAt: older,
      }),
    ]);

    const found = await repositories.providerOffers.findLatestScopedOffer(
      lookup({ providerEventId: freshEvent }),
    );

    assert.ok(found, 'the current row must exist');
    const parsed = Date.parse(found.snapshot_at as unknown as string);
    assert.ok(
      Date.now() - parsed < PROVIDER_OFFER_MAX_AGE_MS,
      `the newer snapshot must win; got ${String(found.snapshot_at)}`,
    );
  },
);
