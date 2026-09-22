/**
 * UTV2-1898 — an offer may back a pick only when it matches that pick's sport,
 * event, market, participant side AND provider freshness window.
 *
 * The defect these lock: a September NFL moneyline was given the market
 * probability of a June MLB moneyline. Nothing in the pick was wrong; the
 * lookup simply dropped every discriminating predicate it could not resolve,
 * because `findLatestByMarketKey(key, provider?, participant?)` treated an
 * omitted argument as "no filter" instead of "no match".
 *
 * Each test below flips exactly one dimension away from a known-good match and
 * asserts the edge becomes unavailable with the reason that names that
 * dimension — so a regression cannot restore the old behaviour in silence.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryProviderOfferRepository } from '@unit-talk/db';
import type { ProviderOfferUpsertInput } from '@unit-talk/db';

import {
  PROVIDER_OFFER_MAX_AGE_MS,
  computeRealEdge,
  readPersistedRealEdgeScope,
  type RealEdgeMarketScope,
} from './real-edge-service.js';

const NOW = new Date('2026-09-13T19:42:00.000Z');

/** The NFL pick actually submitted on 2026-09-13: Lions moneyline, -105, 8/10. */
const NFL_SCOPE: RealEdgeMarketScope = {
  sportKey: 'NFL',
  providerEventId: 'nfl-saints-at-lions-2026-09-13',
  providerParticipantId: 'DETROIT_LIONS_NFL',
  now: NOW,
};

function offer(overrides: Partial<ProviderOfferUpsertInput>): ProviderOfferUpsertInput {
  return {
    providerKey: 'sgo',
    providerEventId: NFL_SCOPE.providerEventId as string,
    providerMarketKey: 'moneyline',
    providerParticipantId: 'DETROIT_LIONS_NFL',
    sportKey: 'NFL',
    line: null,
    overOdds: -120,
    underOdds: 100,
    devigMode: 'PAIRED',
    isOpening: false,
    isClosing: false,
    snapshotAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
    idempotencyKey: `idem-${Math.random()}`,
    bookmakerKey: null,
    ...overrides,
  };
}

async function seed(...offers: ProviderOfferUpsertInput[]) {
  const repo = new InMemoryProviderOfferRepository();
  if (offers.length > 0) {
    await repo.upsertBatch(offers);
  }
  return repo;
}

async function edgeFor(
  providerOffers: InMemoryProviderOfferRepository,
  scope: RealEdgeMarketScope = NFL_SCOPE,
) {
  return computeRealEdge({
    confidence: 0.8,
    marketKey: 'moneyline',
    selection: 'Lions',
    submittedOdds: -105,
    providerOffers,
    scope,
  });
}

/** Every unavailable-edge result must look the same to every downstream reader. */
function assertEdgeUnavailable(
  result: Awaited<ReturnType<typeof computeRealEdge>>,
  expectedReason: string,
) {
  assert.equal(result.provenance.fallbackReason, expectedReason);
  assert.equal(result.marketSource, 'confidence-delta');
  assert.equal(result.provenance.method, 'confidence-delta');
  assert.equal(result.provenance.providerCoverageState, 'none');
  // UTV2-985/1898: an unavailable edge must never be positive. This is the
  // property promotion depends on — `readTopLevelMarketBackedRealEdge` refuses
  // a 'confidence-delta' source, so the 0.35-weighted edge component scores
  // zero rather than 400x a number derived from another sport's game.
  assert.equal(result.hasRealEdge, false);
  assert.equal(result.bookCount, 0);
}

// ── the control: a correctly matching offer still works ─────────────────────

test('an offer matching every dimension supplies market-backed edge', async () => {
  const result = await edgeFor(await seed(offer({})));

  assert.equal(result.marketSource, 'sgo');
  assert.equal(result.provenance.method, 'market-devigged');
  assert.equal(result.provenance.fallbackReason, null);
  assert.ok(result.marketProbability > 0 && result.marketProbability < 1);
  // Without this control the tests below would pass for the wrong reason —
  // a lookup that matches nothing at all also refuses every mismatch.
});

// ── cross-sport ─────────────────────────────────────────────────────────────

test('an offer from another sport cannot back the pick', async () => {
  // The production shape: MLB is the only sport with recent offers, and the
  // MLB moneyline family shares the provider market key.
  const repo = await seed(
    offer({ sportKey: 'MLB', providerEventId: 'mlb-dodgers-at-brewers', providerParticipantId: 'LOS_ANGELES_DODGERS_MLB' }),
  );

  assertEdgeUnavailable(await edgeFor(repo), 'no-provider-offer');
});

test('sport is compared, not merely carried: an NFL scope does not match an MLB row even at the same event id', async () => {
  const repo = await seed(offer({ sportKey: 'MLB' }));
  assertEdgeUnavailable(await edgeFor(repo), 'no-provider-offer');
});

// ── cross-event ─────────────────────────────────────────────────────────────

test('an offer from a different event in the same sport cannot back the pick', async () => {
  const repo = await seed(offer({ providerEventId: 'nfl-bears-at-packers-2026-09-13' }));
  assertEdgeUnavailable(await edgeFor(repo), 'no-provider-offer');
});

// ── cross-participant ───────────────────────────────────────────────────────

test('an offer for the opposing side of the same game cannot back the pick', async () => {
  const repo = await seed(offer({ providerParticipantId: 'NEW_ORLEANS_SAINTS_NFL' }));
  assertEdgeUnavailable(await edgeFor(repo), 'no-provider-offer');
});

// ── stale ───────────────────────────────────────────────────────────────────

test('an in-scope offer outside the freshness window is refused as stale, not used', async () => {
  const repo = await seed(
    offer({ snapshotAt: new Date(NOW.getTime() - PROVIDER_OFFER_MAX_AGE_MS - 1000).toISOString() }),
  );

  const result = await edgeFor(repo);
  // Distinguishable from absence: this market HAS coverage, it is just old.
  assertEdgeUnavailable(result, 'no-fresh-offer');
});

test('an offer exactly at the freshness boundary is still admitted', async () => {
  const repo = await seed(
    offer({ snapshotAt: new Date(NOW.getTime() - PROVIDER_OFFER_MAX_AGE_MS).toISOString() }),
  );

  assert.equal((await edgeFor(repo)).marketSource, 'sgo');
});

test('the 75-day-old production MLB row cannot reach a pick submitted today', async () => {
  // The literal defect, reproduced end to end: newest production offer is
  // 2026-06-30, the pick is 2026-09-13, and before this repair the June row
  // supplied marketProbability 0.478261 to both submitted picks.
  const repo = await seed(
    offer({
      sportKey: 'MLB',
      providerEventId: 'mlb-2026-06-30',
      providerMarketKey: 'points-all-game-ml',
      providerParticipantId: null,
      snapshotAt: '2026-06-30T12:41:02.424Z',
      overOdds: -110,
      underOdds: -110,
    }),
  );

  const result = await edgeFor(repo);
  assert.notEqual(result.marketProbability, 0.478261);
  assertEdgeUnavailable(result, 'no-provider-offer');
});

// ── missing offer ───────────────────────────────────────────────────────────

test('no offer at all yields no-provider-offer and preserves the submitted odds as the reference', async () => {
  const result = await edgeFor(await seed());

  assertEdgeUnavailable(result, 'no-provider-offer');
  // The pick's own submitted price is what the confidence delta is measured
  // against — nothing is manufactured from another market.
  assert.equal(result.modelProbability, 0.8);
});

// ── unresolved scope refuses rather than widening ───────────────────────────

test('an unresolved sport refuses the lookup and names the missing dimension', async () => {
  const repo = await seed(offer({}));
  assertEdgeUnavailable(await edgeFor(repo, { ...NFL_SCOPE, sportKey: null }), 'no-sport-scope');
});

test('an unresolved event refuses the lookup and names the missing dimension', async () => {
  const repo = await seed(offer({}));
  assertEdgeUnavailable(
    await edgeFor(repo, { ...NFL_SCOPE, providerEventId: null }),
    'no-event-scope',
  );
});

test('an unresolved participant refuses the lookup rather than matching any participant', async () => {
  // This is the exact failure: `undefined` used to mean "apply no participant
  // filter", so the newest row for the market key won regardless of side.
  const repo = await seed(offer({}));
  assertEdgeUnavailable(
    await edgeFor(repo, { ...NFL_SCOPE, providerParticipantId: undefined }),
    'no-participant-scope',
  );
});

// ── side attribution ────────────────────────────────────────────────────────

test('a moneyline offer that names no participant is refused, not read as the over side', async () => {
  // Every `points-all-game-ml` row in production carries a NULL participant.
  // Reading `overFair` from one attributes an arbitrary team's price to the
  // pick — the third defect in this family.
  const repo = await seed(offer({ providerParticipantId: null }));

  assertEdgeUnavailable(
    await edgeFor(repo, { ...NFL_SCOPE, providerParticipantId: null }),
    'offer-participant-unattributed',
  );
});

// ── the persisted scope promotion re-derives under ──────────────────────────

test('readPersistedRealEdgeScope distinguishes a recorded game-level null from an absent key', async () => {
  const gameLevel = readPersistedRealEdgeScope(
    { edgeScope: { sportKey: 'NFL', providerEventId: 'e1', providerParticipantId: null } },
    NOW,
  );
  assert.equal(gameLevel.providerParticipantId, null);

  const neverResolved = readPersistedRealEdgeScope(
    { edgeScope: { sportKey: 'NFL', providerEventId: 'e1' } },
    NOW,
  );
  assert.equal(neverResolved.providerParticipantId, undefined);
});

test('a pick carrying no recorded scope cannot acquire market edge at promotion time', async () => {
  const repo = await seed(offer({}));
  const result = await edgeFor(repo, readPersistedRealEdgeScope({}, NOW));

  assertEdgeUnavailable(result, 'no-sport-scope');
});

// ── the repository contract itself ──────────────────────────────────────────
//
// The tests above exercise the service, which refuses an unresolved scope
// before querying. That leaves the repository's own behaviour unasserted, and
// the repository is where the defect actually lived: the old signature let an
// omitted argument skip its predicate. These lock the contract directly, with
// the type deliberately subverted, so restoring an "undefined means unfiltered"
// branch fails here even though no service path can reach it.

test('the repository refuses a participant it cannot match, never falling back to unfiltered', async () => {
  const repo = await seed(offer({ providerParticipantId: 'DETROIT_LIONS_NFL' }));

  const unscoped = await repo.findLatestScopedOffer({
    sportKey: 'NFL',
    providerEventId: NFL_SCOPE.providerEventId as string,
    providerMarketKey: 'moneyline',
    // The value the old positional API received whenever the caller could not
    // resolve a participant. It must match nothing, not everything.
    providerParticipantId: undefined as unknown as string | null,
  });

  assert.equal(unscoped, null);
});

test('the repository applies every discriminating predicate independently', async () => {
  const repo = await seed(offer({}));
  const base = {
    sportKey: 'NFL',
    providerEventId: NFL_SCOPE.providerEventId as string,
    providerMarketKey: 'moneyline',
    providerParticipantId: 'DETROIT_LIONS_NFL',
  };

  assert.ok(await repo.findLatestScopedOffer(base), 'control: the exact scope matches');
  assert.equal(await repo.findLatestScopedOffer({ ...base, sportKey: 'MLB' }), null);
  assert.equal(await repo.findLatestScopedOffer({ ...base, providerEventId: 'other' }), null);
  assert.equal(await repo.findLatestScopedOffer({ ...base, providerMarketKey: 'spread' }), null);
  assert.equal(await repo.findLatestScopedOffer({ ...base, providerParticipantId: null }), null);
  assert.equal(
    await repo.findLatestScopedOffer({ ...base, providerParticipantId: 'NEW_ORLEANS_SAINTS_NFL' }),
    null,
  );
});

// ── participant scope beyond moneyline ──────────────────────────────────────
//
// The first pass of this repair defined "names a side" as `marketKey ===
// 'moneyline'`. Measured against the real key space that was too narrow: a
// spread, a team total and every player prop also price one participant, so a
// NULL-participant row for any of them was still read as that pick's side. The
// predicate now comes from `classifyMarketFamilyForGrading`, which grading
// already trusts for the same question.

async function edgeForMarket(
  canonicalMarketKey: string,
  selection: string,
  offers: ProviderOfferUpsertInput[],
  scope: RealEdgeMarketScope,
) {
  return computeRealEdge({
    confidence: 0.8,
    marketKey: canonicalMarketKey,
    selection,
    submittedOdds: -110,
    providerOffers: await seed(...offers),
    scope,
  });
}

const GAME_LEVEL_SCOPE: RealEdgeMarketScope = { ...NFL_SCOPE, providerParticipantId: null };

for (const { marketKey, selection } of [
  { marketKey: 'spread', selection: 'Lions -3.5' },
  { marketKey: 'team_total_ou', selection: 'Lions Over 24.5' },
  { marketKey: 'passing-yards-all-game-ou', selection: 'Jared Goff Over 245.5' },
] as const) {
  test(`a ${marketKey} offer that names no participant is refused, not attributed to the pick`, async () => {
    const result = await edgeForMarket(
      marketKey,
      selection,
      [offer({ providerMarketKey: marketKey, providerParticipantId: null, line: 24.5 })],
      GAME_LEVEL_SCOPE,
    );

    assertEdgeUnavailable(result, 'offer-participant-unattributed');
  });
}

test('a game total is genuinely game-level and still matches a participant-NULL offer', async () => {
  // The control for the widening above. `game_total_ou` prices the game, not a
  // side, so refusing it here would have cost real coverage rather than closing
  // a defect — and `isPlayerPropMarket`'s `-all-game-ou` suffix test is broad
  // enough that this is worth asserting rather than assuming.
  const result = await edgeForMarket(
    'game_total_ou',
    'Over 47.5',
    [offer({ providerMarketKey: 'game_total_ou', providerParticipantId: null, line: 47.5 })],
    GAME_LEVEL_SCOPE,
  );

  assert.equal(result.marketSource, 'sgo');
  assert.equal(result.provenance.fallbackReason, null);
});

test('a participant-scoped market still reads its own over/under side', async () => {
  // Participant scope and side-bearing are different questions. A team total
  // names a participant AND carries a real over/under axis, so folding the two
  // predicates together would read every "Under" as its "Over".
  const attributed = [
    offer({
      providerMarketKey: 'team_total_ou',
      providerParticipantId: 'DETROIT_LIONS_NFL',
      line: 24.5,
      overOdds: -130,
      underOdds: 110,
    }),
  ];

  const over = await edgeForMarket('team_total_ou', 'Lions Over 24.5', attributed, NFL_SCOPE);
  const under = await edgeForMarket('team_total_ou', 'Lions Under 24.5', attributed, NFL_SCOPE);

  assert.equal(over.marketSource, 'sgo');
  assert.equal(under.marketSource, 'sgo');
  assert.ok(
    over.marketProbability > under.marketProbability,
    'the -130 over must devig to a higher fair probability than the +110 under',
  );
});
