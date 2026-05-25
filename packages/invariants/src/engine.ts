/**
 * InvariantEngine (UTV2-1089 / INIT-1.3.2)
 *
 * Evaluates the constitutional invariant registry against runtime state.
 * Runtime-evaluable invariants get real evaluation logic.
 * Advisory invariants emit advisory violations when context is insufficient.
 *
 * Hot path is synchronous — no I/O during evaluate().
 * Registry is loaded once at construction time (via getActiveInvariants()).
 */

import { EventEmitter } from 'node:events';
import type { InvariantRegistryEntry, InvariantSeverity, InvariantQuarantineBehavior } from './types.js';
import { getActiveInvariants } from './registry/loader.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface InvariantViolation {
  invariant_id: string;
  title: string;
  severity: InvariantSeverity;
  quarantine_behavior: InvariantQuarantineBehavior;
  detected_at: string;           // ISO timestamp
  context: Record<string, unknown>;  // runtime snapshot at detection time
  replay_run_id?: string;        // present when detected inside a replay run
}

export interface RuntimeContext {
  snapshot_at: string;           // ISO timestamp
  replay_run_id?: string;
  // extensible — implementors add domain-specific fields
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Evaluator function type
// ---------------------------------------------------------------------------

/** Returns a violation description string if violated, or null if clean. */
type EvaluatorFn = (ctx: RuntimeContext) => string | null;

// ---------------------------------------------------------------------------
// Per-invariant evaluation functions
// ---------------------------------------------------------------------------

/**
 * Runtime-evaluable invariants: INV-0009, INV-0010, INV-0014, INV-0015
 * Advisory invariants: all others — if the context signals a violation
 * explicitly, we surface it; otherwise we pass (insufficient runtime state).
 */

const EVALUATORS: Record<string, EvaluatorFn> = {
  // ---- Governance / CI invariants (advisory unless context supplies evidence) ----

  'INV-0001': (ctx) => {
    // "main is shipped truth" — cannot evaluate from runtime snapshot alone
    // unless the context explicitly flags a violation (e.g. agent override detected)
    if (ctx['agent_claim_overrides_main'] === true) {
      return 'Agent claim is being treated as authoritative over main branch state';
    }
    return null;
  },

  'INV-0002': (ctx) => {
    // "No lane without preflight; no Done without truth-check"
    if (ctx['lane_started_without_preflight'] === true) {
      return 'Lane was started without a valid preflight token';
    }
    if (ctx['done_without_truth_check'] === true) {
      return 'Lane was marked Done without ops:truth-check passing';
    }
    return null;
  },

  'INV-0003': (ctx) => {
    // "One issue → one lane → one branch → one PR"
    const issueCount = ctx['issues_per_lane'];
    if (typeof issueCount === 'number' && issueCount > 1) {
      return `Lane contains ${issueCount} issues; exactly 1 is required`;
    }
    const prCount = ctx['prs_per_lane'];
    if (typeof prCount === 'number' && prCount > 1) {
      return `Lane produced ${prCount} PRs; exactly 1 is required`;
    }
    return null;
  },

  'INV-0004': (ctx) => {
    // "Proof must tie to merge SHA"
    if (ctx['proof_sha'] !== undefined && ctx['merge_sha'] !== undefined) {
      if (ctx['proof_sha'] !== ctx['merge_sha']) {
        return `Proof SHA (${ctx['proof_sha']}) does not match merge SHA (${ctx['merge_sha']})`;
      }
    }
    if (ctx['proof_bound_to_branch_head'] === true) {
      return 'Proof is bound to a branch HEAD SHA, not a merge SHA — proof is invalid';
    }
    return null;
  },

  'INV-0005': (ctx) => {
    // "Tier label required before Ready"
    if (ctx['issue_in_ready_state'] === true && ctx['tier_label_set'] === false) {
      return 'Issue entered Ready state without a tier label (tier:T1 / tier:T2 / tier:T3)';
    }
    if (ctx['dispatched_without_tier'] === true) {
      return 'Issue was dispatched without a tier label';
    }
    return null;
  },

  'INV-0006': (ctx) => {
    // "Lane manifest is sole authority for active lane state"
    if (ctx['lane_state_from_memory'] === true || ctx['lane_state_from_chat'] === true) {
      return 'Lane state is sourced from memory or chat rather than the lane manifest file';
    }
    return null;
  },

  'INV-0007': (ctx) => {
    // "@unit-talk/domain is pure — no I/O"
    const domainImports = ctx['domain_package_imports'] as string[] | undefined;
    const forbiddenModules = ['fs', 'http', 'https', 'net', 'dns', 'child_process', 'pg', 'axios', 'node-fetch'];
    if (Array.isArray(domainImports)) {
      for (const mod of domainImports) {
        if (forbiddenModules.some((f) => mod.includes(f))) {
          return `Domain package imports forbidden I/O module: ${mod}`;
        }
      }
    }
    if (ctx['domain_performs_io'] === true) {
      return 'Domain package (@unit-talk/domain) performed I/O at runtime';
    }
    return null;
  },

  'INV-0008': (ctx) => {
    // "Packages do not import from apps"
    if (ctx['package_imports_app'] === true) {
      return 'A package imported from an app, violating the dependency boundary';
    }
    if (ctx['app_imports_other_app'] === true) {
      return 'An app imported from another app, violating the dependency boundary';
    }
    return null;
  },

  // ---- Runtime-evaluable invariants ----

  'INV-0009': (ctx) => {
    // "Postgres outbox is the only delivery queue"
    // Runtime-evaluable: look for direct delivery bypass signals or multiple outcomes.
    if (ctx['delivery_bypassed_outbox'] === true) {
      return 'Pick delivery was attempted without going through the Postgres outbox';
    }
    if (ctx['in_memory_queue_used'] === true) {
      return 'An in-memory queue was used for delivery (prohibited — outbox only)';
    }
    const outboxOutcomes = ctx['outbox_outcomes_per_attempt'];
    if (typeof outboxOutcomes === 'number' && outboxOutcomes !== 1) {
      return `Expected exactly 1 DeliveryOutcome per attempt; found ${outboxOutcomes}`;
    }
    return null;
  },

  'INV-0010': (ctx) => {
    // "Fail closed — no silent fallback to qualified/pass/done"
    // Runtime-evaluable: look for silent fallback signals.
    const silentFallback = ctx['silent_fallback_state'] as string | undefined;
    if (silentFallback !== undefined) {
      const forbidden = ['qualified', 'pass', 'done'];
      if (forbidden.includes(silentFallback.toLowerCase())) {
        return `Silent fallback to '${silentFallback}' detected — system must fail closed`;
      }
    }
    if (ctx['fallback_on_ambiguity'] === true) {
      return 'System accepted ambiguous input via silent fallback instead of failing closed';
    }
    return null;
  },

  'INV-0011': (ctx) => {
    // "Mechanical enforcement required for all invariants"
    if (ctx['invariant_prose_only'] === true) {
      return 'An invariant exists only in prose documentation with no mechanical enforcement layer';
    }
    const entryId = ctx['invariant_id_without_mechanical_enforcement'] as string | undefined;
    if (entryId) {
      return `Invariant ${entryId} has no mechanical enforcing layer (ci, db-trigger, db-rpc, or application)`;
    }
    return null;
  },

  'INV-0012': (ctx) => {
    // "Pick writer authority: field-level ownership"
    const unauthorizedWriter = ctx['unauthorized_field_write'] as string | undefined;
    if (unauthorizedWriter) {
      return `Field write by unauthorized role detected: ${unauthorizedWriter}`;
    }
    if (ctx['cross_role_field_write'] === true) {
      return 'Cross-role field write detected — only designated writer role may update a field';
    }
    return null;
  },

  'INV-0013': (ctx) => {
    // "No truth-surface migration without tested rollback"
    if (ctx['migration_missing_rollback'] === true) {
      return 'Truth-surface SQL migration is missing an executable down/rollback script';
    }
    if (ctx['migration_reversibility_gate_failed'] === true) {
      return 'Migration reversibility gate failed — PR must not merge';
    }
    return null;
  },

  'INV-0014': (ctx) => {
    // "Audit log is append-only and immutable"
    // Runtime-evaluable: look for mutation attempts on audit_log.
    if (ctx['audit_log_delete_attempted'] === true) {
      return 'DELETE attempted on audit_log table — append-only invariant violated';
    }
    if (ctx['audit_log_update_attempted'] === true) {
      return 'UPDATE attempted on audit_log table — append-only invariant violated';
    }
    const pruneCount = ctx['audit_log_rows_pruned'];
    if (typeof pruneCount === 'number' && pruneCount > 0) {
      return `${pruneCount} audit_log rows were pruned — retention policy violation`;
    }
    return null;
  },

  'INV-0015': (ctx) => {
    // "Pick lifecycle transitions are immutable once terminal"
    // Runtime-evaluable: look for transitions out of terminal states.
    const terminalStates = ['settled', 'voided'];
    const fromState = ctx['transition_from_state'] as string | undefined;
    const toState = ctx['transition_to_state'] as string | undefined;

    if (fromState !== undefined && terminalStates.includes(fromState.toLowerCase())) {
      if (toState !== undefined) {
        return `Pick in terminal state '${fromState}' cannot transition to '${toState}'`;
      }
      return `Lifecycle transition attempted on pick in terminal state '${fromState}'`;
    }

    if (ctx['retroactive_terminal_change'] === true) {
      return 'Retroactive state change attempted on a terminal pick';
    }

    return null;
  },
};

// Set of invariant IDs that have real runtime evaluation logic
const RUNTIME_EVALUABLE_IDS = new Set(['INV-0009', 'INV-0010', 'INV-0014', 'INV-0015']);

// ---------------------------------------------------------------------------
// InvariantEngine
// ---------------------------------------------------------------------------

export class InvariantEngine extends EventEmitter {
  private readonly invariants: InvariantRegistryEntry[];

  /** IDs of invariants that are fully evaluable from runtime context alone. */
  static readonly RUNTIME_EVALUABLE_IDS: ReadonlySet<string> = RUNTIME_EVALUABLE_IDS;

  constructor() {
    super();
    this.invariants = getActiveInvariants();
  }

  /**
   * Evaluate all active invariants against the given runtime context.
   * Returns violations detected; does NOT throw on violation.
   * Also emits each violation via the 'violation' event.
   *
   * Synchronous — no I/O in the hot path.
   */
  evaluate(context: RuntimeContext): InvariantViolation[] {
    const violations: InvariantViolation[] = [];

    for (const inv of this.invariants) {
      const evaluator = EVALUATORS[inv.id];
      if (!evaluator) {
        // Unknown invariant — skip (defensive; registry may have entries not yet implemented)
        continue;
      }

      const reason = evaluator(context);
      if (reason !== null) {
        const violation: InvariantViolation = {
          invariant_id: inv.id,
          title: inv.title,
          severity: inv.severity,
          quarantine_behavior: inv.quarantine_behavior,
          detected_at: new Date().toISOString(),
          context: { ...context, violation_reason: reason },
        };
        violations.push(violation);
        this.emit('violation', violation);
      }
    }

    return violations;
  }

  /**
   * Same as evaluate() but stamps each violation with the replay_run_id.
   */
  evaluateForReplay(context: RuntimeContext, replayRunId: string): InvariantViolation[] {
    const violations = this.evaluate(context);
    for (const v of violations) {
      v.replay_run_id = replayRunId;
    }
    return violations;
  }
}
