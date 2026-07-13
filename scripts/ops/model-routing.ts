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
}

export interface ModelRoutingBlock {
  profile: string;
  model: string;
  reasoning_effort: string;
  selected_by: 'three-brain' | 'manual-override';
  policy_version: string;
  legacy_resolved?: boolean;
  override?: ModelRoutingOverride;
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
  | 'OVERRIDE_INVALID';

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

  if (modelRouting.policy_version !== loadedPolicy.policy_version) {
    return {
      ok: false,
      code: 'POLICY_VERSION_MISMATCH',
      message: `manifest model_routing.policy_version "${modelRouting.policy_version}" does not match current policy version "${loadedPolicy.policy_version}". Re-resolve routing before executing.`,
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
