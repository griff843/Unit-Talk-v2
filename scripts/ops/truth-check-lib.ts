import fs from 'node:fs';
import path from 'node:path';

// UTV2-1222: Normalize short vs full SHA comparison. The GitHub API returns the
// full 40-char SHA while lane manifests may store the abbreviated 8-char form.
// Treat a short SHA as matching if it is a valid hex prefix (≥7 chars) of the
// full SHA. Only accepts lowercase hex to avoid false prefix matches on branch names.
function shaMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [longer, shorter] = a.length >= b.length ? [a, b] : [b, a];
  return shorter.length >= 7 && /^[0-9a-f]+$/i.test(shorter) && longer.toLowerCase().startsWith(shorter.toLowerCase());
}

// UTV2-1590: WORKFLOW_SPEC defines Ready to Close as a canonical closeout
// state. These three names are the canonical closeout states and are always
// permitted regardless of the state type reported by Linear.
const L3_PERMITTED_LINEAR_STATES = new Set(['Ready to Close', 'In PM Review', 'Done']);

// UTV2-1689 (UTV2-1619 capability 17): L3 must gate on the *lane's* readiness,
// not on the parent issue's workflow state. The original UTV2-1590 rule was a
// flat name allowlist, which conflated lane completion with issue completion:
// on a multi-increment issue an honest active state ("In Claude", "In Codex",
// "Blocked Internal") blocked its own merged increment from truth-closing, and
// the only escape was to push the issue toward a terminal state -- exactly the
// conflation capability 17 exists to remove.
//
// We gate on Linear's state *type* rather than its name because names are
// workspace-configurable and drift (a renamed "In Claude" would silently start
// failing a name allowlist), while the type is a Linear-defined enum.
//
//   started   -> work is actively in flight. An increment of it may close.
//   completed -> the issue is already finished. Closing an increment is fine.
//
// Every other type stays fail-closed, preserving UTV2-1590's intent:
//   backlog / unstarted / triage -> the lane cannot have legitimately merged
//     against an issue that never started; this signals manifest/issue drift.
//   canceled / duplicate -> the work was abandoned or superseded; closing a
//     lane against it would record completion of work nobody wants.
//   unknown / missing -> fail closed, per invariant 10.
//
// This deliberately does NOT make issue-level completion easier. Whether the
// *issue* may be marked Done remains gated separately by capability 17's five
// conditions; L3 only decides whether a *lane* may produce a truth receipt.
const L3_PERMITTED_LINEAR_STATE_TYPES = new Set(['started', 'completed']);

export function isLinearStatePermittedForL3(
  stateName: string | null | undefined,
  stateType?: string | null | undefined,
): boolean {
  if (L3_PERMITTED_LINEAR_STATES.has(stateName ?? '')) return true;
  // Only consult the type when Linear actually reported one. An absent type
  // must not widen the gate -- it falls through to the name allowlist above.
  const normalizedType = (stateType ?? '').trim().toLowerCase();
  if (!normalizedType) return false;
  return L3_PERMITTED_LINEAR_STATE_TYPES.has(normalizedType);
}
import { loadEnvironment } from '@unit-talk/config';
import {
  type CheckResult,
  type LaneManifest,
  type LaneTier,
  type TruthCheckHistoryEntry,
  type TruthCheckResult,
  EVIDENCE_BUNDLE_SCHEMA_PATH,
  MANIFEST_DIR,
  ROOT,
  git,
  issueToManifestPath,
  parseJsonFile,
  readConfiguredEnvValue,
  readManifest,
  relativeToRoot,
  validateManifest,
  validateTruthResultSchemaDependencies,
  writeManifest,
} from './shared.js';
// UTV2-1640: S1 previously tested scope membership with an exact Set lookup, so a
// `dir/**` entry in file_scope_lock could never match a real file path. The
// pre-merge guard already implements the correct `/**`-and-prefix semantics, so
// reuse that single definition here rather than adding a third independent one.
import { matchesLockPattern } from '../ci/file-scope-guard.js';
import { readAllLeases, type DispatchLease } from './lease-registry.js';
import {
  validateEvidenceBundleContract,
  type MergedPrAttestation,
  type EvidenceContractResult,
} from './proof-schema.js';

const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

interface RunTruthCheckOptions {
  issueId: string;
  json?: boolean;
  tierOverride?: LaneTier;
  sinceSha?: string;
  noRuntime?: boolean;
  explain?: boolean;
  runner?: 'ops:lane-close' | 'ops:reconcile' | 'manual';
  /**
   * UTV2-1691 — evaluate without persisting anything.
   *
   * The gate answers "would this lane close, and why not?" by running the full
   * evaluation and then writing the outcome back into the manifest. That write
   * makes the question unaskable: diagnosing a lane appends a
   * `truth_check_history` entry, bumps `heartbeat_at`, and on exit code 4 sets
   * `status: 'reopened'` and rewrites `reopen_history`. Triaging a population of
   * merged-but-unclosed lanes therefore mutates the exact population being
   * triaged, and can reopen lanes that were merely unclosed.
   *
   * `dryRun` gates ONLY the persistence step. Every check, the verdict, the exit
   * code and the returned result are produced by the same code in both modes --
   * there is no second evaluation path to drift from the live one.
   *
   * This is a diagnosis, never a certification: a dry run cannot close a lane and
   * records nothing. `--explain` is presentation-only and is NOT a safe mode.
   */
  dryRun?: boolean;
}

interface LinearIssueRecord {
  id: string;
  identifier: string;
  title: string;
  state?: { name: string; type?: string | null } | null;
  labels?: { nodes: Array<{ name: string }> } | null;
  attachments?: { nodes: Array<{ title?: string | null; url?: string | null }> } | null;
  project?: { id: string; name: string } | null;
}

const P0_PROJECT_ID = '46229dc4-c7c1-4ccb-af0d-dedaf8147a97';

export interface EvidenceBundleV1 {
  schema_version: number;
  proof_profile?: string;
  sha_binding?: {
    verified_source_sha?: string;
    evidence_commit_sha?: string;
    current_pr_head_sha?: string;
    [key: string]: unknown;
  };
  merge_sha?: string;
  generated_at?: string;
  verifier?: {
    identity?: string;
  };
  static_proof?: {
    test_run_logs?: Array<{
      path?: string;
      merge_sha?: string;
    }>;
    [key: string]: unknown;
  };
  runtime_proof?: {
    queries?: unknown[];
    receipts?: unknown[];
    row_counts?: unknown[];
    [key: string]: unknown;
  };
}

export interface ExternalVerifierProvenance {
  source: 'github-required-check';
  producer: string;
  verified_sha: string;
  details_url: string | null;
}

export interface CommitCheckResult {
  passed: boolean;
  missing: string[];
  bypassed?: string[];
  evidence?: RequiredCheckEvidence[];
}

export interface RequiredCheckIdentity {
  context: string;
  app_id: number | null;
}

export interface RequiredCheckEvidence {
  context: string;
  required_app_id: number | null;
  matched: boolean;
  source: 'status' | 'check_run' | null;
  candidate_id: number | null;
  candidate_name: string | null;
  candidate_app_id: number | null;
  state: string | null;
  conclusion: string | null;
  timestamp: string | null;
  passed: boolean;
  details_url: string | null;
  selection_reason: string;
}

export interface GitHubCommitStatus {
  id?: number;
  context?: string;
  state?: string;
  created_at?: string;
  updated_at?: string;
  target_url?: string | null;
}

export interface GitHubCheckRun {
  id?: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  created_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
  details_url?: string | null;
  app?: {
    id?: number | null;
  } | null;
}

export interface CloseoutProofArtifact {
  path: string;
  content: string;
  mtime_ms?: number;
}

export interface CloseoutTruthGateInput {
  manifest: Pick<
    LaneManifest,
    | 'issue_id'
    | 'status'
    | 'commit_sha'
    | 'pr_url'
    | 'files_changed'
    | 'expected_proof_paths'
    | 'created_by'
  > & Partial<Pick<LaneManifest, 'lane_type' | 'tier'>>;
  linear_state: string;
  pr_merged: boolean;
  pr_merge_sha: string | null;
  pr_head_sha?: string | null;
  mergedPrAttestation?: MergedPrAttestation | null;
  proof_artifacts: CloseoutProofArtifact[];
  merge_timestamp_ms?: number | null;
  runtime_proof_required?: boolean;
  transition_age_ms?: number;
  allowed_transition_ms?: number;
}

export function evaluateTerminalLeaseInvariant(
  manifest: Pick<LaneManifest, 'issue_id' | 'status'>,
  leases: readonly DispatchLease[],
): CheckResult {
  if (manifest.status !== 'done') {
    return {
      id: 'M8',
      status: 'pass',
      detail: `terminal lease release is enforced at the done transition; current status is ${manifest.status}`,
    };
  }
  const lease = leases.find(
    (candidate) => candidate.issue_id.toUpperCase() === manifest.issue_id.toUpperCase(),
  );
  if (lease && (lease.status === 'active' || lease.status === 'stale_reclaim_required')) {
    return {
      id: 'M8',
      status: 'fail',
      detail:
        `terminal manifest ${manifest.issue_id} still holds a ${lease.status} control-checkout lease ` +
        `for ${lease.file_scope_lock.length} path(s); run ops:lane-finalize to replay terminal cleanup`,
    };
  }
  return {
    id: 'M8',
    status: 'pass',
    detail: lease
      ? `terminal manifest lease is ${lease.status}`
      : 'terminal manifest has no control-checkout lease',
  };
}

export function evaluateCloseoutTruthGate(input: CloseoutTruthGateInput): CheckResult[] {
  const checks: CheckResult[] = [];
  const fail = (id: string, detail: string): void => checks.push({ id, status: 'fail', detail });
  const pass = (id: string, detail: string): void => checks.push({ id, status: 'pass', detail });

  const linearDone = /^done$/i.test(input.linear_state);
  const completedImplementation = input.manifest.files_changed.length > 0 ||
    input.manifest.expected_proof_paths.length > 0;
  const mergeSha = input.manifest.commit_sha?.trim() || null;
  const prMergeSha = input.pr_merge_sha?.trim() || null;
  const prHeadSha = input.pr_head_sha?.trim() || null;

  if (linearDone && !prMergeSha) {
    fail('C1', 'Linear Done is not allowed without a merged PR SHA');
  } else {
    pass('C1', 'Linear Done merge SHA requirement satisfied');
  }

  if (completedImplementation && !mergeSha) {
    fail('C2', 'completed implementation work requires manifest.commit_sha');
  } else {
    pass('C2', 'manifest.commit_sha requirement satisfied');
  }

  if (prMergeSha && mergeSha && !shaMatches(prMergeSha, mergeSha)) {
    fail('C3', 'PR merge SHA does not match manifest.commit_sha');
  } else {
    pass('C3', 'PR merge SHA and manifest.commit_sha agree or are not both present');
  }

  const requiredProofSha = mergeSha ?? prMergeSha ?? prHeadSha;
  const proofWithoutSha = input.proof_artifacts.filter(
    (artifact) =>
      artifact.content.trim().length > 0 &&
      requiredProofSha &&
      !artifact.content.includes(requiredProofSha),
  );
  if (proofWithoutSha.length > 0) {
    fail('C4', `proof artifacts missing required SHA binding (${requiredProofSha}): ${proofWithoutSha.map((artifact) => artifact.path).join(', ')}`);
  } else {
    pass('C4', 'proof artifacts are SHA-bound or no SHA-bound proof is applicable');
  }

  if (input.merge_timestamp_ms !== null && input.merge_timestamp_ms !== undefined) {
    const staleProof = input.proof_artifacts.filter(
      (artifact) =>
        artifact.mtime_ms !== undefined &&
        artifact.mtime_ms < input.merge_timestamp_ms!,
    );
    if (staleProof.length > 0) {
      fail('C5', `proof artifacts predate merge SHA: ${staleProof.map((artifact) => artifact.path).join(', ')}`);
    } else {
      pass('C5', 'proof artifact mtimes do not predate merge timestamp');
    }
  } else {
    pass('C5', 'proof mtime freshness not applicable without merge timestamp');
  }

  if (input.runtime_proof_required) {
    const runtimeEvidence = input.proof_artifacts.some((artifact) => {
      const parsed = tryParseEvidenceBundle(artifact.content);
      if (!parsed) return hasRuntimeProofTextEvidence(artifact.content);
      const contract = validateEvidenceBundleContract(parsed, {
        gate: 'post-merge-read',
        laneType: input.manifest.lane_type,
        tier: input.manifest.tier,
        repoRoot: ROOT,
        mergedPrAttestation: input.mergedPrAttestation,
      });
      return contract.schemaVersion === 1
        ? hasRuntimeReferences(parsed.runtime_proof)
        : contract.valid;
    });
    if (!runtimeEvidence) {
      fail('C6', 'runtime-proof closeout requires evidence valid for the manifest-declared proof profile');
    } else {
      pass('C6', 'runtime-proof evidence satisfies the manifest-declared proof profile');
    }
  } else {
    pass('C6', 'runtime-proof evidence not required for this closeout');
  }

  const allowedTransitionMs = input.allowed_transition_ms ?? 30 * 60 * 1000;
  const transitionAgeMs = input.transition_age_ms ?? 0;
  const manifestDone = input.manifest.status === 'done';
  if (manifestDone && !input.pr_merged) {
    fail('C7', 'manifest is Done but PR is not merged');
  } else if ((input.pr_merged || manifestDone) && !linearDone && transitionAgeMs > allowedTransitionMs) {
    fail('C7', 'PR is merged but Linear is not Done beyond the allowed transition window');
  } else if (linearDone && !input.pr_merged) {
    fail('C7', 'Linear is Done but PR is not merged');
  } else {
    pass('C7', 'Linear/PR state is within the allowed closeout transition semantics');
  }

  return checks;
}

/**
 * UTV2-1640: S1 scope-diff evaluation, extracted so it is directly testable.
 *
 * Previously this matched with an exact `Set` lookup, so a `dir/**` entry in
 * `file_scope_lock` could never match a real file path — every lane declaring a
 * directory glob failed S1 once `files_changed` was populated, while the
 * pre-merge file-scope guard passed the identical diff. The two gates disagreed
 * about what a scope lock means.
 *
 * Matching now delegates to `matchesLockPattern`, the same helper the pre-merge
 * guard uses, so there is one definition of scope semantics rather than two.
 */
/**
 * Close-eligibility preflight (UTV2-1619).
 *
 * WHY THIS EXISTS. Five lanes merged green and were then discovered incapable of
 * producing a truth receipt, each requiring a repair PR after the fact:
 *
 *   UTV2-1661  manifest missing `model_routing` -> truth-check exits infra_error
 *              at M2, masking every later failure; proof MERGE_SHA unreachable
 *              from main; proof missing pnpm test / pnpm verify / r-level-check.
 *   UTV2-1634  same shape.
 *   UTV2-1649  model-routing sidecar missing `override_used` -> the fatal
 *              sidecar_manifest_routing_mismatch; diff-summary carried no
 *              merge-SHA anchor so proof-generate refused to rebind it; proof
 *              missing pnpm verify and r-level-check.
 *   UTV2-1619  proof missing pnpm verify and r-level-check (capability 17 lane).
 *
 * Every one of those defects was present in the packet BEFORE the merge and was
 * knowable from the PR head alone. The code that rejected them post-merge is
 * ordinary library code that could have run pre-merge and did not.
 *
 * DESIGN: this is a decision module shared by the merge and close paths, not a
 * second implementation. It calls `evaluateT2ProofEvidence` -- the very function
 * the close gate uses for P11-P14 -- so the two can never disagree about what a
 * conformant proof packet is. Re-deriving those rules here would recreate the
 * duplicated-authority drift class this program keeps finding.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: pre-merge there is no merge SHA, so merge
 * reachability (G3), CI results on the merge commit, and the receipt itself are
 * genuinely unknowable. Those are reported as `not_knowable_pre_merge` rather
 * than passed or failed. Reporting an unknowable check as `pass` would make the
 * preflight assert something it cannot see, which is the failure mode the whole
 * issue exists to eliminate.
 */
export type CloseEligibilityCategory = 'evidence' | 'manifest' | 'close' | 'lifecycle';

export type CloseEligibilityStatus = 'pass' | 'fail' | 'not_knowable_pre_merge';

export interface CloseEligibilityFinding {
  id: string;
  category: CloseEligibilityCategory;
  status: CloseEligibilityStatus;
  detail: string;
  /** The historical lane whose failure this check exists to prevent, when applicable. */
  regression_source?: string;
}

export interface CloseEligibilityPreflightInput {
  manifest: Pick<
    LaneManifest,
    'issue_id' | 'tier' | 'schema_version' | 'created_by' | 'expected_proof_paths' | 'pr_url' | 'lane_type'
  > & { model_routing?: unknown };
  /** Proof artifacts as they exist at the PR head. */
  proof_artifacts: CloseoutProofArtifact[];
}

export interface CloseEligibilityPreflightResult {
  /** False when any check FAILED. `not_knowable_pre_merge` never blocks. */
  eligible: boolean;
  findings: CloseEligibilityFinding[];
  blocking: CloseEligibilityFinding[];
}

/** Executors whose manifests require a model_routing block at schema_version 2. */
function requiresModelRouting(manifest: { schema_version?: unknown; created_by?: unknown }): boolean {
  return Number(manifest.schema_version) >= 2 && String(manifest.created_by ?? '') !== 'claude';
}

/**
 * Can `ops:proof-generate` bind this artifact to a merge SHA later?
 *
 * UTV2-1649: `diff-summary.md` carried no anchor, so proof-generate refused with
 * `unbindable_proof_artifact` rather than silently overwriting authored proof.
 * The refusal was correct; the packet was not bindable and nothing said so
 * before the merge.
 */
export function hasBindableShaAnchor(content: string): boolean {
  return content
    .split(/\r?\n/)
    .some(
      (line) =>
        /^\s*MERGE_SHA:/i.test(line) ||
        /^\s*Merge SHA:/i.test(line) ||
        /\|\s*Commit SHA\(s\)\s*\|/i.test(line),
    );
}

/**
 * Is a model-routing sidecar structurally conformant?
 *
 * UTV2-1649: `override_used` was absent. `proof-generate` requires it to be a
 * boolean so a sidecar cannot misrepresent who authorized an execution, and 22
 * of the 23 sidecars on main already carried it -- the rule was near-universally
 * satisfied and still unenforced at the boundary.
 */
export function evaluateModelRoutingSidecar(content: string): { ok: boolean; detail: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, detail: 'model-routing sidecar is not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, detail: 'model-routing sidecar is not a JSON object' };
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.override_used !== 'boolean') {
    return {
      ok: false,
      detail:
        'model-routing sidecar must carry a boolean override_used; without it proof-generate ' +
        'fails closed with sidecar_manifest_routing_mismatch after the merge',
    };
  }
  for (const field of ['issue_id', 'model', 'reasoning_effort'] as const) {
    if (typeof record[field] !== 'string' || String(record[field]).trim() === '') {
      return { ok: false, detail: `model-routing sidecar is missing required field "${field}"` };
    }
  }
  return { ok: true, detail: 'model-routing sidecar carries override_used and execution provenance' };
}

export function evaluateCloseEligibilityPreflight(
  input: CloseEligibilityPreflightInput,
): CloseEligibilityPreflightResult {
  const findings: CloseEligibilityFinding[] = [];
  const add = (
    id: string,
    category: CloseEligibilityCategory,
    status: CloseEligibilityStatus,
    detail: string,
    regression_source?: string,
  ): void => {
    findings.push({ id, category, status, detail, ...(regression_source ? { regression_source } : {}) });
  };

  const artifacts = input.proof_artifacts ?? [];
  const byPath = new Map(artifacts.map((a) => [a.path, a]));
  const combined = artifacts.map((a) => a.content).join('\n');

  // ── 1. Evidence readiness ────────────────────────────────────────────────
  const expected = input.manifest.expected_proof_paths ?? [];
  const missing = expected.filter((p) => !byPath.has(p));
  add(
    'CEP-E1',
    'evidence',
    missing.length === 0 && expected.length > 0 ? 'pass' : 'fail',
    expected.length === 0
      ? 'manifest declares no expected_proof_paths'
      : missing.length === 0
        ? 'every declared proof artifact is present at the PR head'
        : `declared proof artifacts missing at the PR head: ${missing.join(', ')}`,
  );

  // Emptiness is only meaningful for artifacts the manifest actually DECLARES.
  // Scanning every file under the proof directory also catches structural
  // placeholders -- a `.gitkeep` exists precisely to be empty, and failing a
  // lane for it reports a defect where there is none. CEP-E1 above already
  // scopes to `expected_proof_paths`; this check is scoped the same way so the
  // two agree on what a proof artifact is.
  //
  // This does not weaken the gate: a declared artifact that is empty still
  // fails, which is the case that actually matters. It narrows the input set to
  // the declared one rather than relaxing the rule applied to it.
  const expectedSet = new Set(expected);
  const empty = artifacts
    .filter((a) => expectedSet.has(a.path) && a.content.trim() === '')
    .map((a) => a.path);
  add(
    'CEP-E2',
    'evidence',
    empty.length === 0 ? 'pass' : 'fail',
    empty.length === 0
      ? 'no declared proof artifact is empty'
      : `empty proof artifacts: ${empty.join(', ')}`,
  );

  // Required sections, checked on the verification document specifically.
  const verification = artifacts.find((a) => /verification\.md$/i.test(a.path));
  if (verification) {
    const required = ['# PROOF:', 'MERGE_SHA:', 'ASSERTIONS:', 'EVIDENCE:'];
    const absent = required.filter((token) => !verification.content.includes(token));
    add(
      'CEP-E3',
      'evidence',
      absent.length === 0 ? 'pass' : 'fail',
      absent.length === 0
        ? 'verification document carries every required section'
        : `verification document missing required sections: ${absent.join(', ')}`,
      'UTV2-1661',
    );
  } else {
    add('CEP-E3', 'evidence', 'fail', 'no verification document found among proof artifacts', 'UTV2-1661');
  }

  // Required command references -- REUSES the close gate's own P11-P14 rules.
  for (const check of evaluateT2ProofEvidence({
    proofPaths: artifacts.map((a) => a.path),
    proofContents: combined,
  })) {
    add(
      `CEP-E4/${check.id}`,
      'evidence',
      check.status === 'pass' ? 'pass' : 'fail',
      check.detail,
      check.id === 'P13' || check.id === 'P14' ? 'UTV2-1619' : 'UTV2-1661',
    );
  }

  // SHA binding possible.
  const unbindable = artifacts
    .filter((a) => /\.(md)$/i.test(a.path))
    .filter((a) => !hasBindableShaAnchor(a.content))
    .map((a) => a.path);
  add(
    'CEP-E5',
    'evidence',
    unbindable.length === 0 ? 'pass' : 'fail',
    unbindable.length === 0
      ? 'every markdown proof artifact carries a rebindable merge-SHA anchor'
      : `proof artifacts cannot be SHA-bound after merge (no MERGE_SHA anchor): ${unbindable.join(', ')}`,
    'UTV2-1649',
  );

  const sidecar = artifacts.find((a) => /model-routing\.json$/i.test(a.path));
  if (sidecar) {
    const verdict = evaluateModelRoutingSidecar(sidecar.content);
    add('CEP-E6', 'evidence', verdict.ok ? 'pass' : 'fail', verdict.detail, 'UTV2-1649');
  }

  if (input.manifest.tier === 'T1') {
    const evidenceArtifact = artifacts.find((artifact) => /(?:^|\/)evidence(?:-bundle)?\.json$/i.test(artifact.path));
    let contract: EvidenceContractResult | null = null;
    if (evidenceArtifact) {
      try {
        contract = validateEvidenceBundleContract(JSON.parse(evidenceArtifact.content), {
          gate: 'pre-merge',
          laneType: input.manifest.lane_type,
          tier: input.manifest.tier,
        });
      } catch {
        contract = null;
      }
    }
    add(
      'CEP-E7',
      'evidence',
      contract?.valid ? 'pass' : 'fail',
      contract?.valid
        ? `evidence satisfies shared schema-v${contract.schemaVersion} ${contract.profile} contract`
        : contract
          ? `shared evidence contract failed: ${contract.failures.map((failure) => `${failure.field}: ${failure.message}`).join('; ')}`
          : 'T1 proof requires a readable evidence.json evaluated by the shared evidence contract',
    );
  }

  // ── 2. Manifest readiness ────────────────────────────────────────────────
  const tierOk = /^T[123]$/.test(String(input.manifest.tier ?? ''));
  add(
    'CEP-M1',
    'manifest',
    tierOk ? 'pass' : 'fail',
    tierOk ? `tier resolves to ${input.manifest.tier}` : `tier "${input.manifest.tier}" is not resolvable`,
  );

  const needsRouting = requiresModelRouting(input.manifest);
  const hasRouting = typeof input.manifest.model_routing === 'object' && input.manifest.model_routing !== null;
  add(
    'CEP-M2',
    'manifest',
    !needsRouting || hasRouting ? 'pass' : 'fail',
    !needsRouting
      ? 'model_routing not required for this executor/schema combination'
      : hasRouting
        ? 'manifest carries the required model_routing block'
        : 'manifest is missing model_routing, which makes ops:truth-check exit infra_error at M2 ' +
          'and mask every later check',
    'UTV2-1661',
  );

  let prOk = false;
  try {
    prOk = Boolean(input.manifest.pr_url) && Boolean(parsePullRequestUrl(String(input.manifest.pr_url)));
  } catch {
    prOk = false;
  }
  add(
    'CEP-M3',
    'manifest',
    prOk ? 'pass' : 'fail',
    prOk ? 'manifest.pr_url is present and parseable' : 'manifest.pr_url is missing or unparseable',
  );

  // ── 3. Close readiness ───────────────────────────────────────────────────
  const evidenceBlocking = findings.filter((f) => f.category === 'evidence' && f.status === 'fail');
  const manifestBlocking = findings.filter((f) => f.category === 'manifest' && f.status === 'fail');
  add(
    'CEP-C1',
    'close',
    evidenceBlocking.length === 0 && manifestBlocking.length === 0 ? 'pass' : 'fail',
    evidenceBlocking.length === 0 && manifestBlocking.length === 0
      ? 'no pre-merge-knowable condition would prevent ops:lane-close from producing a receipt'
      : `ops:lane-close would fail after merge on: ${[...evidenceBlocking, ...manifestBlocking].map((f) => f.id).join(', ')}`,
  );

  add(
    'CEP-C2',
    'close',
    'not_knowable_pre_merge',
    'merge-SHA reachability, CI results on the merge commit, and the receipt itself cannot be ' +
      'evaluated before the merge exists; they remain the close gate\'s responsibility',
  );

  // ── 4. Lifecycle readiness ───────────────────────────────────────────────
  add(
    'CEP-L1',
    'lifecycle',
    'pass',
    'lane completion and issue completion are separate decisions: ops:lane-close completes a lane ' +
      'and completes an issue only under the five-condition gate, which requires an explicit ' +
      'completion intent that a lane closing cannot supply for itself',
  );

  add(
    'CEP-L2',
    'lifecycle',
    'not_knowable_pre_merge',
    'whether an automatic Done path exists OUTSIDE this repository cannot be determined from lane ' +
      'data; external mutation authorities are inventoried and governed separately',
  );

  const blocking = findings.filter((f) => f.status === 'fail');
  return { eligible: blocking.length === 0, findings, blocking };
}

export function evaluateScopeDiff(
  filesChanged: string[],
  fileScopeLock: string[],
  expectedProofPaths: string[],
): { status: 'pass' | 'fail'; detail: string } {
  if (filesChanged.length === 0 || fileScopeLock.length === 0) {
    return { status: 'pass', detail: 'scope-diff check not applicable (empty files_changed or scope)' };
  }

  const allowedPatterns = [...fileScopeLock, ...expectedProofPaths];
  const outOfScope = filesChanged.filter(
    (f) =>
      !allowedPatterns.some((pattern) => matchesLockPattern(f, pattern)) &&
      !f.includes('deleted-file') &&
      !f.startsWith('docs/06_status/proof/'),
  );

  return outOfScope.length > 0
    ? { status: 'fail', detail: `files_changed outside file_scope_lock: ${outOfScope.join(', ')}` }
    : { status: 'pass', detail: 'all files_changed are within file_scope_lock or proof paths' };
}

export function evaluateT2ProofEvidence(input: {
  proofPaths: string[];
  proofContents: string;
}): CheckResult[] {
  const checks: CheckResult[] = [];
  const add = (id: string, status: 'pass' | 'fail', detail: string): void => {
    checks.push({ id, status, detail });
  };

  if (
    /diff summary/i.test(input.proofContents) ||
    input.proofPaths.some((proofPath) => /diff-summary/i.test(path.basename(proofPath)))
  ) {
    add('P11', 'pass', 'proof includes a diff summary file');
  } else {
    add('P11', 'fail', 'proof must include a diff summary file');
  }

  if (hasCommandMention(input.proofContents, 'pnpm type-check') && hasCommandMention(input.proofContents, 'pnpm test')) {
    add('P12', 'pass', 'verification log references pnpm type-check and pnpm test');
  } else {
    add('P12', 'fail', 'verification log must reference pnpm type-check and pnpm test');
  }

  if (hasCommandMention(input.proofContents, 'pnpm verify')) {
    add('P13', 'pass', 'verification log references pnpm verify');
  } else {
    add('P13', 'fail', 'verification log must reference pnpm verify');
  }

  if (hasRLevelCheckMention(input.proofContents)) {
    add('P14', 'pass', 'verification log references r-level-check');
  } else {
    add('P14', 'fail', 'verification log must reference scripts/ci/r-level-check.ts');
  }

  return checks;
}

function hasRuntimeProofTextEvidence(content: string): boolean {
  return content
    .split(/\r?\n/)
    .some((line) =>
      /runtime_proof|row_counts|receipts|queries/i.test(line) &&
      /[\d{[]/.test(line),
    );
}

function hasCommandMention(content: string, command: string): boolean {
  const escaped = command
    .split(/\s+/)
    .map(escapeRegExp)
    .join('\\s+');
  const commandPattern = new RegExp(`\\b${escaped}\\b`, 'i');

  return content
    .split(/\r?\n/)
    .some((line) =>
      commandPattern.test(line) &&
      !/\bpnpm\s+verify:commands\b/i.test(line),
    );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasRLevelCheckMention(content: string): boolean {
  return content
    .split(/\r?\n/)
    .some((line) =>
      /\bscripts\/ci\/r-level-check\.ts\b/i.test(line) ||
      /\br-level-check(?:\.ts)?\b/i.test(line),
    );
}

type Verdict = TruthCheckResult['verdict'];

export async function runTruthCheck(
  options: RunTruthCheckOptions,
): Promise<TruthCheckResult> {
  validateTruthResultSchemaDependencies();
  const env = loadEnvironment();
  const issueId = options.issueId.toUpperCase();
  const checkedAt = new Date().toISOString();
  const manifestPath = issueToManifestPath(issueId);
  const checks: CheckResult[] = [];
  const failures = new Set<string>();
  const reopenReasons = new Set<string>();
  const explain = options.explain ?? false;
  // UTV2-1691: gates persistence only. Read once here so every exit path below
  // carries the same value; see RunTruthCheckOptions.dryRun.
  const dryRun = options.dryRun ?? false;
  let manifest: LaneManifest | null = null;
  let tier: LaneTier = options.tierOverride ?? 'T3';
  let mergeSha: string | null = null;
  let prUrl: string | null = null;
  let mergeTimestamp: string | null = null;
  let verifierProvenance: ExternalVerifierProvenance | null = null;

  const addCheck = (id: string, status: 'pass' | 'fail' | 'skip', detail: string): void => {
    checks.push({ id, status, detail });
    if (status === 'fail') {
      failures.add(id);
      if (id === 'G5') {
        reopenReasons.add(detail);
      }
    }
    if (explain) {
      process.stderr.write(`[${status.toUpperCase()}] ${id} ${detail}\n`);
    }
  };

  try {
    if (!fs.existsSync(manifestPath)) {
      addCheck('M1', 'fail', `manifest missing at ${relativeToRoot(manifestPath)}`);
      return finalizeResult({
        issueId,
        tier,
        verdict: 'infra_error',
        exitCode: 3,
        mergeSha,
        prUrl,
        checkedAt,
        checks,
        failures,
        reopenReasons,
      });
    }
    addCheck('M1', 'pass', `manifest found at ${relativeToRoot(manifestPath)}`);

    manifest = readManifest(issueId);
    const manifestValidation = validateManifest(manifest, manifestPath);
    if (manifestValidation.length > 0) {
      addCheck('M2', 'fail', manifestValidation.join('; '));
      return finalizeResult({
        issueId,
        tier,
        verdict: 'infra_error',
        exitCode: 3,
        mergeSha,
        prUrl,
        checkedAt,
        checks,
        failures,
        reopenReasons,
      });
    }
    addCheck('M2', 'pass', 'manifest schema validated');

    if (manifest.issue_id !== issueId) {
      addCheck('M3', 'fail', 'manifest.issue_id does not match requested issue');
      return finalizeResult({
        issueId,
        tier,
        verdict: 'infra_error',
        exitCode: 3,
        mergeSha,
        prUrl,
        checkedAt,
        checks,
        failures,
        reopenReasons,
      });
    }
    addCheck('M3', 'pass', 'manifest.issue_id matches CLI argument');

    tier = options.tierOverride ?? manifest.tier;
    if (manifest.status !== 'merged' && manifest.status !== 'done') {
      addCheck('M4', 'fail', `manifest status ${manifest.status} is not eligible for truth-check`);
      return finalizeResult({
        issueId,
        tier,
        verdict: 'ineligible',
        exitCode: 2,
        mergeSha: manifest.commit_sha,
        prUrl: manifest.pr_url,
        checkedAt,
        checks,
        failures,
        reopenReasons,
      });
    }
    addCheck('M4', 'pass', `manifest status ${manifest.status} is eligible`);

    prUrl = manifest.pr_url;
    if (!prUrl) {
      addCheck('M5', 'fail', 'manifest.pr_url is missing');
    } else {
      try {
        new URL(prUrl);
        addCheck('M5', 'pass', 'manifest.pr_url is parseable');
      } catch {
        addCheck('M5', 'fail', 'manifest.pr_url is not parseable');
      }
    }

    mergeSha = manifest.commit_sha;
    if (!mergeSha) {
      addCheck('M6', 'fail', 'manifest.commit_sha is missing');
    } else {
      addCheck('M6', 'pass', 'manifest.commit_sha is set');
    }

    if ((tier === 'T1' || tier === 'T2') && manifest.expected_proof_paths.length === 0) {
      addCheck('M7', 'fail', 'expected_proof_paths must be non-empty for T1/T2');
    } else {
      addCheck('M7', 'pass', 'expected_proof_paths satisfies tier requirement');
    }

    const terminalLease = evaluateTerminalLeaseInvariant(manifest, readAllLeases());
    addCheck(terminalLease.id, terminalLease.status, terminalLease.detail);

    const linearToken =
      env.LINEAR_API_TOKEN?.trim() ||
      process.env.LINEAR_API_KEY?.trim() ||
      readConfiguredEnvValue('LINEAR_API_TOKEN') ||
      readConfiguredEnvValue('LINEAR_API_KEY');
    if (!linearToken) {
      addCheck('L1', 'fail', 'LINEAR_API_TOKEN or LINEAR_API_KEY is required');
      return finalizeWithManifest({
        manifest,
        dryRun,
        issueId,
        tier,
        checkedAt,
        checks,
        failures,
        reopenReasons,
        mergeSha,
        prUrl,
        verdict: 'infra_error',
        exitCode: 3,
        runner: options.runner ?? 'manual',
      });
    }

    const linearIssue = await fetchLinearIssue(issueId, linearToken);
    addCheck('L1', 'pass', `Linear issue ${linearIssue.identifier} exists`);
    const linearLabels = (linearIssue.labels?.nodes ?? [])
      .map((label) => label.name.toLowerCase());
    const tierLabels = linearLabels
      .map((label) => label.replace(/^tier:/, ''))
      .filter((label) => label === 't1' || label === 't2' || label === 't3');
    const uniqueTierLabels = [...new Set(tierLabels)];
    if (uniqueTierLabels.length !== 1) {
      addCheck('L2', 'fail', `expected exactly one tier label, found ${uniqueTierLabels.length}`);
    } else {
      if (!options.tierOverride) {
        tier = uniqueTierLabels[0].toUpperCase() as LaneTier;
      }
      addCheck('L2', 'pass', `Linear tier label is ${uniqueTierLabels[0]}`);
    }

    const stateName = linearIssue.state?.name ?? '';
    const stateType = linearIssue.state?.type ?? '';
    if (!isLinearStatePermittedForL3(stateName, stateType)) {
      addCheck(
        'L3',
        'fail',
        `Linear state ${stateName || 'Unknown'} (type ${stateType || 'unknown'}) is not an active or closeout state; ` +
          'a lane may only close against an issue that is in flight or already complete',
      );
    } else {
      addCheck('L3', 'pass', `Linear state ${stateName} (type ${stateType || 'unknown'}) is permitted`);
    }

    const attachmentUrls = (linearIssue.attachments?.nodes ?? [])
      .map((attachment) => attachment.url?.trim())
      .filter((entry): entry is string => Boolean(entry));
    if (!prUrl || !attachmentUrls.includes(prUrl)) {
      addCheck('L4', 'fail', 'Linear attachments do not include manifest.pr_url');
    } else {
      addCheck('L4', 'pass', 'Linear attachments include manifest.pr_url');
    }

    const githubToken = process.env.GITHUB_TOKEN?.trim() || readConfiguredEnvValue('GITHUB_TOKEN');
    if (!githubToken) {
      addCheck('G1', 'fail', 'GITHUB_TOKEN is required');
      return finalizeWithManifest({
        manifest,
        dryRun,
        issueId,
        tier,
        checkedAt,
        checks,
        failures,
        reopenReasons,
        mergeSha,
        prUrl,
        verdict: 'infra_error',
        exitCode: 3,
        runner: options.runner ?? 'manual',
      });
    }
    if (!prUrl) {
      return finalizeWithManifest({
        manifest,
        dryRun,
        issueId,
        tier,
        checkedAt,
        checks,
        failures,
        reopenReasons,
        mergeSha,
        prUrl,
        verdict: 'fail',
        exitCode: 1,
        runner: options.runner ?? 'manual',
      });
    }

    const prRef = parsePullRequestUrl(prUrl);
    const pullRequest = await fetchGitHubPullRequest(prRef.owner, prRef.repo, prRef.number, githubToken);
    const mergedPrAttestation: MergedPrAttestation | null =
      pullRequest.merged &&
      typeof pullRequest.merge_commit_sha === 'string' &&
      FULL_SHA_RE.test(pullRequest.merge_commit_sha) &&
      typeof pullRequest.head?.sha === 'string' &&
      FULL_SHA_RE.test(pullRequest.head.sha)
        ? {
            merge_sha: pullRequest.merge_commit_sha,
            head_sha: pullRequest.head.sha,
            pr_number: prRef.number,
            source: 'github-api',
          }
        : null;
    if (!pullRequest.merged || !pullRequest.merge_commit_sha) {
      addCheck('G1', 'fail', 'pull request is not merged');
    } else {
      addCheck('G1', 'pass', 'pull request is merged');
    }

    if (!mergeSha || !shaMatches(pullRequest.merge_commit_sha, mergeSha)) {
      addCheck('G2', 'fail', 'PR merge commit SHA does not match manifest.commit_sha');
    } else {
      addCheck('G2', 'pass', 'PR merge commit SHA matches manifest.commit_sha');
    }

    if (mergeSha) {
      const g3 = checkCommitReachableFromMain(mergeSha);
      if (g3.reachable && !g3.firstParent) {
        // SHA is reachable via a secondary-parent chain (e.g. squash merge that landed
        // on a --no-ff merge commit). This is valid — emit a warning but do not fail.
        addCheck('G3', 'pass', 'merge commit is reachable from main (via secondary-parent chain; squash-merge anomaly)');
      } else if (g3.reachable) {
        addCheck('G3', 'pass', 'merge commit is reachable on main first-parent history');
      } else {
        addCheck('G3', 'fail', 'merge commit is not reachable from main via any ancestor path');
      }
    } else {
      addCheck('G3', 'fail', 'merge commit is not reachable from main via any ancestor path');
    }

    const requiredChecks = await fetchRequiredChecks(prRef.owner, prRef.repo, githubToken);
    const requiredCheckResult = await evaluateRequiredChecksWithHeadFallback({
      mergeSha,
      headSha: pullRequest.head?.sha,
      requiredChecks,
      allowAdminMergeGateBypass: Boolean(
        pullRequest.merged &&
        mergeSha &&
        pullRequest.merge_commit_sha === mergeSha,
      ),
      fetchChecks: (sha) => fetchCommitChecks({
        owner: prRef.owner,
        repo: prRef.repo,
        sha,
        token: githubToken,
        requiredChecks,
      }),
    });
    const evidence = JSON.stringify(requiredCheckResult.evidence ?? []);
    if (requiredCheckResult.passed) {
      const externalReceipt = (requiredCheckResult.evidence ?? []).find(
        (receipt) => receipt.matched && receipt.passed && receipt.candidate_app_id !== null,
      );
      const verifiedSha = requiredCheckResult.checkedSha === 'merge'
        ? mergeSha
        : (pullRequest.head?.sha ?? null);
      if (externalReceipt && verifiedSha && /^[0-9a-f]{40}$/i.test(verifiedSha)) {
        verifierProvenance = {
          source: 'github-required-check',
          producer: `github-app:${externalReceipt.candidate_app_id}:${externalReceipt.candidate_name ?? externalReceipt.context}`,
          verified_sha: verifiedSha,
          details_url: externalReceipt.details_url,
        };
      }
      const detail = requiredCheckResult.checkedSha === 'head-admin-merge'
        ? `admin-merged PR accepted: non-governance required checks are green on PR head SHA; bypassed stuck checks: ${(requiredCheckResult.bypassed ?? []).join(', ')}; evidence=${evidence}`
        : requiredCheckResult.checkedSha === 'head'
          ? `required GitHub checks are green on PR head SHA; evidence=${evidence}`
          : `required GitHub checks are green on merge SHA; evidence=${evidence}`;
      addCheck(
        'G4',
        'pass',
        detail,
      );
    } else {
      addCheck(
        'G4',
        'fail',
        `required checks missing or failing on ${requiredCheckResult.checkedSha} SHA: ${requiredCheckResult.missing.join(', ')}; evidence=${evidence}`,
      );
    }

    if (tier === 'T1') {
      const labels = (pullRequest.labels ?? []).map((label: { name?: string }) => label.name?.toLowerCase());
      if (labels.includes('t1-approved')) {
        addCheck('L5', 'pass', 'PR carries t1-approved label');
      } else {
        addCheck('L5', 'fail', 'PR is missing t1-approved label');
      }
    } else {
      addCheck('L5', 'skip', 'L5 skipped for non-T1 tier');
    }

    const mergeCommit = mergeSha
      ? gitShowCommit(mergeSha)
      : null;
    mergeTimestamp = mergeCommit?.timestamp ?? null;
    const proofFiles = manifest.expected_proof_paths.map((proofPath) => path.join(ROOT, proofPath));

    const missingProofs = proofFiles.filter((proofPath) => !fs.existsSync(proofPath));
    if (missingProofs.length > 0) {
      addCheck('P1', 'fail', `missing proof files: ${missingProofs.map(relativeToRoot).join(', ')}`);
    } else {
      addCheck('P1', 'pass', 'all expected proof files exist');
    }

    const readableProofs = proofFiles.filter((proofPath) => {
      try {
        return fs.readFileSync(proofPath, 'utf8').trim().length > 0;
      } catch {
        return false;
      }
    });
    if (readableProofs.length !== proofFiles.length) {
      addCheck('P2', 'fail', 'one or more proof files are unreadable or empty');
    } else {
      addCheck('P2', 'pass', 'proof files are readable and non-empty');
    }

    if (mergeSha) {
      const staleShaProofs = proofFiles.filter((proofPath) => {
        try {
          const content = fs.readFileSync(proofPath, 'utf8');
          return !content.includes(mergeSha) && !new RegExp(`merge_sha:\\s*${mergeSha}`, 'i').test(content);
        } catch {
          return true;
        }
      });
      if (staleShaProofs.length > 0) {
        addCheck('P3', 'fail', `proof files missing merge SHA reference: ${staleShaProofs.map(relativeToRoot).join(', ')}`);
      } else {
        addCheck('P3', 'pass', 'proof files reference the merge SHA');
      }
    } else {
      addCheck('P3', 'fail', 'cannot evaluate proof SHA without manifest.commit_sha');
    }

    if (mergeTimestamp) {
      const staleMtimeProofs = proofFiles.filter((proofPath) => {
        try {
          return fs.statSync(proofPath).mtime.getTime() < new Date(mergeTimestamp).getTime();
        } catch {
          return true;
        }
      });
      if (staleMtimeProofs.length > 0) {
        addCheck('P4', 'fail', `proof files predate merge commit: ${staleMtimeProofs.map(relativeToRoot).join(', ')}`);
      } else {
        addCheck('P4', 'pass', 'proof files are newer than the merge commit');
      }
    } else {
      addCheck('P4', 'fail', 'cannot evaluate proof freshness without merge commit timestamp');
    }

    const closeoutGateChecks = evaluateCloseoutTruthGate({
      manifest,
      linear_state: stateName,
      pr_merged: pullRequest.merged,
      pr_merge_sha: pullRequest.merge_commit_sha,
      pr_head_sha: pullRequest.head?.sha,
      mergedPrAttestation,
      proof_artifacts: proofFiles.map((proofPath) => ({
        path: relativeToRoot(proofPath),
        content: safeRead(proofPath),
        mtime_ms: fs.existsSync(proofPath) ? fs.statSync(proofPath).mtime.getTime() : undefined,
      })),
      merge_timestamp_ms: mergeTimestamp ? Date.parse(mergeTimestamp) : null,
      runtime_proof_required: tier === 'T1' ||
        linearLabels.includes('runtime-truth') ||
        linearLabels.includes('kind:runtime'),
      transition_age_ms: 0,
    });
    for (const check of closeoutGateChecks) {
      addCheck(check.id, check.status === 'fail' ? 'fail' : 'pass', check.detail);
    }

    if (tier === 'T1') {
      let evidence: { path: string; bundle: EvidenceBundleV1 } | null = null;
      if (!fs.existsSync(EVIDENCE_BUNDLE_SCHEMA_PATH)) {
        addCheck('P5', 'fail', `missing evidence bundle schema at ${relativeToRoot(EVIDENCE_BUNDLE_SCHEMA_PATH)}`);
      } else {
        evidence = readFirstEvidenceBundle(proofFiles);
        if (!evidence) {
          addCheck('P5', 'fail', 'no expected proof path resolved to a readable evidence bundle');
        } else {
          addCheck('P5', 'pass', 'evidence bundle found');
          const evidenceContract = validateEvidenceBundleContract(evidence.bundle, {
            gate: 'post-merge-read',
            laneType: manifest.lane_type,
            tier,
            repoRoot: ROOT,
            mergedPrAttestation,
          });
          if (evidenceContract.valid) {
            addCheck(
              'P6',
              'pass',
              `evidence bundle satisfies shared schema-v${evidenceContract.schemaVersion} ${evidenceContract.profile} contract`,
            );
          } else {
            addCheck(
              'P6',
              'fail',
              `shared evidence contract failed: ${evidenceContract.failures.map((failure) => `${failure.field}: ${failure.message}`).join('; ')}`,
            );
          }

          const populatedStatic = hasPopulatedObject(evidence.bundle.static_proof);
          const populatedRuntime = hasPopulatedObject(evidence.bundle.runtime_proof);
          const profileSectionsPresent = evidenceContract.profile === 'static'
            ? populatedStatic
            : populatedStatic && populatedRuntime;
          if (profileSectionsPresent || evidenceContract.profile === 'legacy-v1' && populatedStatic && populatedRuntime) {
            addCheck('P7', 'pass', `evidence sections satisfy ${evidenceContract.profile} profile`);
          } else {
            addCheck('P7', 'fail', `evidence sections do not satisfy ${evidenceContract.profile ?? 'undeclared'} profile`);
          }

          const testRunLogStatus = evaluateTestRunLogEvidence(evidence.bundle.static_proof, mergeSha);
          if (testRunLogStatus === 'pass') {
            addCheck('P8', 'pass', 'static_proof references test run logs tied to merge SHA');
          } else if (testRunLogStatus === 'skip') {
            addCheck('P8', 'skip', 'static_proof.test_run_logs absent; P8 skipped for flexible proof format');
          } else {
            addCheck('P8', 'fail', 'static_proof must reference test run logs tied to merge SHA');
          }

          if (evidenceContract.schemaVersion === 2 && evidenceContract.valid) {
            addCheck('P9', 'pass', `${evidenceContract.profile} profile evidence is complete`);
          } else if (evidenceContract.schemaVersion === 1 && hasRuntimeReferences(evidence.bundle.runtime_proof)) {
            addCheck('P9', 'pass', 'legacy runtime_proof references live DB evidence');
          } else {
            addCheck('P9', 'fail', 'proof does not satisfy its declared runtime/migration/static evidence profile');
          }

          if (evidenceContract.schemaVersion === 1) {
            const verifierIdentity = evidence.bundle.verifier?.identity?.trim();
            if (verifierIdentity && verifierIdentity !== manifest.created_by) {
              addCheck('P10', 'pass', 'legacy verifier.identity is set and distinct from implementing lane identity');
            } else {
              addCheck('P10', 'fail', 'legacy verifier.identity must be set and not equal to manifest.created_by');
            }
          } else if (
            verifierProvenance &&
            shaMatches(verifierProvenance.verified_sha, evidence.bundle.sha_binding?.verified_source_sha)
          ) {
            addCheck(
              'P10',
              'pass',
              `external exact-head verifier provenance: ${verifierProvenance.producer} at ${verifierProvenance.verified_sha}`,
            );
          } else {
            addCheck(
              'P10',
              'fail',
              'schema-v2 proof requires an external GitHub required-check receipt bound to sha_binding.verified_source_sha',
            );
          }
        }
      }

      addUnsupportedRuntimeChecks(addCheck, options.noRuntime ?? false, tier, evidence, {
        laneType: manifest.lane_type,
        verifierProvenance,
        mergedPrAttestation,
        repoRoot: ROOT,
      });
    } else if (tier === 'T2') {
      const proofContents = proofFiles.map((proofPath) => safeRead(proofPath)).join('\n');
      for (const check of evaluateT2ProofEvidence({
        proofPaths: proofFiles.map(relativeToRoot),
        proofContents,
      })) {
        addCheck(check.id, check.status === 'fail' ? 'fail' : 'pass', check.detail);
      }
    }

    const scopeDiff = evaluateScopeDiff(
      manifest.files_changed,
      manifest.file_scope_lock,
      manifest.expected_proof_paths,
    );
    addCheck('S1', scopeDiff.status, scopeDiff.detail);

    const finalizedFilesForPostMergeTouchCheck = manifest.files_changed.filter(
      (filePath) =>
        filePath !== relativeToRoot(manifestPath) &&
        !filePath.startsWith('docs/06_status/proof/'),
    );

    if (mergeSha && finalizedFilesForPostMergeTouchCheck.length > 0) {
      const postMergeTouches = findPostMergeTouches({
        mergeSha,
        filesChanged: finalizedFilesForPostMergeTouchCheck,
        issueId,
        sinceSha: options.sinceSha,
        laneStartedAt: manifest.started_at,
        allowSameIssueCommits: manifest.status !== 'done',
      });
      if (postMergeTouches.length > 0) {
        addCheck(
          'G5',
          'fail',
          `commits touched locked files after merge without linked follow-up issue: ${postMergeTouches.join(', ')}`,
        );
      } else {
        addCheck('G5', 'pass', 'no post-merge touches without linked follow-up issue detected');
      }
    } else {
      addCheck('G5', 'pass', 'no finalized implementation files_changed entries to inspect');
    }

    const linearProjectIsP0 = linearIssue.project?.id === P0_PROJECT_ID;
    const manifestP0 = manifest.p0_protocol;
    const manifestSaysP0 = manifestP0?.required === true;

    if (!linearProjectIsP0 && !manifestSaysP0) {
      addCheck('H1', 'skip', 'lane is not P0 — protocol checks not applicable');
      addCheck('H2', 'skip', 'lane is not P0 — protocol checks not applicable');
      addCheck('H3', 'skip', 'lane is not P0 — protocol checks not applicable');
      addCheck('H4', 'skip', 'lane is not P0 — protocol checks not applicable');
      addCheck('H5', 'skip', 'lane is not P0 — protocol checks not applicable');
    } else {
      if (linearProjectIsP0 && !manifestSaysP0) {
        addCheck(
          'H1',
          'fail',
          `Linear places ${issueId} in P0 project but manifest.p0_protocol.required is not true`,
        );
      } else if (!linearProjectIsP0 && manifestSaysP0) {
        addCheck(
          'H1',
          'fail',
          `manifest declares P0 but Linear project (${linearIssue.project?.name ?? 'none'}) is not the P0 project`,
        );
      } else {
        addCheck('H1', 'pass', 'P0 detection is consistent between Linear and manifest');
      }

      const critique = manifestP0?.claude_critique;
      if (!critique?.recorded || !critique.artifact_path) {
        addCheck('H2', 'fail', 'p0_protocol.claude_critique not recorded or missing artifact_path');
      } else {
        const critiquePath = path.join(ROOT, critique.artifact_path);
        if (!fs.existsSync(critiquePath)) {
          addCheck('H2', 'fail', `claude-critique artifact missing: ${critique.artifact_path}`);
        } else {
          const body = safeRead(critiquePath).trim();
          if (body.length === 0) {
            addCheck('H2', 'fail', `claude-critique artifact is empty: ${critique.artifact_path}`);
          } else if (mergeSha && !body.includes(mergeSha)) {
            addCheck('H2', 'fail', `claude-critique artifact missing merge SHA reference: ${critique.artifact_path}`);
          } else {
            addCheck('H2', 'pass', `claude-critique recorded at ${critique.artifact_path}`);
          }
        }
      }

      const verification = manifestP0?.runtime_verification;
      if (!verification?.recorded || !verification.artifact_path) {
        addCheck('H3', 'fail', 'p0_protocol.runtime_verification not recorded or missing artifact_path');
      } else {
        const verifyPath = path.join(ROOT, verification.artifact_path);
        if (!fs.existsSync(verifyPath)) {
          addCheck('H3', 'fail', `runtime-verification artifact missing: ${verification.artifact_path}`);
        } else {
          const body = safeRead(verifyPath);
          if (body.trim().length === 0) {
            addCheck('H3', 'fail', `runtime-verification artifact is empty: ${verification.artifact_path}`);
          } else if (RUNTIME_VERIFY_FAIL_PATTERN.test(body)) {
            addCheck('H3', 'fail', `runtime-verification contains a FAIL/SKIP item: ${verification.artifact_path}`);
          } else {
            const resultLine = body.match(RUNTIME_VERIFY_RESULT_PATTERN);
            if (!resultLine || resultLine[1].toLowerCase() !== 'pass') {
              addCheck(
                'H3',
                'fail',
                `runtime-verification missing 'result: pass' line: ${verification.artifact_path}`,
              );
            } else if (verification.result !== 'pass') {
              addCheck('H3', 'fail', 'p0_protocol.runtime_verification.result is not "pass"');
            } else {
              addCheck('H3', 'pass', `runtime-verification recorded with result: pass at ${verification.artifact_path}`);
            }
          }
        }
      }

      if (prUrl && githubToken) {
        try {
          const prRefForH4 = parsePullRequestUrl(prUrl);
          const comments = await fetchGitHubPullRequestComments(
            prRefForH4.owner,
            prRefForH4.repo,
            prRefForH4.number,
            githubToken,
          );
          const latest = findLatestPmVerdict(comments, issueId);
          if (!latest) {
            addCheck(
              'H4',
              'fail',
              'no pm-verdict/v1 APPROVED comment from a CODEOWNERS member found on the PR',
            );
          } else if (latest.verdict !== 'APPROVED') {
            addCheck('H4', 'fail', `latest PM verdict is ${latest.verdict}, not APPROVED`);
          } else {
            addCheck(
              'H4',
              'pass',
              `PM verdict APPROVED recorded by ${latest.comment.user?.login ?? 'unknown'}`,
            );
          }
        } catch (error) {
          addCheck(
            'H4',
            'fail',
            `failed to verify PM approval: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } else if (!prUrl) {
        addCheck('H4', 'fail', 'cannot verify PM approval without pr_url');
      } else {
        addCheck('H4', 'fail', 'cannot verify PM approval without GITHUB_TOKEN');
      }

      const mergeType = manifestP0?.merge_type;
      if (mergeType === 'auto') {
        addCheck('H5', 'fail', 'p0_protocol.merge_type is "auto" — P0 lanes must be merged manually');
      } else if (mergeType === 'manual') {
        addCheck('H5', 'pass', 'p0_protocol.merge_type is manual');
      } else {
        addCheck('H5', 'fail', 'p0_protocol.merge_type is not set');
      }
    }

    const exitCode = determineExitCode(checks, manifest.status);
    const verdict = determineVerdict(exitCode);
    return finalizeWithManifest({
      manifest,
      dryRun,
      issueId,
      tier,
      checkedAt,
      checks,
      failures,
      reopenReasons,
      mergeSha,
      prUrl,
      verdict,
      exitCode,
      runner: options.runner ?? 'manual',
    });
  } catch (error) {
    addCheck('INFRA', 'fail', error instanceof Error ? error.message : String(error));
    return finalizeWithManifest({
      manifest,
      dryRun,
      issueId,
      tier,
      checkedAt,
      checks,
      failures,
      reopenReasons,
      mergeSha,
      prUrl,
      verdict: 'infra_error',
      exitCode: 3,
      runner: options.runner ?? 'manual',
    });
  }
}

export function addUnsupportedRuntimeChecks(
  addCheck: (id: string, status: 'pass' | 'fail' | 'skip', detail: string) => void,
  noRuntime: boolean,
  tier: LaneTier,
  evidence: { bundle: EvidenceBundleV1 } | null,
  context: {
    laneType?: string | null;
    verifierProvenance?: ExternalVerifierProvenance | null;
    mergedPrAttestation?: MergedPrAttestation | null;
    repoRoot?: string | null;
  } = {},
): void {
  if (tier !== 'T1') {
    addCheck('R1', 'skip', 'runtime checks skipped for non-T1 tier');
    addCheck('R2', 'skip', 'runtime checks skipped for non-T1 tier');
    addCheck('R3', 'skip', 'runtime checks skipped for non-T1 tier');
    return;
  }

  if (noRuntime) {
    addCheck('R1', 'fail', '--no-runtime is rejected for T1');
    addCheck('R2', 'fail', '--no-runtime is rejected for T1');
    addCheck('R3', 'fail', '--no-runtime is rejected for T1');
    return;
  }

  if (!evidence) {
    addCheck('R1', 'fail', 'evidence bundle required for R1 proof-profile check');
    addCheck('R2', 'fail', 'evidence bundle required for R2 proof-profile check');
    addCheck('R3', 'fail', 'evidence bundle required for R3 verifier-provenance check');
    return;
  }

  const contract = validateEvidenceBundleContract(evidence.bundle, {
    gate: 'post-merge-read',
    laneType: context.laneType,
    tier,
    repoRoot: context.repoRoot,
    mergedPrAttestation: context.mergedPrAttestation,
  });

  if (contract.schemaVersion === 2) {
    if (!contract.valid) {
      const detail = contract.failures.map((failure) => `${failure.field}: ${failure.message}`).join('; ');
      addCheck('R1', 'fail', `declared proof profile failed: ${detail}`);
      addCheck('R2', 'fail', `declared proof profile failed: ${detail}`);
    } else if (contract.profile === 'app-runtime') {
      const runtimeProof = evidence.bundle.runtime_proof;
      const queryCount = Array.isArray(runtimeProof?.queries) ? runtimeProof.queries.length : 0;
      const rowCount = Array.isArray(runtimeProof?.row_counts) ? runtimeProof.row_counts.length : 0;
      addCheck('R1', 'pass', `app-runtime profile has ${queryCount} runtime quer${queryCount === 1 ? 'y' : 'ies'}`);
      addCheck('R2', 'pass', `app-runtime profile has ${rowCount} monitored-table row count entr${rowCount === 1 ? 'y' : 'ies'}`);
    } else if (contract.profile === 'migration') {
      addCheck('R1', 'pass', 'migration profile has exact-head refusal and empty-scratch execution receipts');
      addCheck('R2', 'pass', 'migration profile has rollback/reapply, schema-parity, and staging DB receipts');
    } else if (contract.profile === 'static') {
      addCheck('R1', 'pass', 'static profile explicitly does not require runtime queries');
      addCheck('R2', 'pass', 'static profile explicitly does not require monitored-table row counts');
    } else {
      addCheck('R1', 'fail', 'schema-v2 proof profile is unknown or undeclared');
      addCheck('R2', 'fail', 'schema-v2 proof profile is unknown or undeclared');
    }

    if (
      context.verifierProvenance &&
      shaMatches(context.verifierProvenance.verified_sha, evidence.bundle.sha_binding?.verified_source_sha)
    ) {
      addCheck(
        'R3',
        'pass',
        `external exact-head verifier receipt ${context.verifierProvenance.producer} at ${context.verifierProvenance.verified_sha}`,
      );
    } else {
      addCheck(
        'R3',
        'fail',
        'schema-v2 T1 proof requires external exact-head CI verifier provenance bound to sha_binding.verified_source_sha',
      );
    }
    return;
  }

  if (contract.schemaVersion !== 1) {
    const detail = contract.failures.map((failure) => `${failure.field}: ${failure.message}`).join('; ');
    addCheck('R1', 'fail', `unsupported evidence contract: ${detail}`);
    addCheck('R2', 'fail', `unsupported evidence contract: ${detail}`);
    addCheck('R3', 'fail', `unsupported evidence contract: ${detail}`);
    return;
  }

  // Schema v1 remains supported under its historical runtime contract. New v2
  // bundles cannot use this path and cannot self-author verifier identity.
  const rp = evidence.bundle.runtime_proof;
  const queries = Array.isArray(rp?.queries) ? rp.queries : [];
  if (queries.length > 0) {
    addCheck('R1', 'pass', `runtime_proof.queries has ${queries.length} entr${queries.length === 1 ? 'y' : 'ies'}`);
  } else {
    addCheck('R1', 'fail', 'runtime_proof.queries must be non-empty: run pnpm test:db and include live query evidence');
  }

  const rowCounts = Array.isArray(rp?.row_counts) ? rp.row_counts : [];
  if (rowCounts.length > 0) {
    addCheck('R2', 'pass', `runtime_proof.row_counts has ${rowCounts.length} entr${rowCounts.length === 1 ? 'y' : 'ies'}`);
  } else {
    addCheck('R2', 'fail', 'runtime_proof.row_counts must be non-empty: include monitored-table row counts from pnpm test:db');
  }

  const verifierIdentity = evidence.bundle.verifier?.identity?.trim();
  if (verifierIdentity) {
    addCheck('R3', 'pass', `verifier.identity confirmed: ${verifierIdentity}`);
  } else {
    addCheck('R3', 'fail', 'evidence bundle verifier.identity must be set for T1 phase-boundary-guard');
  }
}

function determineExitCode(
  checks: CheckResult[],
  manifestStatus: LaneManifest['status'],
): 0 | 1 | 2 | 3 | 4 {
  if (checks.some((check) => check.id === 'M4' && check.status === 'fail')) {
    return 2;
  }
  if (checks.some((check) => check.id === 'G5' && check.status === 'fail' && manifestStatus === 'done')) {
    return 4;
  }
  if (
    checks.some(
      (check) =>
        check.status === 'fail' &&
        (
          check.id === 'M1' ||
          check.id === 'M2' ||
          check.id === 'M3' ||
          check.id === 'L1' ||
          /is required|missing required schema/i.test(check.detail)
        ),
    )
  ) {
    return 3;
  }

  if (checks.some((check) => check.id === 'G5' && check.status === 'fail')) {
    return 4;
  }
  if (checks.some((check) => check.status === 'fail')) {
    return 1;
  }

  return 0;
}

function determineVerdict(exitCode: 0 | 1 | 2 | 3 | 4): Verdict {
  switch (exitCode) {
    case 0:
      return 'pass';
    case 1:
      return 'fail';
    case 2:
      return 'ineligible';
    case 3:
      return 'infra_error';
    case 4:
      return 'reopen';
  }
}

function finalizeResult(input: {
  issueId: string;
  tier: LaneTier;
  verdict: Verdict;
  exitCode: 0 | 1 | 2 | 3 | 4;
  mergeSha: string | null;
  prUrl: string | null;
  checkedAt: string;
  checks: CheckResult[];
  failures: Set<string>;
  reopenReasons: Set<string>;
}): TruthCheckResult {
  return {
    schema_version: 1,
    issue_id: input.issueId,
    tier: input.tier,
    verdict: input.verdict,
    exit_code: input.exitCode,
    merge_sha: input.mergeSha,
    pr_url: input.prUrl,
    checked_at: input.checkedAt,
    checks: input.checks,
    failures: [...input.failures],
    reopen_reasons: [...input.reopenReasons],
    manifest_path: relativeToRoot(path.join(MANIFEST_DIR, `${input.issueId}.json`)),
  };
}

/**
 * UTV2-1691 — exported so the dry-run guarantee can be asserted directly.
 *
 * `writeManifestFn` is injectable for the same reason: a test can prove the
 * persistence step was never *invoked* under `dryRun`, which is a stronger
 * statement than comparing a file before and after (a no-op write would pass a
 * checksum comparison; a never-called writer cannot).
 */
export function finalizeWithManifest(input: {
  manifest: LaneManifest | null;
  issueId: string;
  tier: LaneTier;
  checkedAt: string;
  checks: CheckResult[];
  failures: Set<string>;
  reopenReasons: Set<string>;
  mergeSha: string | null;
  prUrl: string | null;
  verdict: Verdict;
  exitCode: 0 | 1 | 2 | 3 | 4;
  runner: TruthCheckHistoryEntry['runner'];
  /** UTV2-1691: when true, evaluate and return identically but persist nothing. */
  dryRun?: boolean;
  /** UTV2-1691: injectable persistence, for asserting it is never called on a dry run. */
  writeManifestFn?: (manifest: LaneManifest) => void;
}): TruthCheckResult {
  const result = finalizeResult({
    issueId: input.issueId,
    tier: input.tier,
    verdict: input.verdict,
    exitCode: input.exitCode,
    mergeSha: input.mergeSha,
    prUrl: input.prUrl,
    checkedAt: input.checkedAt,
    checks: input.checks,
    failures: input.failures,
    reopenReasons: input.reopenReasons,
  });

  // UTV2-1691 (review finding P2-1): stamp the machine-readable markers BEFORE
  // any return path. `--json` is the automation interface, so a dry run must be
  // distinguishable there and not only in the human-readable output. Without
  // this, a passing dry run is byte-identical to a certifying live run -- same
  // verdict, same exit code 0 -- and downstream tooling can record it as a real
  // gate pass. Stamped here rather than at the CLI so library callers get it too.
  result.dry_run = input.dryRun === true;
  result.certifies = input.dryRun !== true;

  if (!input.manifest || input.exitCode === 2 || input.exitCode === 3) {
    return result;
  }

  // UTV2-1224: Done lanes are immutable except for explicit reopen events (exitCode 4).
  // Heartbeat-triggered re-runs after lane close must not append stale history entries
  // or advance heartbeat_at — those runs reflect post-close environment state, not the
  // verified implementation.
  if (input.manifest.status === 'done' && input.exitCode !== 4) {
    return result;
  }

  const historyEntry: TruthCheckHistoryEntry = {
    checked_at: input.checkedAt,
    verdict: input.verdict === 'pass' ? 'pass' : input.verdict === 'reopen' ? 'reopen' : 'fail',
    merge_sha: input.mergeSha,
    failures: [...input.failures],
    runner: input.runner,
  };

  const updated: LaneManifest = {
    ...input.manifest,
    heartbeat_at: input.checkedAt,
    truth_check_history: [...input.manifest.truth_check_history, historyEntry],
  };

  if (input.exitCode === 4) {
    updated.status = 'reopened';
    updated.closed_at = null;
    updated.reopen_history = [
      ...input.manifest.reopen_history,
      {
        timestamp: input.checkedAt,
        reasons: [...input.reopenReasons],
        detected_by: input.runner,
      },
    ];
  }

  // UTV2-1691 — the ONLY persistence in the entire evaluation path.
  //
  // An exhaustive write audit of runTruthCheck confirmed this is the sole
  // mutation of any kind: no other filesystem write exists in this module, the
  // single Linear call is a GraphQL *query* (POST is transport, not a mutation),
  // all five GitHub endpoints are GET, there is no spawnSync/execSync anywhere,
  // and the one `git()` use is `git show -s`. Gating this line is therefore
  // sufficient for a dry run to write nothing, mutate no Linear state, and
  // mutate no GitHub state.
  //
  // Note what is NOT gated: `updated` above and `result` from finalizeResult are
  // built identically in both modes, so the returned verdict, checks, failures
  // and exit code cannot diverge between dry and live. That equivalence is
  // asserted mechanically in truth-check-lib.test.ts, not assumed here.
  if (!input.dryRun) {
    (input.writeManifestFn ?? writeManifest)(updated);
  }
  return result;
}

async function fetchLinearIssue(issueId: string, token: string): Promise<LinearIssueRecord> {
  const payload = await fetchJson<{
    data?: { issue: LinearIssueRecord | null };
    errors?: Array<{ message?: string }>;
  }>('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `
        query IssueForTruthCheck($id: String!) {
          issue(id: $id) {
            id
            identifier
            title
            state { name type }
            labels(first: 20) { nodes { name } }
            attachments(first: 20) { nodes { title url } }
            project { id name }
          }
        }
      `,
      variables: { id: issueId },
    }),
  });

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((entry) => entry.message ?? 'Unknown Linear error').join('; '));
  }
  if (!payload.data?.issue) {
    throw new Error(`Linear issue not found: ${issueId}`);
  }

  return payload.data.issue;
}

export function parsePullRequestUrl(prUrl: string): { owner: string; repo: string; number: number } {
  const url = new URL(prUrl);
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)$/);
  if (!match) {
    throw new Error(`Unsupported PR URL: ${prUrl}`);
  }

  return {
    owner: match[1],
    repo: match[2],
    number: Number.parseInt(match[3], 10),
  };
}

export async function fetchGitHubPullRequest(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<{
  merged: boolean;
  merge_commit_sha: string | null;
  head?: { sha?: string | null } | null;
  labels: Array<{ name?: string }>;
  user?: { login?: string; type?: string } | null;
  auto_merge?: { merge_method?: string } | null;
}> {
  return fetchJson(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, {
    headers: githubHeaders(token),
  });
}

interface GitHubIssueComment {
  body?: string;
  user?: { login?: string; type?: string } | null;
  html_url?: string;
  created_at?: string;
}

export async function fetchGitHubPullRequestComments(
  owner: string,
  repo: string,
  number: number,
  token: string,
  fetchPage: JsonPageFetcher = fetchJson,
): Promise<GitHubIssueComment[]> {
  // UTV2-1592 amendment: a PR/issue with more than 100 comments used to
  // silently drop everything past page 1 -- including, potentially, the
  // latest pm-verdict/v1 comment. Paginate the same way fetchCommitChecks
  // already does for statuses/check-runs (fetchAllPages below), rather than
  // reimplementing pagination a third time.
  return fetchAllPages<GitHubIssueComment[]>(
    (page) =>
      `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments?per_page=100&page=${page}`,
    (payload) => payload,
    fetchPage,
    { headers: githubHeaders(token) },
  ) as Promise<GitHubIssueComment[]>;
}

const PM_VERDICT_CODEOWNERS = new Set(['griff843']);

interface PmVerdictMatch {
  verdict: 'APPROVED' | 'CHANGES_REQUIRED';
  issueId: string;
  comment: GitHubIssueComment;
}

function findLatestPmVerdict(
  comments: GitHubIssueComment[],
  issueId: string,
): PmVerdictMatch | null {
  const matches: PmVerdictMatch[] = [];
  for (const comment of comments) {
    const body = comment.body?.replace(/\\n/g, '\n');
    if (!body) continue;
    const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 3) continue;
    const verdict = lines[0].replace(/^\$/, '').match(
      /^PM_VERDICT:\s+(APPROVED|CHANGES_REQUIRED)$/i,
    );
    if (!verdict) continue;
    if (lines[1] !== 'schema: pm-verdict/v1') continue;
    const issueMatch = lines[2].match(/^Issue:\s+((?:UTV2|UNI)-\d+)$/i);
    if (!issueMatch) continue;
    if (issueMatch[1].toUpperCase() !== issueId.toUpperCase()) continue;
    if (comment.user?.type === 'Bot') continue;
    if (!comment.user?.login || !PM_VERDICT_CODEOWNERS.has(comment.user.login)) continue;
    matches.push({
      verdict: verdict[1].toUpperCase() as 'APPROVED' | 'CHANGES_REQUIRED',
      issueId: issueMatch[1].toUpperCase(),
      comment,
    });
  }
  if (matches.length === 0) return null;
  return matches[matches.length - 1];
}

const RUNTIME_VERIFY_FAIL_PATTERN = /^\s*-\s*\[[ xX]\]\s+.*:\s*(FAIL|SKIP|SKIPPED)\s*$/m;
const RUNTIME_VERIFY_RESULT_PATTERN = /^result:\s*(pass|fail)\s*$/im;
const BRANCH_PROTECTION_SCRIPT_PATH = path.join(ROOT, 'scripts', 'ops', 'apply-branch-protection.sh');

export function parseRequiredChecksFromBranchProtectionScript(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/contexts\[\]=([^'"\r\n]+)/g)]
        .map((match) => match[1]?.trim())
        .filter((entry): entry is string => Boolean(entry)),
    ),
  ];
}

function readRequiredChecksFallback(): string[] {
  if (!fs.existsSync(BRANCH_PROTECTION_SCRIPT_PATH)) {
    return [];
  }

  return parseRequiredChecksFromBranchProtectionScript(
    fs.readFileSync(BRANCH_PROTECTION_SCRIPT_PATH, 'utf8'),
  );
}

function isBranchProtectionReadBlocked(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(403 Forbidden|404 Not Found)\b/.test(message);
}

export function normalizeRequiredChecks(input: {
  contexts?: string[];
  checks?: Array<{ context?: string; app_id?: number | null }>;
}): RequiredCheckIdentity[] {
  const normalized: RequiredCheckIdentity[] = [];
  const seen = new Set<string>();
  const checks = input.checks ?? [];

  for (const check of checks) {
    const context = check.context?.trim();
    if (!context) continue;
    const appId = check.app_id === -1 ? null : check.app_id ?? null;
    const key = `${context}\0${appId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ context, app_id: appId });
  }

  const checkContexts = new Set(normalized.map((check) => check.context));
  for (const rawContext of input.contexts ?? []) {
    const context = rawContext.trim();
    if (!context || checkContexts.has(context)) continue;
    const key = `${context}\0`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ context, app_id: null });
  }

  return normalized;
}

export async function fetchRequiredChecks(
  owner: string,
  repo: string,
  token: string,
): Promise<RequiredCheckIdentity[]> {
  let response: {
    contexts?: string[];
    checks?: Array<{ context?: string; app_id?: number | null }>;
  };
  try {
    response = await fetchJson<{
      contexts?: string[];
      checks?: Array<{ context?: string; app_id?: number | null }>;
    }>(`https://api.github.com/repos/${owner}/${repo}/branches/main/protection/required_status_checks`, {
      headers: githubHeaders(token),
    });
  } catch (error) {
    if (!isBranchProtectionReadBlocked(error)) {
      throw error;
    }

    const fallbackChecks = readRequiredChecksFallback();
    if (fallbackChecks.length === 0) {
      throw error;
    }
    return fallbackChecks.map((context) => ({ context, app_id: null }));
  }

  return normalizeRequiredChecks(response);
}

type JsonPageFetcher = <T>(url: string, init: RequestInit) => Promise<T>;
type RequiredCheckInput = string | RequiredCheckIdentity;

function normalizeRequiredCheckInput(check: RequiredCheckInput): RequiredCheckIdentity {
  return typeof check === 'string'
    ? { context: check, app_id: null }
    : check;
}

function parseCandidateTime(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function evaluateRequiredCheckResults(input: {
  requiredChecks: RequiredCheckInput[];
  statuses: GitHubCommitStatus[];
  checkRuns: GitHubCheckRun[];
}): CommitCheckResult {
  const evidence = input.requiredChecks.map((rawCheck): RequiredCheckEvidence => {
    const required = normalizeRequiredCheckInput(rawCheck);
    const candidates: Array<RequiredCheckEvidence & { sort_time: number }> = [];

    if (required.app_id === null) {
      for (const status of input.statuses) {
        if (status.context !== required.context) continue;
        const timestamp = status.updated_at ?? status.created_at ?? null;
        candidates.push({
          context: required.context,
          required_app_id: null,
          matched: true,
          source: 'status',
          candidate_id: status.id ?? null,
          candidate_name: status.context ?? null,
          candidate_app_id: null,
          state: status.state ?? null,
          conclusion: null,
          timestamp,
          passed: status.state === 'success',
          details_url: status.target_url ?? null,
          selection_reason: 'latest result with exact required context identity',
          sort_time: parseCandidateTime(timestamp),
        });
      }
    }

    for (const checkRun of input.checkRuns) {
      if (checkRun.name !== required.context) continue;
      const appId = checkRun.app?.id ?? null;
      if (required.app_id !== null && appId !== required.app_id) continue;
      const timestamp = checkRun.completed_at ?? checkRun.started_at ?? checkRun.created_at ?? null;
      candidates.push({
        context: required.context,
        required_app_id: required.app_id,
        matched: true,
        source: 'check_run',
        candidate_id: checkRun.id ?? null,
        candidate_name: checkRun.name ?? null,
        candidate_app_id: appId,
        state: checkRun.status ?? null,
        conclusion: checkRun.conclusion ?? null,
        timestamp,
        passed: checkRun.status === 'completed' && checkRun.conclusion === 'success',
        details_url: checkRun.details_url ?? null,
        selection_reason: required.app_id === null
          ? 'latest result with exact required context identity'
          : 'latest result with exact required context and app identity',
        sort_time: parseCandidateTime(timestamp),
      });
    }

    candidates.sort((a, b) =>
      b.sort_time - a.sort_time ||
      (b.candidate_id ?? 0) - (a.candidate_id ?? 0) ||
      (b.source === 'check_run' ? 1 : 0) - (a.source === 'check_run' ? 1 : 0),
    );
    const selected = candidates[0];
    if (!selected) {
      return {
        context: required.context,
        required_app_id: required.app_id,
        matched: false,
        source: null,
        candidate_id: null,
        candidate_name: null,
        candidate_app_id: null,
        state: null,
        conclusion: null,
        timestamp: null,
        passed: false,
        details_url: null,
        selection_reason: required.app_id === null
          ? 'no result matched the exact required context identity'
          : 'no result matched the exact required context and app identity',
      };
    }

    const { sort_time: _sortTime, ...result } = selected;
    return result;
  });

  const missing = [...new Set(evidence.filter((entry) => !entry.passed).map((entry) => entry.context))];
  return {
    passed: missing.length === 0,
    missing,
    evidence,
  };
}

async function fetchAllPages<T>(
  buildUrl: (page: number) => string,
  readItems: (payload: T) => unknown[],
  fetchPage: JsonPageFetcher,
  init: RequestInit,
): Promise<unknown[]> {
  const items: unknown[] = [];
  for (let page = 1; ; page += 1) {
    const payload = await fetchPage<T>(buildUrl(page), init);
    const pageItems = readItems(payload);
    items.push(...pageItems);
    if (pageItems.length < 100) break;
  }
  return items;
}

export async function fetchCommitChecks(input: {
  owner: string;
  repo: string;
  sha: string;
  token: string;
  requiredChecks: RequiredCheckInput[];
  fetchPage?: JsonPageFetcher;
}): Promise<CommitCheckResult> {
  if (input.requiredChecks.length === 0) {
    return { passed: true, missing: [], evidence: [] };
  }

  const fetchPage = input.fetchPage ?? fetchJson;
  const [statuses, checkRuns] = await Promise.all([
    fetchAllPages<GitHubCommitStatus[]>(
      (page) =>
        `https://api.github.com/repos/${input.owner}/${input.repo}/commits/${input.sha}/statuses?per_page=100&page=${page}`,
      (payload) => payload,
      fetchPage,
      { headers: githubHeaders(input.token) },
    ),
    fetchAllPages<{ check_runs?: GitHubCheckRun[] }>(
      (page) =>
        `https://api.github.com/repos/${input.owner}/${input.repo}/commits/${input.sha}/check-runs?filter=all&per_page=100&page=${page}`,
      (payload) => payload.check_runs ?? [],
      fetchPage,
      {
        headers: {
          ...githubHeaders(input.token),
          Accept: 'application/vnd.github+json',
        },
      },
    ),
  ]);

  return evaluateRequiredCheckResults({
    requiredChecks: input.requiredChecks,
    statuses: statuses as GitHubCommitStatus[],
    checkRuns: checkRuns as GitHubCheckRun[],
  });
}

export interface G3ReachabilityResult {
  /** SHA is reachable from main HEAD via any ancestor path (first or secondary parent). */
  reachable: boolean;
  /** SHA is on the first-parent chain specifically (fast-forward / squash-merge-to-main). */
  firstParent: boolean;
}

/**
 * Check whether `sha` is reachable from main HEAD.
 *
 * Option A implementation: uses `git merge-base --is-ancestor` for full-ancestry
 * reachability (first-parent OR secondary-parent), then separately checks
 * first-parent-only to surface a warning when the SHA landed via a --no-ff merge
 * commit (e.g. UTV2-1087 squash-merge anomaly, issue UTV2-1160).
 *
 * G3 passes for both cases; only a genuinely absent SHA causes G3 to fail.
 */
export function checkCommitReachableFromMain(
  sha: string,
  gitCommand: typeof git = git,
): G3ReachabilityResult {
  // Full-ancestry check: exit code 0 = ancestor, non-zero = not ancestor
  const ancestorResult = gitCommand(['merge-base', '--is-ancestor', sha, 'main']);
  const reachable = ancestorResult.ok;

  if (!reachable) {
    return { reachable: false, firstParent: false };
  }

  // First-parent check: is it on the linear history?
  const firstParentList = parseGitWithCommand(['rev-list', '--first-parent', 'main'], gitCommand);
  const firstParent = firstParentList.includes(sha);

  return { reachable: true, firstParent };
}

function parseGitWithCommand(args: string[], gitCommand: typeof git): string[] {
  const { stdout, ok } = gitCommand(args);
  if (!ok) {
    return [];
  }

  return stdout.split(/\r?\n/).filter(Boolean);
}

function gitShowCommit(sha: string): { timestamp: string; subject: string } | null {
  const result = git(['show', '-s', '--format=%cI%n%s', sha]);
  if (!result.ok || !result.stdout) {
    return null;
  }
  const [timestamp, ...subject] = result.stdout.split(/\r?\n/);
  return {
    timestamp,
    subject: subject.join(' '),
  };
}

function safeRead(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

export async function evaluateRequiredChecksWithHeadFallback(input: {
  mergeSha: string | null;
  headSha?: string | null;
  requiredChecks: RequiredCheckInput[];
  allowAdminMergeGateBypass?: boolean;
  fetchChecks: (sha: string) => Promise<CommitCheckResult>;
}): Promise<CommitCheckResult & { checkedSha: 'merge' | 'head' | 'head-admin-merge' | 'none' }> {
  const mergeChecks = input.mergeSha
    ? await input.fetchChecks(input.mergeSha)
    : {
        passed: false,
        missing: input.requiredChecks.map((check) => normalizeRequiredCheckInput(check).context),
        evidence: [],
      };
  if (mergeChecks.passed) {
    return { ...mergeChecks, checkedSha: 'merge' };
  }

  const headSha = input.headSha?.trim();
  if (headSha && headSha !== input.mergeSha) {
    const headChecks = await input.fetchChecks(headSha);
    if (headChecks.passed) {
      return { ...headChecks, checkedSha: 'head' };
    }
    if (input.allowAdminMergeGateBypass && isAdminMergeGateOnlyFailure(headChecks.missing)) {
      return {
        passed: true,
        missing: [],
        bypassed: headChecks.missing,
        evidence: headChecks.evidence,
        checkedSha: 'head-admin-merge',
      };
    }
    return { ...headChecks, checkedSha: 'head' };
  }

  return { ...mergeChecks, checkedSha: input.mergeSha ? 'merge' : 'none' };
}

function isAdminMergeGateOnlyFailure(missing: string[]): boolean {
  return missing.length > 0 &&
    missing.every((check) => /^merge gate(?: ci)?$/i.test(check.trim()));
}

export function evaluateTestRunLogEvidence(
  staticProof: EvidenceBundleV1['static_proof'],
  mergeSha: string | null,
): 'pass' | 'fail' | 'skip' {
  const testRunLogs = staticProof?.test_run_logs;
  if (!Array.isArray(testRunLogs) || testRunLogs.length === 0) {
    return 'skip';
  }

  return mergeSha && testRunLogs.some((entry) => entry.merge_sha === mergeSha)
    ? 'pass'
    : 'fail';
}

function readFirstEvidenceBundle(
  proofFiles: string[],
): { path: string; bundle: EvidenceBundleV1 } | null {
  for (const proofPath of proofFiles) {
    try {
      const parsed = parseJsonFile<EvidenceBundleV1>(proofPath);
      if (parsed && typeof parsed === 'object') {
        return { path: proofPath, bundle: parsed };
      }
    } catch {
      continue;
    }
  }

  return null;
}

function tryParseEvidenceBundle(content: string): EvidenceBundleV1 | null {
  try {
    const parsed = JSON.parse(content) as EvidenceBundleV1;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function hasPopulatedObject(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && Object.keys(value as Record<string, unknown>).length > 0);
}

export function hasRuntimeReferences(runtimeProof: EvidenceBundleV1['runtime_proof']): boolean {
  if (!runtimeProof) {
    return false;
  }

  return (
    Array.isArray(runtimeProof.queries) && runtimeProof.queries.length > 0 ||
    Array.isArray(runtimeProof.receipts) && runtimeProof.receipts.length > 0 ||
    Array.isArray(runtimeProof.row_counts) && runtimeProof.row_counts.length > 0 ||
    Object.values(runtimeProof).some(
      (value) =>
        (typeof value === 'string' && value.trim().length > 0) ||
        (typeof value === 'number' && value !== 0),
    )
  );
}

/**
 * Check IDs that only ever fail together as the specific "T1 lane merged without
 * live runtime evidence" shape (UTV2-1537, see
 * docs/06_status/INCIDENTS/INC-2026-07-14-utv2-1533-direct-main-push.md). Used to
 * give the post-merge-lane-close failure comment a precise, actionable remediation
 * message instead of a generic "push a new commit" hint -- the exact gap whose
 * ambiguity contributed to that incident's direct-main bypass.
 */
const RUNTIME_PROOF_GAP_CHECK_IDS = new Set(['C6', 'P7', 'P9', 'P10', 'R1', 'R2', 'R3']);

export interface RuntimeProofGapClassification {
  /** True only when every failing check belongs to the runtime-proof-gap set above. */
  isRuntimeProofGap: boolean;
  missingRuntimeProofCheckIds: string[];
  otherFailingCheckIds: string[];
  remediation: string;
}

export function classifyRuntimeProofGap(checks: CheckResult[]): RuntimeProofGapClassification {
  const failing = checks.filter((check) => check.status === 'fail');
  const runtimeFailing = failing.filter((check) => RUNTIME_PROOF_GAP_CHECK_IDS.has(check.id));
  const otherFailing = failing.filter((check) => !RUNTIME_PROOF_GAP_CHECK_IDS.has(check.id));
  const isRuntimeProofGap = runtimeFailing.length > 0 && otherFailing.length === 0;

  return {
    isRuntimeProofGap,
    missingRuntimeProofCheckIds: runtimeFailing.map((check) => check.id),
    otherFailingCheckIds: otherFailing.map((check) => check.id),
    remediation: isRuntimeProofGap
      ? 'Runtime proof is missing for a T1 lane. Do NOT hand-edit proof files on main directly ' +
        '(see docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md). Run `pnpm ops:proof-repair scaffold <ISSUE_ID>` ' +
        'for the exact governed repair steps: a real `pnpm test:db` run, `pnpm ops:proof-repair apply`, and a normal PR.'
      : '',
  };
}

export function findPostMergeTouches(input: {
  mergeSha: string;
  filesChanged: string[];
  issueId: string;
  sinceSha?: string;
  laneStartedAt?: string;
  allowSameIssueCommits?: boolean;
  gitCommand?: typeof git;
  showCommit?: typeof gitShowCommit;
}): string[] {
  const gitCommand = input.gitCommand ?? git;
  const logArgs = ['log', '--format=%H%x09%s%x09%cI', 'main', '--max-count=200'];
  const result = gitCommand(logArgs);
  if (!result.ok) {
    return [];
  }

  const mergeCommit = input.showCommit ? input.showCommit(input.mergeSha) : gitShowCommit(input.mergeSha);
  if (!mergeCommit?.timestamp) {
    return [];
  }
  const mergeTime = new Date(mergeCommit.timestamp).getTime();
  if (Number.isNaN(mergeTime)) {
    return [];
  }
  const windowEnd = mergeTime + 24 * 60 * 60 * 1000;
  const output: string[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line) {
      continue;
    }
    const [sha, subject, committedAt] = line.split('\t');
    if (!sha || sha === input.mergeSha) {
      continue;
    }
    if (input.sinceSha && sha === input.sinceSha) {
      break;
    }
    const committedTime = Date.parse(committedAt);
    if (Number.isNaN(committedTime) || committedTime > windowEnd) {
      continue;
    }
    if (committedTime <= mergeTime) {
      continue;
    }
    if (input.laneStartedAt && committedTime < new Date(input.laneStartedAt).getTime()) {
      continue;
    }
    const touchedFiles = gitCommand(['show', '--format=', '--name-only', sha]).stdout
      .split(/\r?\n/)
      .filter(Boolean);
    const overlaps = touchedFiles.some((filePath) => input.filesChanged.includes(filePath));
    if (!overlaps) {
      continue;
    }
    const referencedIssues = subject.match(/(?:UTV2|UNI)-\d+/gi) ?? [];
    if (
      input.allowSameIssueCommits &&
      referencedIssues.some((candidate) => candidate.toUpperCase() === input.issueId)
    ) {
      continue;
    }
    const hasFollowUpIssue = referencedIssues.some(
      (candidate) => candidate.toUpperCase() !== input.issueId,
    );
    if (!hasFollowUpIssue) {
      output.push(sha);
    }
  }

  return output;
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt === 1) {
        break;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Request failed for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export function githubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'unit-talk-ops-truth-check',
  };
}

const P0_RUNBOOK = 'docs/05_operations/P0_PROTOCOL_SPEC.md';

/**
 * Format P0 protocol H-check failures from a TruthCheckResult as structured
 * log lines for consistent operator-visible output (UTV2-949).
 *
 * Returns empty string when no H-check failures are present.
 */
export function formatP0Failures(result: TruthCheckResult): string {
  const hFailures = result.checks.filter(
    (c) => c.id.startsWith('H') && c.status === 'fail',
  );

  if (hFailures.length === 0) return '';

  const lines: string[] = [];
  for (const check of hFailures) {
    const event = {
      event: 'p0_protocol.h_check_failed',
      check_id: check.id,
      issue_id: result.issue_id,
      block_reason: check.detail,
      verdict: result.verdict,
      runbook: P0_RUNBOOK,
    };
    lines.push(JSON.stringify(event));
  }
  return lines.join('\n');
}
