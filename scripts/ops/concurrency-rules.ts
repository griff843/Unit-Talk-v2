import {
  ACTIVE_LOCK_STATUSES,
  DELIVERY_UI_APP_ROOTS,
  deriveDeliveryUiApp,
  type CanonicalLaneType,
  type LaneExecutor,
  type LaneManifestStatus,
} from './shared.js';
import type { ConcurrencyConfig, EffectiveConcurrencyConfig } from './concurrency-config.js';

/**
 * Single canonical implementation of the concurrency/type-cap/singleton/forbidden-
 * combination rule set (UTV2-1533 P2, hardened by the follow-up planning-accuracy
 * lane). This module exists so `ops:lane-start` (the real, fail-closed mechanical
 * authority -- see checkConcurrencyLimits() below) and `lane-maximizer.ts`'s advisory
 * planner (evaluateCandidates()) never carry two textually-divergent copies of the
 * same admission rules. Both import and call checkConcurrencyLimits() from here.
 *
 * The `activeManifests` parameter is typed against ConcurrencyManifestLike, a minimal
 * structural subset of shared.ts's full LaneManifest -- exactly the fields this
 * function reads. This lets lane-maximizer.ts's own lightweight/test-friendly
 * candidate and manifest shapes (and its synthetic "this candidate is now active"
 * projections used for wave forecasting) satisfy the type without needing to
 * synthesize the full LaneManifest shape (worktree_path, preflight_token,
 * truth_check_history, etc. -- fields this function never reads). Real
 * shared.LaneManifest objects (as read by ops:lane-start via readAllManifests())
 * remain structurally compatible without any change, since they are always a
 * superset of these fields.
 */
export interface ConcurrencyManifestLike {
  issue_id: string;
  lane_type: string;
  executor?: LaneExecutor;
  status: LaneManifestStatus;
  file_scope_lock: string[];
  verification_target?: string;
}

export interface ConcurrencyViolation {
  code: string;
  message: string;
}

export interface IncomingLaneScope {
  fileScopeLock?: string[];
  verificationTarget?: string;
}

export function checkConcurrencyLimits(
  activeManifests: ConcurrencyManifestLike[],
  incomingLaneType: CanonicalLaneType,
  incomingExecutor: LaneExecutor,
  config: ConcurrencyConfig | EffectiveConcurrencyConfig,
  incoming: IncomingLaneScope = {},
): ConcurrencyViolation[] {
  const active = activeManifests.filter((m) => ACTIVE_LOCK_STATUSES.has(m.status));
  const violations: ConcurrencyViolation[] = [];

  // Total cap
  if (active.length >= config.total) {
    violations.push({
      code: 'total_cap_exceeded',
      message: `Total active lanes (${active.length}) is at the hard cap of ${config.total}. Close a lane before starting a new one.`,
    });
  }

  // Executor caps
  const claudeActive = active.filter((m) => m.executor === 'claude').length;
  const codexActive = active.filter(
    (m) => m.executor === 'codex-cli' || m.executor === 'codex-cloud',
  ).length;

  if (incomingExecutor === 'claude' && claudeActive >= config.executors.claude) {
    violations.push({
      code: 'claude_cap_exceeded',
      message: `Claude active lanes (${claudeActive}) is at the cap of ${config.executors.claude}. Close a Claude lane before starting another.`,
    });
  }

  if (
    (incomingExecutor === 'codex-cli' || incomingExecutor === 'codex-cloud') &&
    codexActive >= config.executors.codex
  ) {
    violations.push({
      code: 'codex_cap_exceeded',
      message: `Codex active lanes (${codexActive}) is at the cap of ${config.executors.codex}. Close a Codex lane before starting another.`,
    });
  }

  if (
    'trial_active' in config &&
    config.trial_active &&
    active.length >= config.base_total &&
    !config.trial_safe_types_only.includes(incomingLaneType)
  ) {
    violations.push({
      code: 'trial_unsafe_lane_type',
      message: `Trial slots above the base cap of ${config.base_total} are restricted to safe lane types (${config.trial_safe_types_only.join(', ')}). Lane type "${incomingLaneType}" is not eligible for trial expansion.`,
    });
  }

  // Singleton type enforcement
  if ((config.singleton_types as string[]).includes(incomingLaneType)) {
    const existing = active.filter((m) => {
      const lt = String(m.lane_type ?? '');
      return lt === incomingLaneType;
    });
    if (existing.length > 0) {
      violations.push({
        code: 'singleton_type_conflict',
        message: `Lane type "${incomingLaneType}" is singleton. Active lane ${existing[0]!.issue_id} already holds this type. Close it before starting another ${incomingLaneType} lane.`,
      });
    }
  }

  // Per-type distribution caps (UTV2-1533 P2 fix). Layered on top of the total/executor
  // caps above -- a lane must pass both. Always read from config.type_caps, which is
  // sourced from base config regardless of trial state (see concurrency-config.ts).
  const typeCaps = config.type_caps;
  if (typeCaps) {
    if (incomingLaneType === 'hygiene') {
      const hygieneActive = active.filter((m) => String(m.lane_type ?? '') === 'hygiene').length;
      if (hygieneActive >= typeCaps.hygiene) {
        violations.push({
          code: 'hygiene_type_cap_exceeded',
          message: `Hygiene active lanes (${hygieneActive}) is at the cap of ${typeCaps.hygiene}. Close a Hygiene lane before starting another.`,
        });
      }
    }

    if (incomingLaneType === 'governance') {
      const governanceActive = active.filter((m) => String(m.lane_type ?? '') === 'governance').length;
      if (governanceActive >= typeCaps.governance) {
        violations.push({
          code: 'governance_type_cap_exceeded',
          message: `Governance active lanes (${governanceActive}) is at the cap of ${typeCaps.governance}. Close a Governance lane before starting another.`,
        });
      }
    }

    if (incomingLaneType === 'delivery-ui') {
      const incomingApp = deriveDeliveryUiApp(incoming.fileScopeLock ?? []);
      if (incomingApp === null) {
        violations.push({
          code: 'delivery_ui_app_undetermined',
          message:
            'Delivery/UI lane file_scope_lock does not map to exactly one canonical app root ' +
            `(${Object.keys(DELIVERY_UI_APP_ROOTS).join(', ')}). ` +
            'Cannot admit a Delivery/UI lane whose app cannot be determined from its declared scope.',
        });
      } else {
        const activeDeliveryUi = active.filter((m) => String(m.lane_type ?? '') === 'delivery-ui');
        // Fail closed (Codex review, PR #1215): an active Delivery/UI lane whose own scope
        // cannot be reduced to one canonical app must never be treated as non-conflicting --
        // deriveDeliveryUiApp() returning null for it is "cannot prove which app", not "proven
        // to be a different app". Mirrors the identical fail-closed treatment already applied
        // to undetermined active Verification lanes above.
        const undeterminedActive = activeDeliveryUi.find(
          (m) => deriveDeliveryUiApp(m.file_scope_lock ?? []) === null,
        );
        if (undeterminedActive) {
          violations.push({
            code: 'delivery_ui_app_undetermined_conflict',
            message: `Active Delivery/UI lane ${undeterminedActive.issue_id} has a file_scope_lock that cannot be reduced to one canonical app -- cannot prove it targets a different app than "${incomingApp}". Fails closed: resolve or close ${undeterminedActive.issue_id} first.`,
          });
        } else {
          const conflictingApp = activeDeliveryUi.find(
            (m) => deriveDeliveryUiApp(m.file_scope_lock ?? []) === incomingApp,
          );
          if (conflictingApp) {
            violations.push({
              code: 'delivery_ui_app_conflict',
              message: `Delivery/UI app "${incomingApp}" already has an active lane (${conflictingApp.issue_id}). Only one Delivery/UI lane per app at a time.`,
            });
          }
        }
      }
    }

    if (incomingLaneType === 'verification') {
      const incomingTarget = incoming.verificationTarget;
      if (!incomingTarget) {
        violations.push({
          code: 'verification_target_missing',
          message: 'Verification lane requires a verification_target (the UTV2-### issue this lane produces proof for) to evaluate the per-target cap.',
        });
      } else {
        const activeVerification = active.filter((m) => String(m.lane_type ?? '') === 'verification');
        const undetermined = activeVerification.find((m) => !m.verification_target);
        if (undetermined) {
          violations.push({
            code: 'verification_target_undetermined_conflict',
            message: `Active verification lane ${undetermined.issue_id} has no verification_target recorded -- cannot prove it targets a different issue than "${incomingTarget}". Fails closed: resolve or close ${undetermined.issue_id} first.`,
          });
        } else {
          const conflicting = activeVerification.find((m) => m.verification_target === incomingTarget);
          if (conflicting) {
            violations.push({
              code: 'verification_target_conflict',
              message: `Verification target "${incomingTarget}" already has an active lane (${conflicting.issue_id}). Only one Verification lane per target issue at a time.`,
            });
          }
        }
      }
    }
  }

  // Forbidden combinations
  for (const [typeA, typeB] of config.forbidden_combinations) {
    const incomingIsA = incomingLaneType === typeA;
    const incomingIsB = incomingLaneType === typeB;
    if (!incomingIsA && !incomingIsB) continue;

    const conflictType = incomingIsA ? typeB : typeA;
    const conflicting = active.filter((m) => String(m.lane_type ?? '') === conflictType);
    if (conflicting.length > 0) {
      violations.push({
        code: 'forbidden_combination',
        message: `Forbidden combination: "${incomingLaneType}" cannot run concurrently with "${conflictType}" (active lane: ${conflicting[0]!.issue_id}). See docs/governance/LANE_CONCURRENCY_POLICY.md §3.`,
      });
    }
  }

  return violations;
}
