/**
 * Canonical Codex model-profile routing: policy loader, validator, and resolver.
 *
 * docs/05_operations/policies/codex-model-routing.json is the sole source of truth for
 * which concrete Codex model ID and reasoning effort a logical profile (e.g.
 * "codex-terra-medium") maps to. This module never hardcodes a model ID -- it only
 * validates and resolves against that policy file.
 *
 * The first-match routing RULES (which profile a given lane should get) are documented
 * in .claude/commands/three-brain.md and applied by the orchestrator the same way
 * executor routing already is -- this module does not re-implement that judgment. It is
 * the fail-closed mechanical gate a profile selection must pass before it can be
 * persisted into a lane manifest (ops:lane-start) or executed (codex-exec.ts).
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT, parseJsonFile } from './shared.js';

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

export interface ModelRoutingProfile {
  model: string;
  reasoning_effort: ReasoningEffort;
  enabled: boolean;
  permitted_tiers: string[];
  use_cases: string[];
  requires_pm_authorization: boolean;
  description: string;
}

export interface ModelRoutingPolicy {
  policy_version: string;
  schema_version: 1;
  description: string;
  verified_against: Record<string, string>;
  profiles: Record<string, ModelRoutingProfile>;
  reasoning_effort_catalog: Record<string, ReasoningEffort[]>;
  legacy_compatibility: { default_profile: string; description: string };
}

export interface ModelRoutingOverride {
  authorized_by: string;
  reason: string;
  at?: string;
  /**
   * Present only on a block written by reconcileObservedModelRouting: the routing the
   * lane declared at lane-start, before it was reconciled to what actually ran.
   */
  declared?: DeclaredModelRouting;
  observation?: RoutingObservation;
  approval?: RoutingApproval;
}

export interface DeclaredModelRouting {
  profile: string;
  model: string;
  reasoning_effort: string;
  selected_by: string;
}

/** Recorded in place of a routing value the executing session did not expose. */
export const UNAVAILABLE_ROUTING_VALUE = 'unavailable';

/**
 * The only verification level reconcile-routing can record. The model a session external
 * to this repository ran cannot be attested here; it is a report, flagged as such.
 */
export const UNVERIFIED_EXTERNAL_SESSION = 'unverified-external-session';

export interface RoutingObservation {
  verification: typeof UNVERIFIED_EXTERNAL_SESSION;
  /** Where the observation came from, e.g. the executor's own report in the lane's proof. */
  source: string;
  /** Fields recorded as UNAVAILABLE_ROUTING_VALUE because the session did not expose them. */
  unavailable_fields: string[];
}

/** A pm-verdict/v1 APPROVED comment, checked against GitHub by verifyRoutingApproval. */
export interface RoutingApproval {
  comment_url: string;
  reviewer: string;
  pr_number: number;
  head_sha: string;
}

/** One policy-version migration of a lane's routing, appended by reResolveModelRouting. */
export interface RoutingReResolution {
  from_policy_version: string;
  from_model: string;
  from_reasoning_effort: string;
  to_policy_version: string;
  at: string;
}

export interface ModelRoutingBlock {
  profile: string;
  model: string;
  reasoning_effort: string;
  selected_by: 'three-brain' | 'manual-override';
  policy_version: string;
  legacy_resolved?: boolean;
  override?: ModelRoutingOverride;
  re_resolutions?: RoutingReResolution[];
}

export interface ModelRoutingEvidenceContractResult {
  valid: boolean;
  violations: string[];
}

/**
 * Pre-merge sidecar contract. Execution provenance may name a branch commit;
 * merge authority cannot exist until GitHub attests a merged PR. The sole
 * canonical post-merge authority is closeout_binding.
 */
export function validatePreMergeModelRoutingEvidence(
  candidate: unknown,
  options: { expectedIssueId?: string; manifestRouting?: ModelRoutingBlock | null } = {},
): ModelRoutingEvidenceContractResult {
  const violations: string[] = [];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { valid: false, violations: ['model-routing sidecar must be a JSON object'] };
  }
  const evidence = candidate as Record<string, unknown>;
  if (options.expectedIssueId && String(evidence['issue_id'] ?? '').toUpperCase() !== options.expectedIssueId.toUpperCase()) {
    violations.push(`issue_id does not match ${options.expectedIssueId}`);
  }
  for (const field of ['model', 'reasoning_effort'] as const) {
    if (typeof evidence[field] !== 'string' || evidence[field].trim() === '') {
      violations.push(`${field} is required and must be non-empty`);
    }
  }
  if (typeof evidence['override_used'] !== 'boolean') {
    violations.push('override_used must be a boolean');
  }
  if (Object.prototype.hasOwnProperty.call(evidence, 'merge_sha')) {
    violations.push('top-level merge_sha is forbidden before merge; a branch SHA is execution identity, never merge authority');
  }
  if (Object.prototype.hasOwnProperty.call(evidence, 'closeout_binding')) {
    violations.push('closeout_binding is forbidden before authoritative merged-PR attestation');
  }
  if (
    evidence['execution_sha'] !== undefined &&
    (typeof evidence['execution_sha'] !== 'string' || !/^[0-9a-f]{40}$/.test(evidence['execution_sha']))
  ) {
    violations.push('execution_sha must be a full 40-character Git SHA when present');
  }
  const manifest = options.manifestRouting;
  if (manifest) {
    const comparisons: Array<[string, unknown]> = [
      ['model', manifest.model],
      ['reasoning_effort', manifest.reasoning_effort],
      ['model_profile', manifest.profile],
      ['policy_version', manifest.policy_version],
    ];
    for (const [field, expected] of comparisons) {
      if (evidence[field] !== undefined && evidence[field] !== expected) {
        violations.push(`${field} does not match manifest model_routing`);
      }
    }
    if (
      typeof evidence['override_used'] === 'boolean' &&
      evidence['override_used'] !== (manifest.selected_by === 'manual-override')
    ) {
      violations.push('override_used does not match manifest model_routing.selected_by');
    }
    const observation = manifest.override?.observation;
    if (observation) {
      // A reconciled lane's sidecar must carry the same unverified flag and unavailable
      // fields, so a matching sidecar cannot present a report as verified execution.
      if (evidence['execution_verification'] !== observation.verification) {
        violations.push(`execution_verification must be "${observation.verification}" for a reconciled lane`);
      }
      const unavailable = evidence['unavailable_fields'];
      if (
        !Array.isArray(unavailable) ||
        [...unavailable].sort().join('\n') !== [...observation.unavailable_fields].sort().join('\n')
      ) {
        violations.push('unavailable_fields does not match manifest model_routing.override.observation');
      }
      if (evidence['override_authorized_by'] !== manifest.override?.authorized_by) {
        violations.push('override_authorized_by does not match manifest model_routing.override.authorized_by');
      }
    }
  }
  return { valid: violations.length === 0, violations };
}

export type ModelRoutingResultCode =
  | 'OK'
  | 'POLICY_LOAD_FAILED'
  | 'PROFILE_UNKNOWN'
  | 'PROFILE_DISABLED'
  | 'PROFILE_NOT_PERMITTED_FOR_TIER'
  | 'MODEL_MISMATCH'
  | 'REASONING_EFFORT_INVALID'
  | 'POLICY_VERSION_MISMATCH'
  | 'TRUSTED_AUTHORIZATION_UNAVAILABLE'
  | 'OVERRIDE_INVALID'
  | 'RECONCILED_OBSERVATION';

export interface ModelRoutingResolution {
  ok: boolean;
  code: ModelRoutingResultCode;
  message: string;
  model_routing?: ModelRoutingBlock;
}

export const MODEL_ROUTING_POLICY_PATH = path.join(
  ROOT,
  'docs',
  '05_operations',
  'policies',
  'codex-model-routing.json',
);

export function loadModelRoutingPolicy(policyPath = MODEL_ROUTING_POLICY_PATH): ModelRoutingPolicy {
  if (!fs.existsSync(policyPath)) {
    throw new Error(`Model routing policy not found: ${policyPath}`);
  }
  const policy = parseJsonFile<ModelRoutingPolicy>(policyPath);
  validatePolicyShape(policy);
  return policy;
}

function validatePolicyShape(policy: ModelRoutingPolicy): void {
  if (policy.schema_version !== 1) {
    throw new Error('codex-model-routing.json schema_version must be 1');
  }
  if (!policy.policy_version || typeof policy.policy_version !== 'string') {
    throw new Error('codex-model-routing.json policy_version is required');
  }
  if (!policy.profiles || typeof policy.profiles !== 'object') {
    throw new Error('codex-model-routing.json profiles is required');
  }
  if (!policy.reasoning_effort_catalog || typeof policy.reasoning_effort_catalog !== 'object') {
    throw new Error('codex-model-routing.json reasoning_effort_catalog is required');
  }
  for (const [name, profile] of Object.entries(policy.profiles)) {
    if (!profile.model || typeof profile.model !== 'string') {
      throw new Error(`profile "${name}": model is required`);
    }
    if (!profile.reasoning_effort || typeof profile.reasoning_effort !== 'string') {
      throw new Error(`profile "${name}": reasoning_effort is required`);
    }
    if (typeof profile.enabled !== 'boolean') {
      throw new Error(`profile "${name}": enabled must be a boolean`);
    }
    if (!Array.isArray(profile.permitted_tiers)) {
      throw new Error(`profile "${name}": permitted_tiers must be an array`);
    }
    if (typeof profile.requires_pm_authorization !== 'boolean') {
      throw new Error(`profile "${name}": requires_pm_authorization must be a boolean`);
    }
    const catalog = policy.reasoning_effort_catalog[profile.model];
    if (!catalog || !catalog.includes(profile.reasoning_effort)) {
      throw new Error(
        `profile "${name}": reasoning_effort "${profile.reasoning_effort}" is not in reasoning_effort_catalog for model "${profile.model}"`,
      );
    }
  }
  if (!policy.legacy_compatibility?.default_profile) {
    throw new Error('codex-model-routing.json legacy_compatibility.default_profile is required');
  }
  if (!policy.profiles[policy.legacy_compatibility.default_profile]) {
    throw new Error('legacy_compatibility.default_profile does not reference a defined profile');
  }
}

/** Structural validation only: both fields non-empty when an override is present. */
export function validateOverride(override: ModelRoutingOverride | undefined): { ok: boolean; message: string } {
  if (!override) {
    return { ok: true, message: 'no override present' };
  }
  if (!override.authorized_by || !override.authorized_by.trim()) {
    return { ok: false, message: 'override.authorized_by is required and must be non-empty' };
  }
  if (!override.reason || !override.reason.trim()) {
    return { ok: false, message: 'override.reason is required and must be non-empty' };
  }
  return { ok: true, message: 'override valid' };
}

/**
 * Validate a profile selection (made upstream by Three-Brain / the orchestrator) against
 * canonical policy and build the manifest's model_routing block. Fails closed on any
 * unknown/disabled/not-permitted/missing-override condition.
 */
export function resolveModelProfile(input: {
  profileName: string;
  tier: string;
  policy?: ModelRoutingPolicy;
  override?: ModelRoutingOverride;
}): ModelRoutingResolution {
  let policy: ModelRoutingPolicy;
  try {
    policy = input.policy ?? loadModelRoutingPolicy();
  } catch (error) {
    return { ok: false, code: 'POLICY_LOAD_FAILED', message: error instanceof Error ? error.message : String(error) };
  }

  const profile = policy.profiles[input.profileName];
  if (!profile) {
    return {
      ok: false,
      code: 'PROFILE_UNKNOWN',
      message: `Unknown model profile "${input.profileName}". Known profiles: ${Object.keys(policy.profiles).join(', ')}`,
    };
  }
  if (!profile.enabled) {
    return {
      ok: false,
      code: 'PROFILE_DISABLED',
      message: `Model profile "${input.profileName}" is disabled in policy version ${policy.policy_version}`,
    };
  }
  if (!profile.permitted_tiers.includes(input.tier)) {
    return {
      ok: false,
      code: 'PROFILE_NOT_PERMITTED_FOR_TIER',
      message: `Model profile "${input.profileName}" is not permitted for tier ${input.tier} (permitted: ${profile.permitted_tiers.join(', ') || 'none'})`,
    };
  }

  if (profile.requires_pm_authorization) {
    // PM review finding #3: a self-asserted authorized_by/reason string is not proof of
    // PM authorization -- it is a caller typing non-empty strings into its own request,
    // exactly the same self-certification loophole UTV2-1521 already closed for file
    // scope (see docs/05_operations/schemas/scope-override-v1.md). No override, however
    // well-formed, unlocks a requires_pm_authorization profile. This profile is
    // mechanically unavailable until a trusted external authorization mechanism exists
    // (e.g. an authenticated PR-comment scheme mirroring scope-override-v1) -- see the
    // follow-up governance issue referenced in codex-model-routing.json's
    // requires_pm_authorization description. Do not reintroduce an override-based
    // unlock here without that mechanism landing first.
    return {
      ok: false,
      code: 'TRUSTED_AUTHORIZATION_UNAVAILABLE',
      message:
        `Model profile "${input.profileName}" requires PM authorization, but no trusted authorization mechanism exists yet -- ` +
        `it is mechanically unavailable. A caller-supplied override is never sufficient. See the follow-up governance issue.`,
    };
  }
  if (input.override) {
    const overrideCheck = validateOverride(input.override);
    if (!overrideCheck.ok) {
      return { ok: false, code: 'OVERRIDE_INVALID', message: overrideCheck.message };
    }
    // An override on a profile that doesn't require PM authorization is accepted only
    // as an audit annotation (e.g. "operator explicitly chose this over the default") --
    // it grants no additional capability the profile didn't already have.
  }

  const catalog = policy.reasoning_effort_catalog[profile.model] ?? [];
  if (!catalog.includes(profile.reasoning_effort)) {
    return {
      ok: false,
      code: 'REASONING_EFFORT_INVALID',
      message: `Reasoning effort "${profile.reasoning_effort}" for model "${profile.model}" is not in the policy's reasoning_effort_catalog`,
    };
  }

  const modelRouting: ModelRoutingBlock = {
    profile: input.profileName,
    model: profile.model,
    reasoning_effort: profile.reasoning_effort,
    selected_by: input.override ? 'manual-override' : 'three-brain',
    policy_version: policy.policy_version,
  };
  if (input.override) {
    modelRouting.override = input.override;
  }

  return { ok: true, code: 'OK', message: 'resolved', model_routing: modelRouting };
}

/**
 * Validate a model_routing block already persisted in a lane manifest, immediately before
 * codex-exec.ts spawns Codex. Detects policy-version drift and tamper (manifest's model /
 * reasoning_effort no longer matching what policy defines for that profile).
 */
export function validatePersistedModelRouting(
  modelRouting: ModelRoutingBlock,
  tier: string,
  policy?: ModelRoutingPolicy,
): ModelRoutingResolution {
  let loadedPolicy: ModelRoutingPolicy;
  try {
    loadedPolicy = policy ?? loadModelRoutingPolicy();
  } catch (error) {
    return { ok: false, code: 'POLICY_LOAD_FAILED', message: error instanceof Error ? error.message : String(error) };
  }

  if (modelRouting.override?.declared) {
    // A reconciled block records what an external session ran. It never authorizes
    // codex-exec to spawn anything, even when the observed values happen to match a profile.
    return {
      ok: false,
      code: 'RECONCILED_OBSERVATION',
      message:
        `manifest model_routing was reconciled to an observed execution (declared profile ` +
        `"${modelRouting.override.declared.profile}"); codex-exec cannot run a reconciled lane.`,
    };
  }

  if (modelRouting.policy_version !== loadedPolicy.policy_version) {
    return {
      ok: false,
      code: 'POLICY_VERSION_MISMATCH',
      message: `manifest model_routing.policy_version "${modelRouting.policy_version}" does not match current policy version "${loadedPolicy.policy_version}". Re-resolve routing before executing: pnpm ops:lane-manifest re-resolve-routing <issue id>.`,
    };
  }

  const resolution = resolveModelProfile({
    profileName: modelRouting.profile,
    tier,
    policy: loadedPolicy,
    override: modelRouting.override,
  });
  if (!resolution.ok) {
    return resolution;
  }

  if (resolution.model_routing!.model !== modelRouting.model) {
    return {
      ok: false,
      code: 'MODEL_MISMATCH',
      message: `manifest model_routing.model "${modelRouting.model}" does not match the concrete model policy defines for profile "${modelRouting.profile}" ("${resolution.model_routing!.model}")`,
    };
  }
  if (resolution.model_routing!.reasoning_effort !== modelRouting.reasoning_effort) {
    return {
      ok: false,
      code: 'REASONING_EFFORT_INVALID',
      message: `manifest model_routing.reasoning_effort "${modelRouting.reasoning_effort}" does not match policy's reasoning_effort "${resolution.model_routing!.reasoning_effort}" for profile "${modelRouting.profile}"`,
    };
  }

  return { ok: true, code: 'OK', message: 'model routing validated', model_routing: modelRouting };
}

const require = createRequire(import.meta.url);
const { parseVerdict } = require('./merge-gate-verdict.cjs') as {
  parseVerdict: (body: string | null | undefined) => {
    verdict: 'APPROVED' | 'CHANGES_REQUIRED';
    issueId: string;
    prNumber: number | null;
    headSha: string | null;
  } | null;
};

/** Must match the CODEOWNERS reviewer set merge-gate.yml and pre-merge-authorization.ts use. */
export const ROUTING_APPROVAL_REVIEWERS: ReadonlySet<string> = new Set(['griff843']);

export interface RoutingApprovalComment {
  html_url: string;
  /** GitHub-supplied: the API URL of the issue or PR the comment is on. */
  issue_url?: string | null;
  body: string | null;
  user: { login: string; type: string } | null;
}

/**
 * Accept a reconciliation only on the existing independent approval artifact: a
 * pm-verdict/v1 APPROVED comment by a CODEOWNERS reviewer on the lane's own PR, bound to
 * that PR's current head, naming the exact observed model and reasoning effort. The
 * reviewer recorded is GitHub's comment author, never caller-supplied text.
 */
export function verifyRoutingApproval(
  comment: RoutingApprovalComment,
  context: {
    repository: string;
    issueId: string;
    prNumber: number;
    headSha: string;
    model: string;
    reasoningEffort: string;
  },
): RoutingApproval {
  const errors: string[] = [];
  // Where the comment actually lives comes from GitHub, never from the comment's text.
  const expectedIssueUrl = `https://api.github.com/repos/${context.repository}/issues/${context.prNumber}`;
  if (comment.issue_url !== expectedIssueUrl) {
    errors.push(`comment is on ${comment.issue_url ?? '<no issue_url>'}, not ${expectedIssueUrl}`);
  }
  if (!comment.html_url?.startsWith(`https://github.com/${context.repository}/pull/${context.prNumber}#`)) {
    errors.push(`comment URL ${comment.html_url} is not on ${context.repository} PR #${context.prNumber}`);
  }
  const login = comment.user?.login ?? '';
  if (comment.user?.type === 'Bot') {
    errors.push(`author ${login} is a bot`);
  }
  if (!ROUTING_APPROVAL_REVIEWERS.has(login)) {
    errors.push(`author "${login}" is not a CODEOWNERS reviewer`);
  }
  const parsed = parseVerdict(comment.body);
  if (!parsed) {
    errors.push('comment is not a pm-verdict/v1 verdict');
  } else {
    if (parsed.verdict !== 'APPROVED') errors.push(`verdict is ${parsed.verdict}, not APPROVED`);
    if (parsed.issueId.toUpperCase() !== context.issueId.toUpperCase()) {
      errors.push(`verdict Issue ${parsed.issueId} is not ${context.issueId}`);
    }
    if (parsed.prNumber !== context.prNumber) errors.push(`verdict PR ${parsed.prNumber} is not #${context.prNumber}`);
    if (parsed.headSha !== context.headSha) errors.push(`verdict Head SHA ${parsed.headSha} is not the PR head ${context.headSha}`);
  }
  const expected = `Routing reconciliation: ${context.model} / ${context.reasoningEffort}`;
  const lines = (comment.body ?? '').split(/\r?\n/).map((line) => line.trim());
  if (!lines.includes(expected)) {
    errors.push(`verdict does not contain the line "${expected}"`);
  }
  if (errors.length > 0) {
    throw new Error(`reconcile-routing approval refused: ${errors.join('; ')}`);
  }
  return { comment_url: comment.html_url, reviewer: login, pr_number: context.prNumber, head_sha: context.headSha };
}

/**
 * Record the model a started Codex lane actually ran on, when it differs from the
 * routing declared at lane-start (WORK-2026102902). An independent Codex session picks
 * its model outside this repository, and the closeout rebind and pre-merge contract
 * both require the proof sidecar to match the manifest. Without this, the only ways to
 * close such a lane are fabricating the sidecar or hand-editing the manifest.
 *
 * The result is a manual-override block whose authorized_by is the verified approval's
 * reviewer. It keeps the original declaration in override.declared (a repeated
 * reconciliation keeps the first one), records an unexposed reasoning effort as
 * UNAVAILABLE_ROUTING_VALUE, and flags the observation as unverified.
 */
export function reconcileObservedModelRouting(
  current: ModelRoutingBlock,
  observed: { profile: string; model: string; reasoning_effort: string | null; source: string },
  approval: RoutingApproval,
  now: string,
): ModelRoutingBlock {
  const missing: string[] = [];
  for (const [name, value] of [
    ['profile', observed.profile],
    ['model', observed.model],
    ['source', observed.source],
  ] as const) {
    if (typeof value !== 'string' || value.trim() === '') {
      missing.push(name);
    }
  }
  if (observed.reasoning_effort !== null && observed.reasoning_effort.trim() === '') {
    missing.push('reasoning_effort');
  }
  if (missing.length > 0) {
    throw new Error(`reconcile-routing requires non-empty ${missing.join(', ')}`);
  }
  if (observed.reasoning_effort?.trim().toLowerCase() === UNAVAILABLE_ROUTING_VALUE) {
    throw new Error(
      `reconcile-routing refused: "${UNAVAILABLE_ROUTING_VALUE}" is not an observed reasoning effort; ` +
        'pass the reasoning effort as unavailable instead',
    );
  }
  const profile = observed.profile.trim();
  const model = observed.model.trim();
  const reasoningEffort = observed.reasoning_effort?.trim() ?? UNAVAILABLE_ROUTING_VALUE;
  if (profile === current.profile && model === current.model && reasoningEffort === current.reasoning_effort) {
    throw new Error('reconcile-routing refused: the observed routing already equals the manifest model_routing');
  }
  const declared: DeclaredModelRouting = current.override?.declared ?? {
    profile: current.profile,
    model: current.model,
    reasoning_effort: current.reasoning_effort,
    selected_by: current.selected_by,
  };
  return {
    profile,
    model,
    reasoning_effort: reasoningEffort,
    selected_by: 'manual-override',
    policy_version: current.policy_version,
    override: {
      authorized_by: approval.reviewer,
      reason: `pm-verdict/v1 APPROVED ${approval.comment_url}`,
      at: now,
      declared,
      observation: {
        verification: UNVERIFIED_EXTERNAL_SESSION,
        source: observed.source.trim(),
        unavailable_fields: observed.reasoning_effort === null ? ['reasoning_effort'] : [],
      },
      approval,
    },
  };
}

/**
 * Move a lane's routing to the current policy version without changing its profile
 * (WORK-2026102906). A policy re-version otherwise strands every open Codex lane:
 * codex-exec refuses POLICY_VERSION_MISMATCH and nothing could re-resolve. The profile
 * the lane was routed to is re-resolved under the current policy and tier, with the same
 * fail-closed checks lane-start applies, so a profile the new policy removed, disabled or
 * no longer permits for the tier is refused rather than substituted. A reconciled lane is
 * refused: its block records an observation, not a routing decision. The prior pin is
 * appended to re_resolutions.
 */
export function reResolveModelRouting(
  current: ModelRoutingBlock,
  tier: string,
  now: string,
  policy?: ModelRoutingPolicy,
): ModelRoutingBlock {
  if (current.override?.declared) {
    throw new Error(
      `re-resolve-routing refused: model_routing was reconciled to an observed execution (declared profile ` +
        `"${current.override.declared.profile}"); a reconciled lane cannot be re-resolved`,
    );
  }
  const loadedPolicy = policy ?? loadModelRoutingPolicy();
  if (current.policy_version === loadedPolicy.policy_version) {
    throw new Error(`re-resolve-routing refused: model_routing is already on policy version ${loadedPolicy.policy_version}`);
  }
  const resolution = resolveModelProfile({
    profileName: current.profile,
    tier,
    policy: loadedPolicy,
    override: current.override,
  });
  if (!resolution.ok) {
    throw new Error(`re-resolve-routing refused: ${resolution.code} ${resolution.message}`);
  }
  return {
    ...resolution.model_routing!,
    re_resolutions: [
      ...(current.re_resolutions ?? []),
      {
        from_policy_version: current.policy_version,
        from_model: current.model,
        from_reasoning_effort: current.reasoning_effort,
        to_policy_version: loadedPolicy.policy_version,
        at: now,
      },
    ],
  };
}

/**
 * Resolve the legacy-default routing decision for a manifest that predates the
 * model-routing policy (has no model_routing block at all). The caller (codex-exec.ts)
 * must never persist this result back into the historical manifest -- it is valid only
 * for the current execution's evidence output.
 */
export function resolveLegacyModelRouting(tier: string, policy?: ModelRoutingPolicy): ModelRoutingResolution {
  let loadedPolicy: ModelRoutingPolicy;
  try {
    loadedPolicy = policy ?? loadModelRoutingPolicy();
  } catch (error) {
    return { ok: false, code: 'POLICY_LOAD_FAILED', message: error instanceof Error ? error.message : String(error) };
  }
  const defaultProfileName = loadedPolicy.legacy_compatibility.default_profile;
  const resolution = resolveModelProfile({ profileName: defaultProfileName, tier, policy: loadedPolicy });
  if (!resolution.ok) {
    return resolution;
  }
  resolution.model_routing!.legacy_resolved = true;
  return resolution;
}

/** Pure builder for the codex exec argument fragment -- never a shell string. */
export function buildCodexModelArgs(modelRouting: Pick<ModelRoutingBlock, 'model' | 'reasoning_effort'>): string[] {
  return ['--model', modelRouting.model, '-c', `model_reasoning_effort=${modelRouting.reasoning_effort}`];
}
