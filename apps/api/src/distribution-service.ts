import {
  isHumanCapperDeliveryAuthorized,
  isTrackOnlyPickMetadata,
  type CanonicalPick,
  type PickSource,
} from '@unit-talk/contracts';
import type { OutboxRecord, OutboxRepository } from '@unit-talk/db';
import { buildDistributionWorkItem } from '@unit-talk/domain';
import {
  evaluateWorkerTargetCoverage,
  formatWorkerTargetCoverageError,
  isHumanDeliveryTarget,
  isTargetEnabled,
  parseGovernedTargetFromDeliveryTarget,
  parsePromotionTargetFromDeliveryTarget,
  resolveTargetRegistry,
  type GovernedDeliveryTarget,
  type PromotionTarget,
  type TargetRegistryEntry,
  type WorkerTargetCoverageReport,
} from '@unit-talk/contracts';

export interface DistributionEnqueueResult {
  pickId: string;
  target: string;
  outboxRecord: OutboxRecord;
}

export interface DistributionSkippedResult {
  enqueued: false;
  reason: 'target-disabled' | 'duplicate-pending';
  target: string;
  existingOutboxId?: string;
}

export interface DistributionTargetGateAllowed {
  ok: true;
  /**
   * UTV2-1923: renamed from `requestedPromotionTarget`, because it is no
   * longer only promotion targets. It is every governed destination — the
   * three model/board targets plus the human capper target — and it is what
   * decides whether the registry, coverage and kill-switch controls apply.
   */
  requestedGovernedTarget: GovernedDeliveryTarget | null;
  /**
   * Retained for the existing readers that only care about the model/board
   * lane. It is `null` for the human capper target -- which is correct, and is
   * why it could not simply be widened: a caller reading this field is asking
   * "is this a promotion target?", and the honest answer for `official-picks`
   * is no.
   */
  requestedPromotionTarget: PromotionTarget | null;
  resolvedTarget: string;
}

export interface DistributionTargetGateSkipped {
  ok: false;
  reason: 'target-disabled';
  requestedGovernedTarget: GovernedDeliveryTarget;
  requestedPromotionTarget: PromotionTarget | null;
  resolvedTarget: string;
}

export type DistributionTargetGate =
  | DistributionTargetGateAllowed
  | DistributionTargetGateSkipped;

export interface DistributionTargetValidationStats {
  rejectedTargetMismatchCount: number;
}

let rejectedTargetMismatchCount = 0;

export class DistributionTargetMismatchError extends Error {
  public readonly report: WorkerTargetCoverageReport;

  constructor(report: WorkerTargetCoverageReport) {
    super(`Distribution target mismatch: ${formatWorkerTargetCoverageError(report)}`);
    this.name = 'DistributionTargetMismatchError';
    this.report = report;
  }
}

export function getDistributionTargetValidationStats(): DistributionTargetValidationStats {
  return { rejectedTargetMismatchCount };
}

export function resetDistributionTargetValidationStats(): void {
  rejectedTargetMismatchCount = 0;
}

/**
 * Phase 7A governance brake: pick sources that must NOT auto-enqueue for
 * distribution on submission. These are autonomous non-human producers whose
 * picks must land in `awaiting_approval` and wait for operator review before
 * any queueing.
 *
 * This set is the single source of truth for the brake — consulted by
 * `submit-pick-controller` (primary enforcement) and used to reason about
 * defense-in-depth guards in `run-audit-service` and `enqueueDistributionWork`.
 *
 * UTV2-1611: `board-construction` is now IN this set. The earlier exclusion
 * ("operator-triggered") did not match repo truth — `board-pick-writer` is a
 * scheduled, autonomous producer, and scheduling flags only start it; they
 * never authorize a release. Leaving the source out meant the only thing
 * standing between a board production and `validated` was whether the producer
 * remembered to stamp `metadata.systemGenerated`, so a single missing marker
 * released an ungoverned pick. Source membership is the fallback brake that
 * makes governance independent of producer discipline: even a submission that
 * never reaches the automated write boundary cannot auto-enqueue.
 *
 * `automated-write-boundary.ts` asserts at module load that every source it
 * classifies as automated is a member of this set, so the two mechanisms
 * cannot silently drift apart.
 */
export const GOVERNANCE_BRAKE_SOURCES: ReadonlySet<PickSource> = new Set<PickSource>([
  'system-pick-scanner',
  'alert-agent',
  'model-driven',
  'board-construction',
]);

export function isGovernanceBrakeSource(source: PickSource): boolean {
  return GOVERNANCE_BRAKE_SOURCES.has(source);
}

/**
 * UTV2-1923 — what operator approval is FOR, stated where it is enforced.
 *
 * Operator approval governs AUTONOMOUS PRODUCERS: something inside this system
 * decided, by itself, that a pick should exist. Nobody outside the system is
 * accountable for that decision, so a human ratifies it before members see it.
 * That is the entire membership rule for `GOVERNANCE_BRAKE_SOURCES`, and every
 * member of the set is such a producer.
 *
 * It does NOT govern an AUTHORIZED HUMAN CAPPER. A capper on the server-side
 * allow-list has already been judged — by the operator who put them on the
 * list — and each pick is a person's own accountable selection. There is no
 * second question for an operator to answer, so an authorized capper's
 * submission is delivered immediately by `submit-pick-controller` and never
 * enters `awaiting_approval`.
 *
 * The two rules are therefore keyed on different things and must stay that way:
 * approval on the pick's SOURCE, human delivery on the server's AUTHORIZATION
 * of the capper. Neither may be derived from the other, and in particular a
 * refused delivery control (target disabled, or killed) is not a reason to
 * treat a human pick as awaiting approval — it is fail-closed, full stop.
 *
 * `humanCapperDeliveryRequiresOperatorApproval` exists so that this is a
 * mechanically testable statement rather than a comment that can rot. It is
 * a constant, deliberately: if a future change makes it conditional, the
 * conditions have to be written down and argued for in review.
 */
export const humanCapperDeliveryRequiresOperatorApproval = false as const;

/**
 * True when a pick of this source needs an operator to ratify it before member
 * delivery. Human ingress sources answer false — including the Smart Form,
 * which is how an authorized human capper submits.
 */
export function requiresOperatorApprovalBeforeDelivery(source: PickSource): boolean {
  return isGovernanceBrakeSource(source);
}

/**
 * Thrown when a caller attempts to enqueue a pick whose lifecycle state is
 * `awaiting_approval`. Picks in this state must go through operator approval
 * (which transitions to `queued` via the review controller) before any
 * distribution path is allowed to run.
 */
export class AwaitingApprovalBrakeError extends Error {
  public readonly pickId: string;
  public readonly target: string;

  constructor(pickId: string, target: string) {
    super(
      `Distribution blocked: pick ${pickId} is in awaiting_approval lifecycle state. ` +
        `Target ${target} cannot be enqueued until operator review advances the pick to queued.`,
    );
    this.name = 'AwaitingApprovalBrakeError';
    this.pickId = pickId;
    this.target = target;
  }
}

export class TrackOnlyDistributionError extends Error {
  public readonly pickId: string;
  public readonly target: string;

  constructor(pickId: string, target: string) {
    super(`Distribution blocked: pick ${pickId} is marked track-only and cannot be delivered to ${target}.`);
    this.name = 'TrackOnlyDistributionError';
    this.pickId = pickId;
    this.target = target;
  }
}

/**
 * UTV2-1923: thrown when a caller attempts to enqueue human-capper delivery
 * for a pick that carries no server authorization to be delivered.
 *
 * Distinct from `TrackOnlyDistributionError` on purpose: a Track Only pick was
 * never meant to be delivered at all, whereas this is a pick that reached a
 * delivery path it is not entitled to. They are different failures and an
 * operator needs to be able to tell them apart.
 */
export class HumanDeliveryNotAuthorizedError extends Error {
  public readonly pickId: string;
  public readonly target: string;

  constructor(pickId: string, target: string) {
    super(
      `Distribution blocked: pick ${pickId} carries no server delivery authorization and cannot be delivered to ${target}.`,
    );
    this.name = 'HumanDeliveryNotAuthorizedError';
    this.pickId = pickId;
    this.target = target;
  }
}

/**
 * UTV2-1923 -- a server-authorized human capper pick may be delivered to the
 * governed human target and to nothing else.
 *
 * The scoring pipeline still assigns `promotion_target` at submission time, so
 * a human capper pick carries a board target it was never scored for. Nothing
 * currently routes on it -- the approval path skips promotion re-evaluation and
 * the requeue route refuses human picks outright -- but "nothing currently
 * routes on it" is a statement about today's callers, not a property of the
 * pick. This makes it a property of the pick.
 */
export class HumanDeliveryTargetMismatchError extends Error {
  public readonly pickId: string;
  public readonly target: string;

  constructor(pickId: string, target: string) {
    super(
      `Distribution blocked: pick ${pickId} is an authorized human capper pick and cannot be delivered to ${target}; human capper delivery routes only to the governed human target.`,
    );
    this.name = 'HumanDeliveryTargetMismatchError';
    this.pickId = pickId;
    this.target = target;
  }
}


/**
 * Thrown when a caller attempts to enqueue a pick to a delivery target that is
 * not supported by the worker. Only two categories of non-promotion targets are
 * valid: discord:canary (canonical canary lane) and discord:<numericChannelId>
 * (direct numeric channel IDs). Any other unknown target fails closed to
 * prevent silent stranding of rows the worker will never claim.
 */
export class UnsupportedDeliveryTargetError extends Error {
  public readonly target: string;

  constructor(target: string) {
    super(
      'Delivery target "' + target + '" is not supported by the worker. ' +
        'Only discord:canary and discord:<numericChannelId> are valid non-promotion targets. ' +
        'Use a promotion target (best-bets, trader-insights, exclusive-insights) or a supported direct channel ID.',
    );
    this.name = 'UnsupportedDeliveryTargetError';
    this.target = target;
  }
}

/**
 * Terminal outbox statuses that allow a new enqueue for the same pick+target.
 * Rows in these states represent completed or abandoned delivery attempts.
 */
const ACTIVE_OUTBOX_STATUSES = ['pending', 'processing'] as const;

export function resolveDeliveryTarget(
  target: string,
  env: { UNIT_TALK_APP_ENV?: string | undefined } = process.env,
) {
  // In local/dev execution we preserve business truth on picks.promotion_target, but
  // delivery itself must fail-closed to discord:canary so nothing reaches a live lane.
  if (
    env.UNIT_TALK_APP_ENV === 'local' &&
    target.startsWith('discord:') &&
    target !== 'discord:canary'
  ) {
    return 'discord:canary';
  }

  return target;
}

function isSupportedNonPromotionTarget(target: string): boolean {
  if (target === 'discord:canary') return true;
  // discord:<numericChannelId> format — resolveDiscordChannelId handles these natively
  const channelId = target.startsWith('discord:') ? target.slice('discord:'.length) : '';
  return /^\d+$/.test(channelId);
}

export function evaluateDistributionTargetGate(
  target: string,
  targetRegistry?: TargetRegistryEntry[],
  env: {
    UNIT_TALK_APP_ENV?: string | undefined;
    UNIT_TALK_DISTRIBUTION_TARGETS?: string | undefined;
    UNIT_TALK_ENABLED_TARGETS?: string | undefined;
    UNIT_TALK_ROLLOUT_CONFIG?: string | undefined;
  } = process.env,
): DistributionTargetGate {
  const registry = targetRegistry ?? resolveTargetRegistry(env);
  const requestedGovernedTarget = parseGovernedTargetFromDeliveryTarget(target);
  const requestedPromotionTarget = parsePromotionTargetFromDeliveryTarget(target);
  const resolvedTarget = resolveDeliveryTarget(target, env);

  if (!requestedGovernedTarget) {
    if (!isSupportedNonPromotionTarget(target)) {
      throw new UnsupportedDeliveryTargetError(target);
    }
    return { ok: true, requestedGovernedTarget, requestedPromotionTarget, resolvedTarget };
  }

  if (!isTargetEnabled(requestedGovernedTarget, registry)) {
    return {
      ok: false,
      reason: 'target-disabled',
      requestedGovernedTarget,
      requestedPromotionTarget,
      resolvedTarget,
    };
  }

  const configuredWorkerTargets = readConfiguredWorkerTargets(env);
  if (configuredWorkerTargets !== undefined) {
    const report = evaluateWorkerTargetCoverage({
      registry,
      workerTargets: configuredWorkerTargets,
      appEnv: env.UNIT_TALK_APP_ENV,
    });

    if (!report.ok) {
      rejectedTargetMismatchCount += report.rejectedTargetMismatchCount;
      throw new DistributionTargetMismatchError(report);
    }
  }

  return { ok: true, requestedGovernedTarget, requestedPromotionTarget, resolvedTarget };
}

export async function enqueueDistributionWork(
  pick: CanonicalPick,
  outboxRepository: OutboxRepository,
  target: string,
  targetRegistry?: TargetRegistryEntry[],
): Promise<DistributionEnqueueResult | DistributionSkippedResult> {
  // UTV2-1672 TRACK_ONLY_DIRECT_ENQUEUE_GUARD_START
  if (isTrackOnlyPickMetadata(pick.metadata)) {
    throw new TrackOnlyDistributionError(pick.id, target);
  }
  // UTV2-1672 TRACK_ONLY_DIRECT_ENQUEUE_GUARD_END
  const registry = targetRegistry ?? resolveTargetRegistry();
  const targetGate = evaluateDistributionTargetGate(target, registry);
  const requestedGovernedTarget = targetGate.requestedGovernedTarget;
  const resolvedTarget = targetGate.resolvedTarget;

  // Phase 7A governance brake: refuse to enqueue picks that are currently
  // parked in `awaiting_approval`. Defense-in-depth — the primary brake is
  // at the controller level, this catches any path that bypasses it.
  if (pick.lifecycleState === 'awaiting_approval') {
    throw new AwaitingApprovalBrakeError(pick.id, target);
  }

  if (!targetGate.ok) {
    return { enqueued: false, reason: 'target-disabled', target };
  }

  // UTV2-1923 HUMAN_DELIVERY_ENQUEUE_AUTHORIZATION_GUARD_START
  // The human capper target does not go through promotion scoring, so the two
  // promotion checks below cannot govern it -- `promotionStatus` is never
  // `qualified` for a pick no model ever scored, and `promotionTarget` is
  // deliberately left null. Its equivalent gate is the server's own
  // authorization record. This is the last line of defence: even a caller that
  // reached this function directly cannot enqueue human delivery for a pick
  // the allow-list never authorized.
  if (requestedGovernedTarget && isHumanDeliveryTarget(requestedGovernedTarget)) {
    if (!isHumanCapperDeliveryAuthorized(pick.metadata)) {
      throw new HumanDeliveryNotAuthorizedError(pick.id, target);
    }
  } else if (requestedGovernedTarget) {
    // UTV2-1923 HUMAN_DELIVERY_TARGET_EXCLUSIVITY_GUARD_START
    // An authorized human capper pick must never reach a board target. It
    // carries a `promotion_target` the scoring lane assigned at submission
    // time, so the two promotion checks below can pass for it on their own
    // terms -- they were written for picks a model actually scored.
    if (isHumanCapperDeliveryAuthorized(pick.metadata)) {
      throw new HumanDeliveryTargetMismatchError(pick.id, target);
    }
    // UTV2-1923 HUMAN_DELIVERY_TARGET_EXCLUSIVITY_GUARD_END

    if (pick.promotionStatus !== 'qualified' && pick.promotionStatus !== 'promoted') {
      throw new Error(
        `${formatTargetLabel(requestedGovernedTarget)} routing is blocked: pick is not qualified for ${requestedGovernedTarget}`,
      );
    }

    if (pick.promotionTarget !== requestedGovernedTarget) {
      throw new Error(
        `${formatTargetLabel(requestedGovernedTarget)} routing is blocked: pick promotion target is not ${requestedGovernedTarget}`,
      );
    }
  }
  // UTV2-1923 HUMAN_DELIVERY_ENQUEUE_AUTHORIZATION_GUARD_END

  // Idempotency guard: reject enqueue if a pending or processing row already exists
  const existingActive = await outboxRepository.findByPickAndTarget(
    pick.id,
    resolvedTarget,
    ACTIVE_OUTBOX_STATUSES,
  );

  if (existingActive) {
    return {
      enqueued: false,
      reason: 'duplicate-pending',
      target,
      existingOutboxId: existingActive.id,
    };
  }

  const workItem = buildDistributionWorkItem(pick, resolvedTarget);
  const outboxRecord = await outboxRepository.enqueue({
    pickId: workItem.pickId,
    target: workItem.target,
    payload: workItem.payload,
    idempotencyKey: workItem.idempotencyKey,
  });

  return {
    pickId: pick.id,
    target: resolvedTarget,
    outboxRecord,
  };
}

function readConfiguredWorkerTargets(env: { UNIT_TALK_DISTRIBUTION_TARGETS?: string | undefined }) {
  if (!Object.prototype.hasOwnProperty.call(env, 'UNIT_TALK_DISTRIBUTION_TARGETS')) {
    return undefined;
  }

  return (env.UNIT_TALK_DISTRIBUTION_TARGETS ?? '')
    .split(',')
    .map((target) => target.trim())
    .filter((target) => target.length > 0);
}

function formatTargetLabel(target: GovernedDeliveryTarget) {
  if (target === 'best-bets') {
    return 'Best Bets';
  }

  if (target === 'trader-insights') {
    return 'Trader Insights';
  }

  if (target === 'official-picks') {
    return 'Official Picks';
  }

  return 'Exclusive Insights';
}
