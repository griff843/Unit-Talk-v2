/**
 * Fable pilot rollback (UTV2-1569).
 *
 * The earlier pilot attempt (PR #1287, unmerged) documented its rollback as "revert
 * this doc's Fable entry + the corresponding three-brain.md row" -- a prose-only
 * instruction with no mechanical backstop. If that revert were ever missed or delayed,
 * nothing would have stopped Fable from continuing to be selected. This module is the
 * mechanical fix: a single function that makes Fable permanently unselectable,
 * independent of whether every doc/allowlist edit has also been reverted yet.
 *
 * Two-part rollback (both required for a fully clean restoration to the pre-pilot
 * Rule-9-only state):
 *
 *   1. MECHANICAL (this module, `runFablePilotRollback`): flips
 *      docs/05_operations/policies/fable-pilot-policy.json's `pilot_enabled` to `false`
 *      and docs/05_operations/FABLE_PILOT_STATE.json's `status` to the terminal
 *      `"rolled_back"`. After this runs, resolvePlanningModel() and
 *      resolveFableAdvisoryReview() (scripts/ops/planning-model-routing.ts) can never
 *      return `claude-fable-5` again, regardless of trigger class, caller input, or
 *      whether the state file was somehow reset -- rollbackPilot() is the only writer
 *      of "rolled_back" and no function in fable-pilot-state.ts ever transitions out of
 *      it. This is the fail-closed backstop and is sufficient on its own to guarantee
 *      no further Fable routing, even if step 2 below is delayed.
 *
 *   2. DOCUMENTARY (tracked in docs/05_operations/FABLE_PILOT_ROLLBACK.md, not
 *      automated by this module): git-revert the specific prose/allowlist diffs --
 *      `.claude/commands/three-brain.md`'s Fable pilot section,
 *      `docs/05_operations/OPERATING_MODEL_SONNET5.md` §1, and the `claude-fable-5`
 *      allowlist entries in `docs/05_operations/agent-role-contracts.md`,
 *      `docs/governance/AGENT_SKILL_CONTRACTS.md`, and `scripts/ops/contract-validator.ts`.
 *      This step is what makes the rollback complete at the *source* level (no dangling
 *      "claude-fable-5" string anywhere), on top of step 1's *behavioral* guarantee.
 *
 * See docs/05_operations/FABLE_PILOT_ROLLBACK.md for the full documented procedure and
 * the exact git commands for step 2.
 */

import fs from 'node:fs';
import {
  FABLE_PILOT_POLICY_PATH,
  loadFablePilotPolicy,
  resolvePlanningModel,
  resolveFableAdvisoryReview,
  type FablePilotPolicy,
} from './planning-model-routing.js';
import {
  FABLE_PILOT_STATE_PATH,
  readFablePilotState,
  rollbackPilot,
  writeFablePilotState,
  type FablePilotState,
} from './fable-pilot-state.js';

export interface FablePilotRollbackResult {
  ok: boolean;
  actions: string[];
  message: string;
  policy_path: string;
  state_path: string;
  dry_run: boolean;
}

export interface RunFablePilotRollbackInput {
  reason: string;
  actor: string;
  policyPath?: string;
  statePath?: string;
  /** When true, compute and report the actions without writing any file. */
  dryRun?: boolean;
  now?: Date;
}

/**
 * Idempotent: running this twice is a no-op the second time (pilot_enabled already
 * false, state already rolled_back) and still reports ok: true. Never throws --
 * a missing/malformed policy or state file is reported in the result, not thrown,
 * since a rollback must succeed even against a partially-broken pilot footprint.
 */
export function runFablePilotRollback(input: RunFablePilotRollbackInput): FablePilotRollbackResult {
  const policyPath = input.policyPath ?? FABLE_PILOT_POLICY_PATH;
  const statePath = input.statePath ?? FABLE_PILOT_STATE_PATH;
  const dryRun = input.dryRun ?? false;
  const actions: string[] = [];

  let policy: FablePilotPolicy | null = null;
  try {
    policy = loadFablePilotPolicy(policyPath);
  } catch (error) {
    actions.push(
      `SKIPPED policy update: could not load ${policyPath} (${error instanceof Error ? error.message : String(error)}). ` +
        'A missing/unloadable policy file already fails every resolvePlanningModel call closed to Sonnet (POLICY_LOAD_FAILED never selects Fable), so this is not itself a rollback gap.',
    );
  }

  if (policy) {
    if (policy.pilot_enabled) {
      actions.push(`SET fable-pilot-policy.json pilot_enabled: true -> false (${policyPath})`);
      if (!dryRun) {
        const nextPolicy: FablePilotPolicy = { ...policy, pilot_enabled: false };
        fs.writeFileSync(policyPath, JSON.stringify(nextPolicy, null, 2) + '\n', 'utf8');
      }
    } else {
      actions.push(`NO-OP: fable-pilot-policy.json pilot_enabled already false (${policyPath})`);
    }
  }

  const stateCheck = readFablePilotState(statePath);
  const currentState: FablePilotState | undefined = stateCheck.state;
  if (!currentState) {
    actions.push(
      `SKIPPED state update: could not load ${statePath} (${stateCheck.message}). A missing/unloadable state file already fails every readFablePilotState call closed (never PILOT_ACTIVE_WITHIN_CAPS), so this is not itself a rollback gap.`,
    );
  } else if (currentState.status === 'rolled_back') {
    actions.push(`NO-OP: FABLE_PILOT_STATE.json status already "rolled_back" (${statePath})`);
  } else {
    actions.push(
      `SET FABLE_PILOT_STATE.json status: "${currentState.status}" -> "rolled_back" (terminal) (${statePath})`,
    );
    if (!dryRun) {
      const nextState = rollbackPilot(currentState, input.reason, input.actor, input.now);
      writeFablePilotState(nextState, statePath);
    }
  }

  actions.push(
    'REMINDER (documentary step, not automated here): git-revert the Fable prose/allowlist diffs in ' +
      '.claude/commands/three-brain.md, docs/05_operations/OPERATING_MODEL_SONNET5.md §1, ' +
      'docs/05_operations/agent-role-contracts.md, docs/governance/AGENT_SKILL_CONTRACTS.md, and ' +
      'scripts/ops/contract-validator.ts. See docs/05_operations/FABLE_PILOT_ROLLBACK.md for the exact commands.',
  );

  return {
    ok: true,
    actions,
    message: dryRun
      ? 'Dry run: no files written. The actions above describe what a real run would change.'
      : 'Fable pilot mechanically rolled back: pilot_enabled=false and pilot state=rolled_back. Fable is no longer selectable by resolvePlanningModel/resolveFableAdvisoryReview.',
    policy_path: policyPath,
    state_path: statePath,
    dry_run: dryRun,
  };
}

/**
 * Proof helper for tests and for a human operator to self-check: after rollback,
 * assert that Fable is unselectable for every one of the four ratified trigger
 * classes, regardless of tier or rationale. Returns true only if every attempt fell
 * back to Sonnet.
 */
export function verifyFableUnselectableAfterRollback(input: {
  policyPath?: string;
  statePath?: string;
}): { ok: boolean; details: string[] } {
  const triggerClasses = [
    'repeated_architecture_bounce',
    'live_state_root_cause',
    'product_synthesis_no_precedent',
    'build_mode_certification_review',
  ] as const;
  const details: string[] = [];
  let ok = true;
  for (const triggerClass of triggerClasses) {
    const planning = resolvePlanningModel({
      tier: 'T1',
      triggerClass,
      rationale: 'post-rollback verification attempt',
      policyPath: input.policyPath,
      statePath: input.statePath,
    });
    if (planning.routing?.model === 'claude-fable-5') {
      ok = false;
      details.push(`FAIL: resolvePlanningModel still returned claude-fable-5 for ${triggerClass}`);
    } else {
      details.push(`OK: resolvePlanningModel returned ${planning.routing?.model ?? 'no routing'} for ${triggerClass}`);
    }

    const review = resolveFableAdvisoryReview({
      tier: 'T1',
      triggerClass,
      rationale: 'post-rollback verification attempt',
      policyPath: input.policyPath,
      statePath: input.statePath,
      reviewerIndependentOfAuthor: true,
    });
    if (review.routing?.model === 'claude-fable-5') {
      ok = false;
      details.push(`FAIL: resolveFableAdvisoryReview still returned claude-fable-5 for ${triggerClass}`);
    } else {
      details.push(`OK: resolveFableAdvisoryReview returned ${review.routing?.model ?? 'no routing'} for ${triggerClass}`);
    }
  }
  return { ok, details };
}
