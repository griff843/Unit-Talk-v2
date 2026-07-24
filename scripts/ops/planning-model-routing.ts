/**
 * Canonical planning/review model routing for Claude lanes (UTV2-1569).
 *
 * This is the mechanical fix for the finding that closed the earlier attempt at this
 * pilot (PR #1287, unmerged): "/dispatch still hard-codes Sonnet regardless of what the
 * routing docs say." Before this module existed, `.claude/commands/dispatch.md`'s T1
 * planning Agent() call and Phase 5 critique Agent() call both used the literal string
 * `"sonnet"` -- so even after `three-brain.md` grew a Fable pilot row, nothing
 * downstream ever consumed it. This module is the single function `/dispatch` and
 * `/three-brain` must call to get a real, policy-backed, fail-closed model decision --
 * dispatch.md's Agent() calls now pass this module's `.model` output instead of a
 * hardcoded literal.
 *
 * Two independent, non-overlapping decisions live in this repo:
 *   - Codex model-PROFILE routing (scripts/ops/model-routing.ts) -- which concrete
 *     Codex model/reasoning-effort executes a Codex lane. Unrelated to this module.
 *   - Claude planning/review MODEL routing (this module) -- Sonnet by default, Fable 5
 *     only for the four ratified pilot trigger classes, and only while the pilot is
 *     both policy-enabled AND in state "active" and within its caps
 *     (scripts/ops/fable-pilot-state.ts). Every other case fails closed to Sonnet.
 *
 * Fail-closed guarantee: resolvePlanningModel() and resolveFableAdvisoryReview() can
 * NEVER return `claude-fable-5` unless ALL of the following hold simultaneously:
 *   1. docs/05_operations/policies/fable-pilot-policy.json's `pilot_enabled` is true.
 *   2. The requested trigger class is one of the four enabled entries in that policy's
 *      `trigger_classes` (and not in `skip_list`).
 *   3. docs/05_operations/FABLE_PILOT_STATE.json reads back `PILOT_ACTIVE_WITHIN_CAPS`
 *      via scripts/ops/fable-pilot-state.ts#readFablePilotState.
 * Any one of these failing produces a `fallback_used: true` result routed to Sonnet,
 * never a thrown error and never a silent continue -- callers always get a usable
 * planning model.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, parseJsonFile } from './shared.js';
import {
  readFablePilotState,
  recordQualifyingTask,
  writeFablePilotState,
  type FablePilotCheckResult,
} from './fable-pilot-state.js';

export type ClaudePlanningModel = 'claude-sonnet-5' | 'claude-fable-5';

export type FableTriggerClass =
  | 'repeated_architecture_bounce'
  | 'live_state_root_cause'
  | 'product_synthesis_no_precedent'
  | 'build_mode_certification_review';

const KNOWN_TRIGGER_CLASSES: readonly FableTriggerClass[] = [
  'repeated_architecture_bounce',
  'live_state_root_cause',
  'product_synthesis_no_precedent',
  'build_mode_certification_review',
];

export interface FablePilotTriggerClassEntry {
  enabled: boolean;
  profile: string;
  description: string;
}

export interface FablePilotPolicy {
  policy_version: string;
  schema_version: 1;
  pilot_enabled: boolean;
  default_model: ClaudePlanningModel;
  default_profile: string;
  fable_model: ClaudePlanningModel;
  trigger_classes: Record<FableTriggerClass, FablePilotTriggerClassEntry>;
  skip_list: string[];
  caps: {
    max_qualifying_tasks: number;
    max_days: number;
    usage_ceiling_usd: number;
    /**
     * Recorded against FABLE_PILOT_STATE.json's usage_used_usd at the moment a Fable
     * selection is made (UTV2-1569 PR #1292 fix) -- the real per-task dollar cost is not
     * knowable at selection time, so the policy fixes a conservative estimate that is
     * recorded atomically with the routing decision itself, rather than deferring usage
     * accounting to some later step that might never run.
     */
    estimated_usage_per_task_usd: number;
  };
  advisory_only: boolean;
  binding_authority: boolean;
  reviewer_independence_required: boolean;
  fallback_model: ClaudePlanningModel;
}

export type PlanningModelSelectedBy = 'three-brain' | 'manual-override';

export interface PlanningModelRoutingBlock {
  model: ClaudePlanningModel;
  profile: string;
  selected_by: PlanningModelSelectedBy;
  rationale: string;
  policy_version: string;
  fallback_used: boolean;
  fallback_model?: ClaudePlanningModel;
  requested_model?: ClaudePlanningModel;
  fallback_reason?: string;
}

export type PlanningModelResolutionCode =
  | 'OK_SONNET_DEFAULT'
  | 'OK_FABLE_SELECTED'
  | 'FALLBACK_POLICY_DISABLED'
  | 'FALLBACK_UNKNOWN_TRIGGER_CLASS'
  | 'FALLBACK_TRIGGER_CLASS_DISABLED'
  | 'FALLBACK_SKIP_LISTED'
  | 'FALLBACK_PILOT_NOT_ELIGIBLE'
  | 'FALLBACK_MISSING_REVIEWER_INDEPENDENCE'
  | 'POLICY_LOAD_FAILED';

export interface PlanningModelResolution {
  ok: boolean;
  code: PlanningModelResolutionCode;
  message: string;
  routing?: PlanningModelRoutingBlock;
}

export const FABLE_PILOT_POLICY_PATH = path.join(
  ROOT,
  'docs',
  '05_operations',
  'policies',
  'fable-pilot-policy.json',
);

export function loadFablePilotPolicy(policyPath = FABLE_PILOT_POLICY_PATH): FablePilotPolicy {
  if (!fs.existsSync(policyPath)) {
    throw new Error(`Fable pilot policy not found: ${policyPath}`);
  }
  const policy = parseJsonFile<FablePilotPolicy>(policyPath);
  validatePolicyShape(policy);
  return policy;
}

function validatePolicyShape(policy: FablePilotPolicy): void {
  if (policy.schema_version !== 1) {
    throw new Error('fable-pilot-policy.json schema_version must be 1');
  }
  if (!policy.policy_version || typeof policy.policy_version !== 'string') {
    throw new Error('fable-pilot-policy.json policy_version is required');
  }
  if (typeof policy.pilot_enabled !== 'boolean') {
    throw new Error('fable-pilot-policy.json pilot_enabled must be a boolean');
  }
  if (!policy.trigger_classes || typeof policy.trigger_classes !== 'object') {
    throw new Error('fable-pilot-policy.json trigger_classes is required');
  }
  for (const triggerClass of KNOWN_TRIGGER_CLASSES) {
    if (!policy.trigger_classes[triggerClass]) {
      throw new Error(`fable-pilot-policy.json trigger_classes is missing "${triggerClass}"`);
    }
  }
  if (!Array.isArray(policy.skip_list)) {
    throw new Error('fable-pilot-policy.json skip_list must be an array');
  }
  if (
    !policy.caps ||
    typeof policy.caps.max_qualifying_tasks !== 'number' ||
    typeof policy.caps.max_days !== 'number' ||
    typeof policy.caps.usage_ceiling_usd !== 'number' ||
    typeof policy.caps.estimated_usage_per_task_usd !== 'number'
  ) {
    throw new Error(
      'fable-pilot-policy.json caps must include numeric max_qualifying_tasks, max_days, usage_ceiling_usd, and estimated_usage_per_task_usd',
    );
  }
}

export interface ResolvePlanningModelInput {
  /** The lane tier. Fable is only ever considered for T1; any other tier is always Sonnet. */
  tier: string;
  /**
   * The trigger class the caller believes justifies Fable. Omit (or null) for the
   * ordinary case -- this always resolves to Sonnet with no fallback ceremony.
   */
  triggerClass?: FableTriggerClass | string | null;
  /** Human-readable justification, persisted into the routing block's `rationale`. */
  rationale: string;
  policy?: FablePilotPolicy;
  policyPath?: string;
  statePath?: string;
  now?: Date;
}

/**
 * Resolve the planning model for a T1 Claude lane's planning subagent (dispatch.md
 * Phase 4). Fails closed to Sonnet on every ineligibility path -- see module doc.
 */
export function resolvePlanningModel(input: ResolvePlanningModelInput): PlanningModelResolution {
  let policy: FablePilotPolicy;
  try {
    policy = input.policy ?? loadFablePilotPolicy(input.policyPath);
  } catch (error) {
    return {
      ok: false,
      code: 'POLICY_LOAD_FAILED',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const sonnetResult = (): PlanningModelResolution => ({
    ok: true,
    code: 'OK_SONNET_DEFAULT',
    message: 'Sonnet default (no Fable trigger class requested, or tier is not T1).',
    routing: {
      model: policy.default_model,
      profile: policy.default_profile,
      selected_by: 'three-brain',
      rationale: input.rationale,
      policy_version: policy.policy_version,
      fallback_used: false,
    },
  });

  // No trigger class requested, or wrong tier -- ordinary Sonnet path, not a fallback.
  if (!input.triggerClass || input.tier !== 'T1') {
    return sonnetResult();
  }

  const fallback = (
    code: PlanningModelResolutionCode,
    reason: string,
  ): PlanningModelResolution => ({
    ok: true,
    code,
    message: reason,
    routing: {
      model: policy.fallback_model,
      profile: policy.default_profile,
      selected_by: 'three-brain',
      rationale: input.rationale,
      policy_version: policy.policy_version,
      fallback_used: true,
      fallback_model: policy.fallback_model,
      requested_model: policy.fable_model,
      fallback_reason: reason,
    },
  });

  if (policy.skip_list.includes(input.triggerClass)) {
    return fallback(
      'FALLBACK_SKIP_LISTED',
      `Trigger class "${input.triggerClass}" is explicitly skip-listed (routine work never routes to Fable).`,
    );
  }

  if (!KNOWN_TRIGGER_CLASSES.includes(input.triggerClass as FableTriggerClass)) {
    return fallback(
      'FALLBACK_UNKNOWN_TRIGGER_CLASS',
      `Unknown trigger class "${input.triggerClass}" -- only the four ratified pilot classes are eligible: ${KNOWN_TRIGGER_CLASSES.join(', ')}.`,
    );
  }

  if (!policy.pilot_enabled) {
    return fallback(
      'FALLBACK_POLICY_DISABLED',
      'fable-pilot-policy.json pilot_enabled is false (pilot disabled or rolled back).',
    );
  }

  const triggerEntry = policy.trigger_classes[input.triggerClass as FableTriggerClass];
  if (!triggerEntry.enabled) {
    return fallback(
      'FALLBACK_TRIGGER_CLASS_DISABLED',
      `Trigger class "${input.triggerClass}" is individually disabled in policy.`,
    );
  }

  const pilotCheck: FablePilotCheckResult = readFablePilotState(input.statePath);
  if (!pilotCheck.ok) {
    return fallback(
      'FALLBACK_PILOT_NOT_ELIGIBLE',
      `Fable pilot is not eligible (${pilotCheck.code}): ${pilotCheck.message}`,
    );
  }

  return {
    ok: true,
    code: 'OK_FABLE_SELECTED',
    message: `Fable 5 selected for trigger class "${input.triggerClass}" -- pilot active and within caps.`,
    routing: {
      model: policy.fable_model,
      profile: triggerEntry.profile,
      selected_by: 'three-brain',
      rationale: input.rationale,
      policy_version: policy.policy_version,
      fallback_used: false,
    },
  };
}

export interface ResolveFableAdvisoryReviewInput extends ResolvePlanningModelInput {
  /**
   * Required, explicit assertion that the reviewer identity is independent of the
   * change's author (UTV2-1569 required outcome: "Require
   * reviewer_independent_of_author: true for a Fable review claim"). A caller that
   * cannot honestly assert this must not request a Fable review at all -- there is no
   * override. This is enforced HERE, at the routing decision, not only checked later
   * by truth-check against a comment's evidence.
   */
  reviewerIndependentOfAuthor: boolean;
}

/**
 * Resolve the model for an ADVISORY Fable review (Build Mode certification review
 * trigger class, or any of the other three classes used for a review rather than a
 * planning pass). This never replaces the mandatory Codex-return-reviewer /ubc Opus
 * critique in dispatch.md Phase 5 -- it is an additional, non-binding opinion. Fails
 * closed to "no review" (not to Sonnet-as-reviewer) when reviewer independence cannot
 * be asserted, since a non-independent "Fable review" would be evidence-shaped but
 * substantively worthless per the pilot's own terms.
 */
export function resolveFableAdvisoryReview(
  input: ResolveFableAdvisoryReviewInput,
): PlanningModelResolution {
  if (!input.reviewerIndependentOfAuthor) {
    return {
      ok: false,
      code: 'FALLBACK_MISSING_REVIEWER_INDEPENDENCE',
      message:
        'reviewer_independent_of_author must be true for any Fable review claim. Refusing to resolve a Fable review model without it -- there is no override.',
    };
  }
  return resolvePlanningModel(input);
}

export interface ResolveAndRecordInput extends ResolvePlanningModelInput {
  /**
   * Unique identifier for this qualifying task -- the issue ID is used by
   * scripts/ops/lane-start.ts (one qualifying task per Fable-routed lane created).
   */
  taskId: string;
}

export interface ResolveAndRecordResult extends PlanningModelResolution {
  /** True iff this call actually selected Fable AND wrote an updated pilot state. */
  pilotStateRecorded: boolean;
}

/**
 * Resolve the planning model AND, if it selects Fable, atomically record the
 * qualifying task and its estimated usage against the pilot state file in the SAME
 * call -- this is the fix for the PR #1292 review finding that `resolvePlanningModel`
 * alone only ever READ the pilot state to check eligibility and never wrote a task
 * back to it, so `task_count`/`usage_used_usd` never changed after a real Fable
 * selection and the caps could never mechanically expire. Every caller that persists
 * a Fable routing decision (scripts/ops/lane-start.ts at manifest-creation time, and
 * the Phase 5 advisory-review path) must call THIS function, not the bare
 * resolvePlanningModel/resolveFableAdvisoryReview, so a real selection can never
 * happen without the pilot's own counters moving in the same operation.
 *
 * Ordering within this function matters and is deliberate: resolve first (read-only),
 * then -- only on an actual Fable selection -- re-read the current state, apply
 * recordQualifyingTask (which itself mechanically flips status to "expired" the
 * moment any cap is crossed by this very task), and persist it, all before returning.
 * A caller that receives `code: 'OK_FABLE_SELECTED'` back from this function is
 * guaranteed the state file already reflects that selection -- there is no window
 * where the routing decision exists without the corresponding state mutation.
 */
export function resolveAndRecordPlanningModel(
  input: ResolveAndRecordInput,
): ResolveAndRecordResult {
  const resolution = resolvePlanningModel(input);
  if (resolution.code !== 'OK_FABLE_SELECTED') {
    return { ...resolution, pilotStateRecorded: false };
  }

  // Re-read (rather than thread through resolvePlanningModel's internal read) so this
  // function has no hidden coupling to resolvePlanningModel's implementation details --
  // it only depends on the same public readFablePilotState/recordQualifyingTask/
  // writeFablePilotState contract every other caller in this module already uses.
  const pilotCheck = readFablePilotState(input.statePath);
  if (!pilotCheck.ok || !pilotCheck.state) {
    // Pilot eligibility flipped between resolvePlanningModel's check and this one
    // (e.g. a concurrent suspend/rollback) -- fail closed to Sonnet rather than
    // trusting a routing decision the state no longer supports.
    return {
      ok: true,
      code: 'FALLBACK_PILOT_NOT_ELIGIBLE',
      message: `Fable pilot eligibility changed between resolution and recording (${pilotCheck.code}): ${pilotCheck.message}. Falling back to Sonnet rather than recording against a state that is no longer eligible.`,
      routing: {
        model: resolution.routing!.model === 'claude-fable-5' ? 'claude-sonnet-5' : resolution.routing!.model,
        profile: 'sonnet-default',
        selected_by: 'three-brain',
        rationale: input.rationale,
        policy_version: resolution.routing!.policy_version,
        fallback_used: true,
        fallback_model: 'claude-sonnet-5',
        requested_model: 'claude-fable-5',
        fallback_reason: 'pilot eligibility changed between resolution and recording',
      },
      pilotStateRecorded: false,
    };
  }

  let policy;
  try {
    policy = input.policy ?? loadFablePilotPolicy(input.policyPath);
  } catch (error) {
    return {
      ok: false,
      code: 'POLICY_LOAD_FAILED',
      message: error instanceof Error ? error.message : String(error),
      pilotStateRecorded: false,
    };
  }

  const nextState = recordQualifyingTask(
    pilotCheck.state,
    {
      taskId: input.taskId,
      triggerClass: input.triggerClass as FableTriggerClass,
      usageDeltaUsd: policy.caps.estimated_usage_per_task_usd,
    },
    input.now,
  );
  writeFablePilotState(nextState, input.statePath);

  return { ...resolution, pilotStateRecorded: true };
}

export interface ResolveAndRecordFableAdvisoryReviewInput
  extends ResolveFableAdvisoryReviewInput {
  taskId: string;
}

/**
 * Advisory-review counterpart to resolveAndRecordPlanningModel: an advisory Fable
 * review (e.g. a Build Mode certification review) is a genuinely separate selection
 * moment from lane creation -- it happens at PR-review time, against an already-open
 * PR, not at manifest-creation time. It must record its own qualifying task the same
 * way: reviewer-independence is checked first (no override, same as
 * resolveFableAdvisoryReview), and only a genuine Fable selection writes the state
 * file, atomically, before returning.
 */
export function resolveAndRecordFableAdvisoryReview(
  input: ResolveAndRecordFableAdvisoryReviewInput,
): ResolveAndRecordResult {
  if (!input.reviewerIndependentOfAuthor) {
    return {
      ok: false,
      code: 'FALLBACK_MISSING_REVIEWER_INDEPENDENCE',
      message:
        'reviewer_independent_of_author must be true for any Fable review claim. Refusing to resolve a Fable review model without it -- there is no override.',
      pilotStateRecorded: false,
    };
  }
  return resolveAndRecordPlanningModel(input);
}

/**
 * Map a ClaudePlanningModel to the short-name value the Agent tool's `model` parameter
 * accepts ("sonnet" | "opus" | "haiku" | "fable"). Kept as a single pure mapping so
 * dispatch.md's Agent() call sites never hardcode the mapping inline.
 */
export function toAgentModelOverride(model: ClaudePlanningModel): 'sonnet' | 'fable' {
  return model === 'claude-fable-5' ? 'fable' : 'sonnet';
}
