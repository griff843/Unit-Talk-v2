#!/usr/bin/env tsx
/**
 * proof-binding-validator — version-aware proof binding gate.
 *
 * Validates evidence.json through the canonical proof-schema module, then for
 * schema v2 validates that the binding resolves against the current checkout:
 *   1. sha_binding block is present and structurally valid
 *   2. verified_source_sha is a real 40-char hex SHA
 *   3. verified_source_sha is an ancestor of current HEAD
 *   4. Every commit between verified_source_sha and HEAD touches only proof/evidence paths
 *   5. evidence_commit_sha resolves at runtime to the commit that last changed evidence.json
 *   6. current_pr_head_sha resolves at runtime from GITHUB_SHA or git rev-parse HEAD
 *   7. No sentinel values ("set-by-ci", "validated-by-ci-at-runtime") remain in the resolved output
 *
 * CI-resolved placeholder contract:
 *   evidence_commit_sha and current_pr_head_sha in evidence.json are CI-resolved placeholders.
 *   Storing "set-by-ci" as their value is explicitly allowed — the validator IGNORES the stored
 *   string and resolves both fields at runtime (from git log and GITHUB_SHA respectively).
 *   Rules 5–7 then validate that the RESOLVED values are real 40-char SHAs and not sentinels.
 *   If CI fails to resolve either field, the gate exits 1 — placeholder values never pass silently.
 *
 * Exit 0 → binding valid.
 * Exit 1 → binding invalid (gate fails).
 * Exit 2 → infrastructure error (missing files, bad args).
 *
 * Usage:
 *   tsx scripts/ci/proof-binding-validator.ts --proof-dir <dir> [--json]
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateEvidenceBundleContract,
  validateProofMergeShaIdentity,
  type EvidenceContractResult,
} from '../ops/proof-schema.js';
import { validatePreMergeModelRoutingEvidence, type ModelRoutingBlock } from '../ops/model-routing.js';

const SENTINELS = new Set(['set-by-ci', 'validated-by-ci-at-runtime']);
const SHA_RE = /^[0-9a-f]{40}$/;
const PROOF_ONLY_PREFIXES = ['docs/06_status/proof/', 'docs/06_status/lanes/'];

interface ParsedArgs {
  proofDir: string;
  json: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let proofDir = '';
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--proof-dir' && argv[i + 1]) proofDir = argv[++i]!;
    else if (argv[i] === '--json') json = true;
  }
  return { proofDir, json };
}

interface BindingResult {
  schema_version: 1 | 2 | null;
  gate: 'proof-binding-versioned';
  issue_id: string;
  verified_source_sha: string;
  resolved_evidence_commit_sha: string;
  resolved_current_pr_head_sha: string;
  /** True when both CI-resolved fields were successfully populated from git/GITHUB_SHA (not placeholders). */
  placeholder_fields_resolved: boolean;
  violations: string[];
  ok: boolean;
}

interface SchemaV2Binding {
  verified_source_sha: string;
  evidence_commit_sha: string;
  current_pr_head_sha: string;
}

interface EvidenceRecord extends Record<string, unknown> {
  schema_version?: unknown;
  issue_id?: unknown;
  sha_binding?: unknown;
}

interface ManifestBindingContext {
  laneType: string | null;
  modelRouting: ModelRoutingBlock | null;
  expectsModelRouting: boolean;
}

/**
 * UTV2-1783: the markdown half of the proof identity contract.
 *
 * This used to own its own copy of the rules and required the top-level
 * `MERGE_SHA:` row to be the literal `pending merge`, while required Executor
 * Result Validation required that same row to be a real hex SHA — a
 * contradiction no bundle could satisfy. The rules now live once, in
 * proof-schema's `validateProofMergeShaIdentity`, and both consumers call it,
 * so the two can no longer drift apart.
 *
 * `evidence` is passed through because the phase (pre- vs post-merge) and the
 * execution anchor are facts of the sha_binding block, not of the markdown.
 */
export function validatePreMergeVerificationBinding(content: string, evidence?: unknown): string[] {
  // `phase: 'pre-merge'` is stated, not inferred. This gate is unconditionally
  // a pre-merge gate (see the hardcoded `gate: 'pre-merge'` contract call
  // below), so the bundle's own merge slot must never be allowed to talk it
  // into believing a merge already happened.
  return validateProofMergeShaIdentity({
    verificationMarkdown: content,
    evidence,
    phase: 'pre-merge',
  }).failures.map((failure) => failure.message);
}

function git(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
}

function isAncestor(sha: string, head: string): boolean {
  try {
    execSync(`git merge-base --is-ancestor "${sha}" "${head}"`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function changedFilesSince(sha: string, head: string): string[] {
  const out = execSync(`git diff --name-only "${sha}..${head}"`, {
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
  return out ? out.split('\n').filter(Boolean) : [];
}

function resolveEvidenceCommit(repoRelPath: string): string {
  try {
    return execSync(`git log --follow --format="%H" -1 -- "${repoRelPath}"`, {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
  } catch {
    return '';
  }
}

function resolveManifestBindingContext(evidence: EvidenceRecord): ManifestBindingContext {
  const issueId = typeof evidence.issue_id === 'string' ? evidence.issue_id.toUpperCase() : '';
  if (!/^(UTV2|UNI)-\d+$/.test(issueId)) {
    return { laneType: null, modelRouting: null, expectsModelRouting: false };
  }
  const repoRoot = git('git rev-parse --show-toplevel');
  const manifestPath = join(repoRoot, 'docs', '06_status', 'lanes', `${issueId}.json`);
  if (!existsSync(manifestPath)) return { laneType: null, modelRouting: null, expectsModelRouting: false };
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      lane_type?: unknown;
      model_routing?: unknown;
      expected_proof_paths?: unknown;
    };
    return {
      laneType: typeof manifest.lane_type === 'string' ? manifest.lane_type : null,
      modelRouting:
        manifest.model_routing && typeof manifest.model_routing === 'object' && !Array.isArray(manifest.model_routing)
          ? manifest.model_routing as ModelRoutingBlock
          : null,
      expectsModelRouting:
        Array.isArray(manifest.expected_proof_paths) &&
        manifest.expected_proof_paths.some((entry) => typeof entry === 'string' && /(^|\/)model-routing\.json$/.test(entry)),
    };
  } catch {
    return { laneType: null, modelRouting: null, expectsModelRouting: false };
  }
}

export function validateBindingEvidenceContract(
  evidence: unknown,
  laneType: string | null,
): EvidenceContractResult {
  return validateEvidenceBundleContract(evidence, { gate: 'pre-merge', laneType });
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.proofDir) {
    process.stderr.write('proof-binding-validator: INFRA_ERROR — --proof-dir is required\n');
    process.exit(2);
  }

  const evidencePath = join(args.proofDir, 'evidence.json');
  if (!existsSync(evidencePath)) {
    process.stderr.write(
      `proof-binding-validator: INFRA_ERROR — evidence.json not found: ${evidencePath}\n`,
    );
    process.exit(2);
  }

  let evidence: EvidenceRecord;
  try {
    evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as EvidenceRecord;
  } catch (err) {
    process.stderr.write(
      `proof-binding-validator: INFRA_ERROR — cannot parse evidence.json: ${(err as Error).message}\n`,
    );
    process.exit(2);
  }

  const violations: string[] = [];
  const head: string = process.env['GITHUB_SHA'] ?? git('git rev-parse HEAD');

  const manifestContext = resolveManifestBindingContext(evidence);
  const contract = validateBindingEvidenceContract(evidence, manifestContext.laneType);
  violations.push(...contract.failures.map((failure) => `${failure.field}: ${failure.message}`));

  const verificationPath = join(args.proofDir, 'verification.md');
  if (!existsSync(verificationPath)) {
    violations.push(`verification.md is missing: ${verificationPath}`);
  } else {
    violations.push(...validatePreMergeVerificationBinding(readFileSync(verificationPath, 'utf8'), evidence));
  }

  const modelRoutingPath = join(args.proofDir, 'model-routing.json');
  if (manifestContext.expectsModelRouting && !existsSync(modelRoutingPath)) {
    violations.push(`required model-routing.json is missing: ${modelRoutingPath}`);
  } else if (existsSync(modelRoutingPath)) {
    try {
      const modelRouting = JSON.parse(readFileSync(modelRoutingPath, 'utf8')) as unknown;
      const result = validatePreMergeModelRoutingEvidence(modelRouting, {
        expectedIssueId: typeof evidence.issue_id === 'string' ? evidence.issue_id : undefined,
        manifestRouting: manifestContext.modelRouting,
      });
      violations.push(...result.violations.map((violation) => `model-routing.json: ${violation}`));
    } catch (error) {
      violations.push(`model-routing.json is not valid JSON: ${(error as Error).message}`);
    }
  }

  // V1 is historical read-only. The explicit pre-merge contract records the
  // named violation before this shape-specific early return.
  if (contract.schemaVersion === 1) {
    emit(args, evidence, '', head, violations, contract);
    return;
  }

  const binding = evidence.sha_binding as SchemaV2Binding | undefined;
  if (!binding) {
    emit(args, evidence, '', head, violations, contract);
    return;
  }

  const { verified_source_sha } = binding;

  // Rule 2: verified_source_sha must be a real 40-char hex SHA
  if (!SHA_RE.test(verified_source_sha)) {
    violations.push(
      `verified_source_sha is not a valid 40-char hex SHA: "${verified_source_sha}"`,
    );
  } else {
    // Rule 3: must be an ancestor of HEAD
    if (!isAncestor(verified_source_sha, head)) {
      violations.push(
        `verified_source_sha ${verified_source_sha.slice(0, 8)} is not an ancestor of HEAD ${head.slice(0, 8)}`,
      );
    } else {
      // Rule 4: all commits between verified_source_sha and HEAD must only touch proof paths
      const changed = changedFilesSince(verified_source_sha, head);
      const nonProof = changed.filter(
        (f) => !PROOF_ONLY_PREFIXES.some((prefix) => f.startsWith(prefix)),
      );
      if (nonProof.length > 0) {
        violations.push(
          `Non-proof files changed between verified_source_sha and HEAD — ` +
          `only proof/evidence paths are allowed after the substantive commit. ` +
          `Offending files: ${nonProof.join(', ')}`,
        );
      }
    }
  }

  // Rule 5: resolve evidence_commit_sha from git log (repo-relative path)
  const repoRelPath = relative(process.cwd(), evidencePath);
  const resolvedEvidenceSha = resolveEvidenceCommit(repoRelPath);
  if (!resolvedEvidenceSha || !SHA_RE.test(resolvedEvidenceSha)) {
    violations.push(
      `Cannot resolve evidence_commit_sha: git log found no commit for ${repoRelPath}`,
    );
  }

  // Rule 6: resolve current_pr_head_sha — must be a real SHA
  if (!SHA_RE.test(head)) {
    violations.push(`current_pr_head_sha resolved to non-SHA: "${head}"`);
  }

  // Rule 7: no sentinel values in resolved output
  if (SENTINELS.has(resolvedEvidenceSha)) {
    violations.push(
      `evidence_commit_sha resolved to sentinel "${resolvedEvidenceSha}" — CI failed to populate`,
    );
  }
  if (SENTINELS.has(head)) {
    violations.push(
      `current_pr_head_sha resolved to sentinel "${head}" — CI runtime context missing`,
    );
  }

  emit(args, evidence, resolvedEvidenceSha, head, violations, contract);
}

function emit(
  args: ParsedArgs,
  evidence: EvidenceRecord,
  resolvedEvidenceSha: string,
  resolvedHeadSha: string,
  violations: string[],
  contract: EvidenceContractResult,
): void {
  const ok = violations.length === 0;
  const placeholderFieldsResolved =
    SHA_RE.test(resolvedEvidenceSha) &&
    !SENTINELS.has(resolvedEvidenceSha) &&
    SHA_RE.test(resolvedHeadSha) &&
    !SENTINELS.has(resolvedHeadSha);
  const result: BindingResult = {
    schema_version: contract.schemaVersion,
    gate: 'proof-binding-versioned',
    issue_id: typeof evidence.issue_id === 'string' ? evidence.issue_id : 'unknown',
    verified_source_sha:
      typeof evidence.sha_binding === 'object' && evidence.sha_binding !== null &&
      typeof (evidence.sha_binding as Record<string, unknown>)['verified_source_sha'] === 'string'
        ? String((evidence.sha_binding as Record<string, unknown>)['verified_source_sha'])
        : '',
    resolved_evidence_commit_sha: resolvedEvidenceSha || '(unresolved)',
    resolved_current_pr_head_sha: resolvedHeadSha || '(unresolved)',
    placeholder_fields_resolved: placeholderFieldsResolved,
    violations,
    ok,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(`proof-binding-validator\n`);
    process.stdout.write(`  issue:                      ${result.issue_id}\n`);
    process.stdout.write(`  verified_source_sha:        ${result.verified_source_sha.slice(0, 16) || '(missing)'}...\n`);
    process.stdout.write(`  evidence_commit_sha:        ${result.resolved_evidence_commit_sha.slice(0, 16)}... [CI-resolved]\n`);
    process.stdout.write(`  current_pr_head_sha:        ${result.resolved_current_pr_head_sha.slice(0, 16)}... [CI-resolved]\n`);
    process.stdout.write(`  placeholder_fields_resolved: ${placeholderFieldsResolved ? 'yes' : 'NO — gate will fail'}\n`);
    if (violations.length > 0) {
      process.stdout.write(`\nVIOLATIONS (${violations.length}):\n`);
      for (const v of violations) {
        process.stdout.write(`  [FAIL] ${v}\n`);
      }
      process.stdout.write(`\nproof-binding-validator: FAIL\n`);
    } else {
      process.stdout.write(`\nproof-binding-validator: PASS\n`);
    }
  }

  process.exit(ok ? 0 : 1);
}

function isCliEntrypoint(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) main();
