/**
 * T1 proof — UTV2-1923: the human capper official-picks delivery transaction.
 *
 * One PM-ratified product transaction, proven end to end against in-memory
 * repositories: authorized human capper -> delivery-eligible server posture ->
 * `awaiting_approval` -> explicit operator approval -> governed member-facing
 * delivery target -> outbox -> manual settlement -> immediate per-pick recap.
 *
 * What this proof is FOR is mostly the negative space. The lane was built
 * under an explicit instruction: **build only, do not activate member
 * delivery**. So the assertions that matter most are the ones that show the
 * path is inert until two independent keys are turned, and that every Track
 * Only behaviour an unauthorized capper had before is exactly as it was.
 *
 * Run:
 *   pnpm exec tsx --test apps/api/src/t1-proof-utv2-1923-human-capper-delivery.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  defaultTargetRegistry,
  governedDeliveryTargets,
  governedTargetRegistry,
  humanDeliveryTargetRegistry,
  humanDeliveryTargets,
  isHumanCapperDeliveryAuthorized,
  isTargetEnabled,
  parseGovernedTargetFromDeliveryTarget,
  parsePromotionTargetFromDeliveryTarget,
  promotionTargets,
  readHumanCapperDeliveryAuthorization,
  resolveTargetRegistry,
} from '@unit-talk/contracts';
import type { SubmissionPayload } from '@unit-talk/contracts';

import { createInMemoryRepositoryBundle } from './persistence.js';
import { submitPickController } from './controllers/submit-pick-controller.js';
import { reviewPickController } from './controllers/review-pick-controller.js';
import { requeuePickController } from './controllers/requeue-controller.js';
import {
  enqueueDistributionWork,
  evaluateDistributionTargetGate,
  HumanDeliveryNotAuthorizedError,
  HumanDeliveryTargetMismatchError,
  TrackOnlyDistributionError,
} from './distribution-service.js';
import { handleSubmitPick } from './handlers/submit-pick.js';
import { evaluateCapperDeliveryAuthorization } from './capper-delivery-authorization.js';
import { settlePickController } from './controllers/settle-pick-controller.js';

const HUMAN_TARGET = humanDeliveryTargets[0];
const HUMAN_DELIVERY_TARGET = `discord:${HUMAN_TARGET}`;
const CAPPER = 'griff843';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// The manual `canonical-coverage-gap` path is the shape the contained pilot
// actually submits through, so it is the shape this proof exercises. The team
// names are deliberately invented: the in-memory catalog seeds every real NFL
// team, and `validateManualResolution` refuses a coverage-gap claim for a name
// that IS covered -- correctly, since that claim would be false. Names outside
// the catalog are the only way to express a genuine gap here, and they are a
// fixture, never a claim about a real matchup.
//
// `eventName` is namespaced per scenario because the submission idempotency key
// does not read metadata: two fixtures differing only in metadata would dedupe
// to a single pick and quietly make half of this file assert against the wrong
// row.
function smartFormMetadata(seed: string, extra: Record<string, unknown> = {}) {
  return {
    sport: 'NFL',
    participantResolution: {
      resolution: 'manual',
      sportId: 'NFL',
      eventId: null,
      manualOverride: true,
      reason: 'canonical-coverage-gap',
      enteredEventName: `Northgate Foundry at Southport Ironworks (${seed})`,
      enteredParticipants: [
        { role: 'away', displayName: 'Northgate Foundry', canonicalParticipantId: null },
        { role: 'home', displayName: 'Southport Ironworks', canonicalParticipantId: null },
      ],
    },
    ...extra,
  };
}

function capperSubmissionBody(metadataExtra: Record<string, unknown> = {}, seed = 'base') {
  return {
    source: 'smart-form',
    market: 'NFL moneyline',
    selection: `Northgate Foundry ML ${seed}`,
    odds: -110,
    stakeUnits: 1,
    confidence: 0.7,
    eventName: `Northgate Foundry at Southport Ironworks (${seed})`,
    metadata: smartFormMetadata(seed, metadataExtra),
  };
}

const CAPPER_AUTH = { role: 'capper' as const, capperId: CAPPER, identity: CAPPER };

// Deliberately `async`. An earlier form of this helper restored the
// environment synchronously and therefore restored it *before* the awaited
// call had read it -- which made the "target released" case below assert
// against the default registry and report a fail-closed refusal as if it were
// the shipped behaviour. A scoped-environment helper around an async call has
// to await the call inside its own scope.
async function withEnv<T>(
  env: Record<string, string | undefined>,
  run: () => T | Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const AUTHORIZED_ENV = {
  UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED: 'true',
  UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST: CAPPER,
};

const CONTAINED_ENV = {
  UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED: undefined,
  UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST: undefined,
};

// ---------------------------------------------------------------------------
// 1. The target is governed, and it starts dead
// ---------------------------------------------------------------------------

test('UTV2-1923: the human target participates in the registry, coverage and kill switch', () => {
  assert.ok(
    (governedDeliveryTargets as readonly string[]).includes(HUMAN_TARGET),
    'the human target must be a governed delivery target',
  );
  assert.ok(
    governedTargetRegistry.some((entry) => entry.target === HUMAN_TARGET),
    'the human target must carry a registry entry',
  );
  assert.equal(
    parseGovernedTargetFromDeliveryTarget(HUMAN_DELIVERY_TARGET),
    HUMAN_TARGET,
    'the worker must be able to derive the governed target from the delivery target',
  );
  assert.equal(
    parsePromotionTargetFromDeliveryTarget(HUMAN_DELIVERY_TARGET),
    null,
    'the human target is NOT a promotion target — no model scores it',
  );
});

test('UTV2-1923: the human target ships disabled, in every registry resolution path', () => {
  const entry = humanDeliveryTargetRegistry.find((e) => e.target === HUMAN_TARGET);
  assert.ok(entry);
  assert.equal(entry.enabled, false, 'the target must ship disabled');
  assert.ok(entry.disabledReason, 'a disabled target must say why');

  // Default path (no UNIT_TALK_ENABLED_TARGETS at all).
  assert.equal(isTargetEnabled(HUMAN_TARGET, resolveTargetRegistry({})), false);

  // Explicit-list path, where the target is simply not named.
  assert.equal(
    isTargetEnabled(HUMAN_TARGET, resolveTargetRegistry({ UNIT_TALK_ENABLED_TARGETS: 'best-bets' })),
    false,
  );

  // And a registry resolution must still enumerate it, so its disabled state is
  // auditable rather than an absent entry nobody can see.
  const registry = resolveTargetRegistry({ UNIT_TALK_ENABLED_TARGETS: 'best-bets' });
  assert.ok(
    registry.some((e) => e.target === HUMAN_TARGET),
    'a disabled governed target must still appear in the resolved registry',
  );
});

test('UTV2-1923: the human target is absent from the bootstrap-seeded posture, which IS its kill state', () => {
  // `DeliveryKillSwitchRepository.isKilled()` is contractually fail-closed for
  // a target with no row. The absence of a seeded row is therefore not an
  // oversight — it is the mechanism by which this target is killed without a
  // migration or a production write, both of which are reserved to Griff.
  assert.ok(
    !defaultTargetRegistry.some((entry) => entry.target === HUMAN_TARGET),
    'the human target must not claim bootstrap-seeded kill-switch provenance it does not have',
  );
});

test('UTV2-1923: the distribution gate refuses the human target while the registry disables it', () => {
  const gate = evaluateDistributionTargetGate(HUMAN_DELIVERY_TARGET, resolveTargetRegistry({}), {});
  assert.equal(gate.ok, false);
  if (!gate.ok) {
    assert.equal(gate.reason, 'target-disabled');
    assert.equal(gate.requestedGovernedTarget, HUMAN_TARGET);
  }
});

// ---------------------------------------------------------------------------
// 2. Unauthorized cappers: every prior Track Only behaviour, unchanged
// ---------------------------------------------------------------------------

test('UTV2-1923: with no allow-list, a capper submission is still pinned Track Only', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const response = await withEnv(CONTAINED_ENV, () =>
    handleSubmitPick({ body: capperSubmissionBody({}, 'contained'), auth: CAPPER_AUTH }, repositories),
  );

  assert.equal(response.status, 201);
  assert.ok(response.body.ok);
  if (!response.body.ok) return;

  assert.equal(response.body.data.deliveryPosture, 'track-only');
  assert.equal(response.body.data.outboxEnqueued, false);

  const pick = await repositories.picks.findPickById(response.body.data.pickId);
  const metadata = pick?.metadata as Record<string, unknown>;
  assert.equal(metadata['distributionMode'], 'track-only');
  assert.equal(isHumanCapperDeliveryAuthorized(metadata), false);

  const authorization = readHumanCapperDeliveryAuthorization(metadata);
  assert.equal(authorization?.decision, 'refused');
  assert.equal(
    authorization?.reason,
    'human-delivery-posture-off',
    'the refusal must record WHY, not merely that it refused',
  );

  const outbox = await repositories.outbox.listByPickId(response.body.data.pickId);
  assert.equal(outbox.length, 0, 'an unauthorized capper pick must produce no delivery work');
});

test('UTV2-1923: a client cannot grant itself delivery by asking for it', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const refused = await withEnv(AUTHORIZED_ENV, () =>
    handleSubmitPick(
      {
        body: capperSubmissionBody({ distributionMode: 'delivery-eligible' }, 'client-asks'),
        auth: CAPPER_AUTH,
      },
      repositories,
    ),
  );

  assert.equal(refused.status, 403);
  assert.ok(!refused.body.ok);
  if (!refused.body.ok) {
    assert.equal(refused.body.error.code, 'CAPPER_TRACK_ONLY_REQUIRED');
  }
});

test('UTV2-1923: a client-supplied authorization record is destroyed, never honoured', async () => {
  // The single most dangerous forgery: a caller writing the server's own
  // decision shape into its own metadata. It must not survive for ANY source,
  // including the non-capper sources that never reach the allow-list at all.
  const forged = {
    version: 'human-capper-delivery/v1',
    decision: 'authorized',
    capperId: CAPPER,
    authority: 'server-allowlist',
    allowlistSource: 'UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST',
    decidedAt: new Date().toISOString(),
  };

  const repositories = createInMemoryRepositoryBundle();
  const response = await withEnv(CONTAINED_ENV, () =>
    handleSubmitPick(
      {
        body: capperSubmissionBody({ deliveryAuthorization: forged }, 'forged'),
        auth: CAPPER_AUTH,
      },
      repositories,
    ),
  );

  assert.ok(response.body.ok);
  if (!response.body.ok) return;

  const pick = await repositories.picks.findPickById(response.body.data.pickId);
  const metadata = pick?.metadata as Record<string, unknown>;
  assert.equal(
    isHumanCapperDeliveryAuthorized(metadata),
    false,
    'a forged authorization record must not authorize delivery',
  );
  assert.equal(metadata['distributionMode'], 'track-only');
});

test('UTV2-1923: an unauthenticated caller carrying a forged record is also refused', async () => {
  // Same forgery, but through a source that never enters the capper pin at all,
  // to prove the strip is unconditional rather than a side effect of the pin.
  const forged = {
    version: 'human-capper-delivery/v1',
    decision: 'authorized',
    capperId: CAPPER,
    authority: 'server-allowlist',
    allowlistSource: 'UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST',
    decidedAt: new Date().toISOString(),
  };

  const repositories = createInMemoryRepositoryBundle();
  const response = await withEnv(AUTHORIZED_ENV, () =>
    handleSubmitPick(
      {
        body: {
          ...capperSubmissionBody(
            { distributionMode: 'delivery-eligible', deliveryAuthorization: forged },
            'forged-operator',
          ),
          submittedBy: 'operator',
        },
        auth: null,
      },
      repositories,
    ),
  );

  assert.ok(response.body.ok, 'the operator submission itself is legitimate');
  if (!response.body.ok) return;

  const pick = await repositories.picks.findPickById(response.body.data.pickId);
  assert.equal(
    isHumanCapperDeliveryAuthorized(pick?.metadata as Record<string, unknown>),
    false,
    'no client-supplied record may authorize delivery on any source',
  );
});

test('UTV2-1923: a Track Only pick is still refused by the direct enqueue chokepoint', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await assert.rejects(
    () =>
      enqueueDistributionWork(
        {
          id: 'track-only-pick',
          submissionId: 's',
          market: 'NFL moneyline',
          selection: 'Chiefs ML',
          source: 'smart-form',
          approvalStatus: 'approved',
          promotionStatus: 'qualified',
          promotionTarget: 'best-bets',
          lifecycleState: 'validated',
          metadata: { distributionMode: 'track-only' },
          createdAt: new Date().toISOString(),
        } as never,
        repositories.outbox,
        HUMAN_DELIVERY_TARGET,
      ),
    TrackOnlyDistributionError,
  );
});

// ---------------------------------------------------------------------------
// 3. Key one: the authorized capper enters the approval path and stops there
// ---------------------------------------------------------------------------

async function submitAuthorizedPick(seed = 'authorized') {
  const repositories = createInMemoryRepositoryBundle();
  const response = await withEnv(AUTHORIZED_ENV, () =>
    handleSubmitPick({ body: capperSubmissionBody({}, seed), auth: CAPPER_AUTH }, repositories),
  );
  assert.ok(response.body.ok, 'authorized submission must be accepted');
  if (!response.body.ok) throw new Error('unreachable');
  return { repositories, data: response.body.data };
}

test('UTV2-1923: an authorized capper pick is delivery-eligible, braked, and carries no delivery work', async () => {
  const { repositories, data } = await submitAuthorizedPick();

  assert.equal(data.deliveryPosture, 'awaiting-approval');
  assert.equal(data.lifecycleState, 'awaiting_approval');
  assert.equal(data.outboxEnqueued, false);

  const pick = await repositories.picks.findPickById(data.pickId);
  assert.equal(pick?.status, 'awaiting_approval');

  const metadata = pick?.metadata as Record<string, unknown>;
  assert.equal(metadata['distributionMode'], 'delivery-eligible');
  assert.equal(isHumanCapperDeliveryAuthorized(metadata), true);
  assert.equal(readHumanCapperDeliveryAuthorization(metadata)?.capperId, CAPPER);

  // The scoring lane still stamps a `promotion_target` at submission time, for
  // a pick no model was ever asked to score. That is recorded here as measured
  // truth rather than asserted away: what matters is that the value cannot be
  // acted on, which the exclusivity guard below makes mechanical.
  await assert.rejects(
    () =>
      enqueueDistributionWork(
        {
          ...(pick as unknown as Record<string, unknown>),
          metadata: pick?.metadata,
          promotionStatus: 'qualified',
        } as never,
        repositories.outbox,
        `discord:${pick?.promotion_target ?? 'best-bets'}`,
      ),
    HumanDeliveryTargetMismatchError,
    'an authorized human pick must be refused at every board target',
  );

  const outbox = await repositories.outbox.listByPickId(data.pickId);
  assert.equal(outbox.length, 0, 'key one alone must produce no delivery work');

  const audit = await repositories.audit.listRecentByEntityType(
    'picks',
    new Date(0).toISOString(),
    'pick.human_capper_delivery_brake.applied',
  );
  const brake = audit.find((row) => (row.payload as Record<string, unknown>)['pickId'] === data.pickId);
  assert.ok(brake, 'the brake must be auditable');
  assert.equal((brake.payload as Record<string, unknown>)['outboxEnqueued'], false);
});

test('UTV2-1923: requeue is not a second delivery path for a human capper pick', async () => {
  const { repositories, data } = await submitAuthorizedPick('requeue');
  const response = await requeuePickController(data.pickId, repositories);
  assert.equal(response.status, 409);
  assert.ok(!response.body.ok);
  if (!response.body.ok) {
    assert.equal(response.body.error.code, 'HUMAN_DELIVERY_REQUEUE_BLOCKED');
  }
});

// ---------------------------------------------------------------------------
// 4. Key two: operator approval — and what it still cannot do on its own
// ---------------------------------------------------------------------------

test('UTV2-1923: operator approval with the target disabled enqueues nothing', async () => {
  // This is the shipped posture. Both keys are turned and delivery still does
  // not happen, because the target is disabled in the registry. That is what
  // "build only, do not activate" means mechanically.
  const { repositories, data } = await submitAuthorizedPick('approve-disabled');

  const review = await withEnv({ UNIT_TALK_ENABLED_TARGETS: undefined }, () =>
    reviewPickController(
      data.pickId,
      { decision: 'approve', reason: 'operator approved for member delivery', decidedBy: 'griff' },
      repositories,
    ),
  );

  assert.equal(review.status, 200);
  assert.ok(review.body.ok);
  if (!review.body.ok) return;

  assert.equal(review.body.data.humanDelivery?.enqueued, false);
  assert.equal(review.body.data.humanDelivery?.reason, 'target-disabled');

  const outbox = await repositories.outbox.listByPickId(data.pickId);
  assert.equal(outbox.length, 0, 'a disabled target must produce no outbox row');
});

test('UTV2-1923: with the target released, approval enqueues exactly one governed delivery', async () => {
  const { repositories, data } = await submitAuthorizedPick('approve-enabled');

  const review = await withEnv(
    { UNIT_TALK_ENABLED_TARGETS: HUMAN_TARGET, UNIT_TALK_APP_ENV: 'production' },
    () =>
      reviewPickController(
        data.pickId,
        { decision: 'approve', reason: 'operator approved for member delivery', decidedBy: 'griff' },
        repositories,
      ),
  );

  assert.ok(review.body.ok);
  if (!review.body.ok) return;

  assert.equal(review.body.data.humanDelivery?.enqueued, true);
  assert.equal(review.body.data.humanDelivery?.target, HUMAN_DELIVERY_TARGET);

  const outbox = await repositories.outbox.listByPickId(data.pickId);
  assert.equal(outbox.length, 1, 'exactly one delivery row, not zero and not two');
  assert.equal(outbox[0]?.target, HUMAN_DELIVERY_TARGET);

  const pick = await repositories.picks.findPickById(data.pickId);
  assert.equal(pick?.status, 'queued');

  const audit = await repositories.audit.listRecentByEntityType(
    'distribution_outbox',
    new Date(0).toISOString(),
    'distribution.enqueue',
  );
  const release = audit.find((row) => (row.payload as Record<string, unknown>)['pickId'] === data.pickId);
  assert.ok(release, 'the release must be auditable');
  assert.equal((release.payload as Record<string, unknown>)['approvedBy'], 'griff');
  assert.equal((release.payload as Record<string, unknown>)['capperId'], CAPPER);
});

test('UTV2-1923: denial voids the pick and delivers nothing', async () => {
  const { repositories, data } = await submitAuthorizedPick('deny');

  const review = await withEnv({ UNIT_TALK_ENABLED_TARGETS: HUMAN_TARGET }, () =>
    reviewPickController(
      data.pickId,
      { decision: 'deny', reason: 'not publishing this one', decidedBy: 'griff' },
      repositories,
    ),
  );

  assert.ok(review.body.ok);
  const pick = await repositories.picks.findPickById(data.pickId);
  assert.equal(pick?.status, 'voided');
  const outbox = await repositories.outbox.listByPickId(data.pickId);
  assert.equal(outbox.length, 0);
});

test('UTV2-1923: an unauthorized pick cannot be enqueued to the human target by any direct caller', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await withEnv({ UNIT_TALK_ENABLED_TARGETS: HUMAN_TARGET }, async () => {
    await assert.rejects(
      () =>
        enqueueDistributionWork(
          {
            id: 'unauthorized-pick',
            submissionId: 's',
            market: 'NFL moneyline',
            selection: 'Chiefs ML',
            source: 'smart-form',
            approvalStatus: 'approved',
            promotionStatus: 'qualified',
            promotionTarget: 'best-bets',
            lifecycleState: 'validated',
            metadata: { distributionMode: 'delivery-eligible' },
            createdAt: new Date().toISOString(),
          } as never,
          repositories.outbox,
          HUMAN_DELIVERY_TARGET,
        ),
      HumanDeliveryNotAuthorizedError,
    );
  });
});

test('UTV2-1923: the model lane is untouched — a promotion target still requires a qualified pick', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await withEnv({ UNIT_TALK_ENABLED_TARGETS: 'best-bets' }, async () => {
    await assert.rejects(
      () =>
        enqueueDistributionWork(
          {
            id: 'unqualified-pick',
            submissionId: 's',
            market: 'NFL moneyline',
            selection: 'Chiefs ML',
            source: 'smart-form',
            approvalStatus: 'approved',
            promotionStatus: 'eligible',
            promotionTarget: 'best-bets',
            lifecycleState: 'validated',
            metadata: { distributionMode: 'delivery-eligible' },
            createdAt: new Date().toISOString(),
          } as never,
          repositories.outbox,
          'discord:best-bets',
        ),
      /not qualified for best-bets/u,
    );
  });
});

// ---------------------------------------------------------------------------
// 4b. Manual settlement and the immediate per-pick recap (W4)
// ---------------------------------------------------------------------------

/** Drives one pick all the way to a `sent` delivery, the way the worker would. */
async function deliverApprovedPick(seed: string) {
  const { repositories, data } = await submitAuthorizedPick(seed);
  await withEnv({ UNIT_TALK_ENABLED_TARGETS: HUMAN_TARGET }, () =>
    reviewPickController(
      data.pickId,
      { decision: 'approve', reason: 'operator approved for member delivery', decidedBy: 'griff' },
      repositories,
    ),
  );

  const claimed = await repositories.outbox.claimNext(HUMAN_DELIVERY_TARGET, 'proof-worker');
  assert.ok(claimed, 'the approved pick must be claimable by a worker polling the human target');
  await repositories.outbox.markSent(claimed.id);
  await repositories.picks.updatePickLifecycleState(data.pickId, 'posted');

  return { repositories, pickId: data.pickId, outboxId: claimed.id };
}

const SETTLEMENT = {
  status: 'settled' as const,
  result: 'win' as const,
  source: 'operator' as const,
  confidence: 'confirmed' as const,
  evidenceRef: 'utv2-1923://manual-settlement',
  settledBy: 'griff',
  notes: 'UTV2-1923 manual settlement of a human capper pick',
};

test('UTV2-1923: a manually settled human pick settles, and its recap is gated by the kill switch', async () => {
  const { repositories, pickId } = await deliverApprovedPick('settle-killed');

  const response = await withEnv({ UNIT_TALK_APP_ENV: 'production' }, () =>
    settlePickController(pickId, SETTLEMENT, repositories),
  );

  assert.equal(response.status, 201);
  assert.ok(response.body.ok);
  if (!response.body.ok) return;

  assert.equal(response.body.data.settlementStatus, 'settled');
  assert.equal(response.body.data.settlementResult, 'win');
  assert.equal(response.body.data.finalLifecycleState, 'settled');

  // The recap posts by direct `fetch`, outside the outbox, so the worker's
  // kill-switch check never sees it. The settle controller has to ask the
  // switch itself -- otherwise the operator's stop could halt the pick and not
  // the recap about the pick.
  assert.equal(response.body.data.humanCapperRecap?.posted, false);
  assert.equal(response.body.data.humanCapperRecap?.reason, 'kill-switch-engaged');
});

test('UTV2-1923: with the target released, the recap is attempted and reports why it did not post', async () => {
  const { repositories, pickId } = await deliverApprovedPick('settle-released');
  await repositories.killSwitch?.setKilled({
    target: HUMAN_TARGET,
    killed: false,
    actor: 'griff',
  });

  const response = await withEnv(
    { UNIT_TALK_APP_ENV: 'production', DISCORD_BOT_TOKEN: undefined },
    () => settlePickController(pickId, SETTLEMENT, repositories),
  );

  assert.ok(response.body.ok);
  if (!response.body.ok) return;

  // Not posted -- there is no Discord bot token in this environment -- but the
  // distinction that matters is that it is a *reported* reason rather than
  // silence. Before this lane `postSettlementRecapIfPossible` returned void, so
  // "posted", "no token" and "threw" were indistinguishable to every caller.
  const recap = response.body.data.humanCapperRecap;
  assert.ok(recap, 'an authorized human pick must always report a recap outcome');
  assert.equal(recap.posted, false);
  assert.ok(recap.reason && recap.reason.length > 0, 'a non-post must name its reason');
  assert.notEqual(
    recap.reason,
    'kill-switch-engaged',
    'the released switch must no longer be the reason',
  );
});

test('UTV2-1923: a Track Only settlement still gets no immediate production recap', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const submitted = await withEnv(CONTAINED_ENV, () =>
    handleSubmitPick(
      { body: capperSubmissionBody({}, 'settle-track-only'), auth: CAPPER_AUTH },
      repositories,
    ),
  );
  assert.ok(submitted.body.ok);
  if (!submitted.body.ok) return;

  // A Track Only pick never leaves the evidence plane, and settling one
  // requires the operator grading context UTV2-1904 introduced. That is the
  // existing contract, unchanged by this lane.
  const response = await withEnv({ UNIT_TALK_APP_ENV: 'production' }, () =>
    settlePickController(
      submitted.body.ok ? submitted.body.data.pickId : '',
      {
        ...SETTLEMENT,
        operatorGradingContext: {
          outcomeBasis: 'UTV2-1923 proof fixture; no real result was observed',
          resultSourceUrl: 'https://example.invalid/utv2-1923-proof-fixture',
          observedAt: new Date().toISOString(),
        },
      },
      repositories,
    ),
  );

  assert.ok(response.body.ok);
  if (!response.body.ok) return;
  assert.equal(
    response.body.data.humanCapperRecap,
    undefined,
    'the human capper recap path must not open for a Track Only pick',
  );
});

// ---------------------------------------------------------------------------
// 5. Mutation controls — each guard must fail on the condition it names
// ---------------------------------------------------------------------------

async function withGuardRemoved<T>(
  relativeModulePath: string,
  guardName: string,
  run: (mutant: Record<string, unknown>) => Promise<T>,
): Promise<T> {
  const sourcePath = fileURLToPath(new URL(relativeModulePath, import.meta.url));
  const suffix = `__mutant_${guardName}_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const mutantPath = sourcePath.replace(/\.ts$/u, `${suffix}.ts`);
  const source = await readFile(sourcePath, 'utf8');
  const guardPattern = new RegExp(
    `[ ]*// UTV2-1923 ${guardName}_START[\\s\\S]*?// UTV2-1923 ${guardName}_END\\n`,
    'u',
  );
  const mutantSource = source.replace(guardPattern, '');
  assert.notEqual(mutantSource, source, `mutation control could not remove ${guardName}`);
  await writeFile(mutantPath, mutantSource, 'utf8');
  try {
    const mutant = (await import(
      `${pathToFileURL(mutantPath).href}?mutation=${guardName}`
    )) as Record<string, unknown>;
    return await run(mutant);
  } finally {
    await unlink(mutantPath).catch(() => undefined);
  }
}

test('mutation control: without the forgery guard, a client-supplied record authorizes delivery', async () => {
  const forged = {
    version: 'human-capper-delivery/v1',
    decision: 'authorized',
    capperId: CAPPER,
    authority: 'server-allowlist',
    allowlistSource: 'UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST',
    decidedAt: new Date().toISOString(),
  };

  await withGuardRemoved(
    './handlers/submit-pick.ts',
    'CAPPER_DELIVERY_AUTHORIZATION_FORGERY_GUARD',
    async (mutant) => {
      const mutantHandler = mutant['handleSubmitPick'] as typeof handleSubmitPick;
      const repositories = createInMemoryRepositoryBundle();
      const response = await withEnv(AUTHORIZED_ENV, () =>
        mutantHandler(
          {
            body: {
              ...capperSubmissionBody(
                { distributionMode: 'delivery-eligible', deliveryAuthorization: forged },
                'mutant-forged',
              ),
              submittedBy: 'operator',
            },
            auth: null,
          },
          repositories,
        ),
      );

      assert.ok(response.body.ok, 'mutant must accept the forged submission');
      if (!response.body.ok) return;
      const pick = await repositories.picks.findPickById(response.body.data.pickId);
      assert.equal(
        isHumanCapperDeliveryAuthorized(pick?.metadata as Record<string, unknown>),
        true,
        'with the guard removed, a forged client record must read as real authorization',
      );
    },
  );
});

test('mutation control: without the enqueue authorization guard, an unauthorized pick reaches the outbox', async () => {
  await withGuardRemoved(
    './distribution-service.ts',
    'HUMAN_DELIVERY_ENQUEUE_AUTHORIZATION_GUARD',
    async (mutant) => {
      const mutantEnqueue = mutant['enqueueDistributionWork'] as typeof enqueueDistributionWork;
      const repositories = createInMemoryRepositoryBundle();
      await withEnv({ UNIT_TALK_ENABLED_TARGETS: HUMAN_TARGET }, async () => {
        const result = await mutantEnqueue(
          {
            id: 'unauthorized-pick-mutant',
            submissionId: 's',
            market: 'NFL moneyline',
            selection: 'Chiefs ML',
            source: 'smart-form',
            approvalStatus: 'approved',
            promotionStatus: 'eligible',
            promotionTarget: null,
            lifecycleState: 'validated',
            metadata: { distributionMode: 'delivery-eligible' },
            createdAt: new Date().toISOString(),
          } as never,
          repositories.outbox,
          HUMAN_DELIVERY_TARGET,
        );
        assert.ok(
          (result as { outboxRecord?: unknown }).outboxRecord,
          'with the guard removed, an unauthorized pick must reach the outbox',
        );
      });
    },
  );
});

test('mutation control: without the submit brake, an authorized pick is not parked for approval', async () => {
  await withGuardRemoved(
    './controllers/submit-pick-controller.ts',
    'HUMAN_DELIVERY_BRAKE_GUARD',
    async (mutant) => {
      const mutantController = mutant['submitPickController'] as typeof submitPickController;
      const repositories = createInMemoryRepositoryBundle();
      const authorization = await withEnv(AUTHORIZED_ENV, () =>
        evaluateCapperDeliveryAuthorization({ capperId: CAPPER, isAuthenticatedCapper: true }),
      );
      const payload = {
        ...capperSubmissionBody(
          { distributionMode: 'delivery-eligible', deliveryAuthorization: authorization },
          'mutant-brake',
        ),
      } as unknown as SubmissionPayload;

      const response = await mutantController(payload, repositories);
      assert.ok(response.body.ok);
      if (!response.body.ok) return;
      assert.notEqual(
        response.body.data.lifecycleState,
        'awaiting_approval',
        'with the brake removed, an authorized pick must NOT be parked for approval',
      );
      assert.equal(response.body.data.deliveryPosture, undefined);
    },
  );
});

test('mutation control: without the requeue guard, a human capper pick can re-enter the model requeue path', async () => {
  await withGuardRemoved(
    './controllers/requeue-controller.ts',
    'REQUEUE_HUMAN_DELIVERY_GUARD',
    async (mutant) => {
      const mutantRequeue = mutant['requeuePickController'] as typeof requeuePickController;
      const { repositories, data } = await submitAuthorizedPick('mutant-requeue');
      // With the guard removed the route no longer recognises the pick as
      // human delivery at all: it falls through to the generic requeue path and
      // tries to enqueue the pick to its board `promotion_target`. That it is
      // then caught by the awaiting-approval brake is defence in depth, not the
      // guard under test -- the observable difference is that the refusal is no
      // longer HUMAN_DELIVERY_REQUEUE_BLOCKED, and the target it reached for is
      // a board target.
      await assert.rejects(
        () => mutantRequeue(data.pickId, repositories),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /discord:best-bets/u);
          return true;
        },
        'with the guard removed, the requeue route must fall through to the board path',
      );
    },
  );
});

test('mutation control: without the exclusivity guard, a human pick can be delivered to a board target', async () => {
  await withGuardRemoved(
    './distribution-service.ts',
    'HUMAN_DELIVERY_TARGET_EXCLUSIVITY_GUARD',
    async (mutant) => {
      const mutantEnqueue = mutant['enqueueDistributionWork'] as typeof enqueueDistributionWork;
      const { repositories, data } = await submitAuthorizedPick('mutant-exclusivity');
      const pick = await repositories.picks.findPickById(data.pickId);

      await withEnv({ UNIT_TALK_ENABLED_TARGETS: 'best-bets' }, async () => {
        const result = await mutantEnqueue(
          {
            ...(pick as unknown as Record<string, unknown>),
            metadata: pick?.metadata,
            promotionStatus: 'qualified',
            promotionTarget: 'best-bets',
          } as never,
          repositories.outbox,
          'discord:best-bets',
        );
        assert.ok(
          (result as { outboxRecord?: unknown }).outboxRecord,
          'with the guard removed, the submission-time promotion target becomes a live board delivery',
        );
      });
    },
  );
});

// ---------------------------------------------------------------------------
// 6. Containment: nothing else was activated
// ---------------------------------------------------------------------------

test('UTV2-1923: no model/board delivery target changed its shipped posture', () => {
  const registry = resolveTargetRegistry({});
  for (const target of promotionTargets) {
    const before = defaultTargetRegistry.find((e) => e.target === target);
    const after = registry.find((e) => e.target === target);
    assert.ok(before && after);
    assert.equal(
      after.enabled,
      before.enabled,
      `${target} must keep its shipped enabled state — this lane changes no model target`,
    );
  }
});
