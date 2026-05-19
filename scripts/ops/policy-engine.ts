/**
 * Policy Engine — Phase 3.1 governance-as-code
 *
 * Loads JSON policy files from docs/05_operations/policies/,
 * evaluates them against a context, and emits matched results.
 *
 * CLI usage:
 *   npx tsx scripts/ops/policy-engine.ts --trigger dispatch --tier T1
 *   npx tsx scripts/ops/policy-engine.ts --trigger dispatch --tier T2 --path apps/worker/src/foo.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { emitJson, emitMachineError, getFlag, parseArgs, ROOT } from './shared.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PolicyTrigger = 'dispatch' | 'post_merge' | 'pr_open' | 'codex_return';
export type PolicyAction = string; // e.g. "pnpm qa:experience", "require_pm_verdict", "block_codex"

export interface PolicyConditions {
  tier?: ('T1' | 'T2' | 'T3')[];
  paths?: string[];         // simple prefix/suffix globs — matched with pathMatchesGlob()
  lane_type?: string[];
  executor?: string[];
  work_class?: string[];    // 'safe' | 'dangerous'
}

export interface Policy {
  id: string;
  description: string;
  trigger: PolicyTrigger;
  conditions: PolicyConditions;
  actions: PolicyAction[];
  escalate_to_griff: boolean;
  rationale?: string;       // prose reference to source rule
}

export interface PolicyEvalContext {
  trigger: PolicyTrigger;
  tier?: string;
  paths?: string[];
  lane_type?: string;
  executor?: string;
  work_class?: string;
}

export interface PolicyEvalResult {
  policy_id: string;
  matched: boolean;
  actions: PolicyAction[];
  escalate_to_griff: boolean;
}

// ---------------------------------------------------------------------------
// Path matching (no external deps)
// ---------------------------------------------------------------------------

/**
 * Minimal glob matcher supporting:
 *  - `**` anywhere in the pattern (matches any path segment sequence)
 *  - `*`  matches any characters within a single segment
 *  - Exact prefix match when pattern ends with `/**`
 *  - Case-sensitive comparison
 *
 * Examples:
 *   pathMatchesGlob("apps/worker/**", "apps/worker/src/foo.ts")  → true
 *   pathMatchesGlob("packages/domain/src/**", "packages/domain/src/lifecycle/fsm.ts") → true
 *   pathMatchesGlob("apps/api/src/auth.ts", "apps/api/src/auth.ts") → true
 */
export function pathMatchesGlob(pattern: string, filePath: string): boolean {
  // Exact match fast-path
  if (pattern === filePath) return true;

  // Normalise separators
  const normPattern = pattern.replace(/\\/g, '/');
  const normPath = filePath.replace(/\\/g, '/');

  // Convert glob pattern to a RegExp
  const regexStr = normPattern
    .split('**')
    .map((segment) =>
      segment
        .split('*')
        .map((s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*'),
    )
    .join('.*');

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(normPath);
}

/**
 * Returns true when at least one context path matches at least one policy glob.
 */
function pathsMatch(policyPaths: string[], contextPaths: string[]): boolean {
  for (const glob of policyPaths) {
    for (const filePath of contextPaths) {
      if (pathMatchesGlob(glob, filePath)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Policy loading
// ---------------------------------------------------------------------------

export const POLICIES_DIR = path.join(ROOT, 'docs', '05_operations', 'policies');

export function loadPolicies(): Policy[] {
  if (!fs.existsSync(POLICIES_DIR)) return [];

  const files = fs
    .readdirSync(POLICIES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const policies: Policy[] = [];
  for (const file of files) {
    const fullPath = path.join(POLICIES_DIR, file);
    const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as Policy[];
    if (!Array.isArray(raw)) {
      throw new Error(`Policy file must export a JSON array: ${file}`);
    }
    policies.push(...raw);
  }
  return policies;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export function conditionsMatch(conditions: PolicyConditions, ctx: PolicyEvalContext): boolean {
  // trigger is pre-checked by the caller; conditions only refine the match

  if (conditions.tier && conditions.tier.length > 0) {
    if (!ctx.tier || !conditions.tier.includes(ctx.tier as 'T1' | 'T2' | 'T3')) return false;
  }

  if (conditions.paths && conditions.paths.length > 0) {
    if (!ctx.paths || ctx.paths.length === 0) return false;
    if (!pathsMatch(conditions.paths, ctx.paths)) return false;
  }

  if (conditions.lane_type && conditions.lane_type.length > 0) {
    if (!ctx.lane_type || !conditions.lane_type.includes(ctx.lane_type)) return false;
  }

  if (conditions.executor && conditions.executor.length > 0) {
    if (!ctx.executor || !conditions.executor.includes(ctx.executor)) return false;
  }

  if (conditions.work_class && conditions.work_class.length > 0) {
    if (!ctx.work_class || !conditions.work_class.includes(ctx.work_class)) return false;
  }

  return true;
}

/**
 * Evaluate all loaded policies against the given context.
 * Returns only matched policies.
 */
export function evaluate(
  ctx: PolicyEvalContext,
  policies?: Policy[],
): PolicyEvalResult[] {
  const allPolicies = policies ?? loadPolicies();
  const results: PolicyEvalResult[] = [];

  for (const policy of allPolicies) {
    if (policy.trigger !== ctx.trigger) continue;
    const matched = conditionsMatch(policy.conditions, ctx);
    if (matched) {
      results.push({
        policy_id: policy.id,
        matched: true,
        actions: policy.actions,
        escalate_to_griff: policy.escalate_to_griff,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { flags } = parseArgs(process.argv.slice(2));

  const triggerRaw = getFlag(flags, 'trigger');
  if (!triggerRaw) {
    emitMachineError('MISSING_ARG', '--trigger is required (dispatch | post_merge | pr_open | codex_return)');
  }

  const validTriggers: PolicyTrigger[] = ['dispatch', 'post_merge', 'pr_open', 'codex_return'];
  if (!validTriggers.includes(triggerRaw as PolicyTrigger)) {
    emitMachineError('INVALID_TRIGGER', `Unknown trigger: ${triggerRaw}`);
  }

  const ctx: PolicyEvalContext = {
    trigger: triggerRaw as PolicyTrigger,
    tier: getFlag(flags, 'tier'),
    paths: flags.get('path') ?? [],
    lane_type: getFlag(flags, 'lane-type'),
    executor: getFlag(flags, 'executor'),
    work_class: getFlag(flags, 'work-class'),
  };

  let policies: Policy[];
  try {
    policies = loadPolicies();
  } catch (err) {
    emitMachineError('LOAD_ERROR', `Failed to load policies: ${err instanceof Error ? err.message : String(err)}`);
  }

  const results = evaluate(ctx, policies);

  emitJson({
    ok: true,
    trigger: ctx.trigger,
    context: ctx,
    policies_loaded: policies.length,
    matched_count: results.length,
    results,
  });
}
