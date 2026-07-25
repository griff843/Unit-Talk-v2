import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ROOT,
  emitJson,
  ensureDir,
  getFlag,
  git,
  parseArgs,
  readManifest,
  relativeToRoot,
  requireIssueId,
  type LaneManifest,
} from './shared.js';
import type { ModelRoutingBlock } from './model-routing.js';

type ProofArtifactName = 'diff-summary.md' | 'verification.md';

export interface ProofGitTruth {
  head_sha: string | null;
  merge_sha: string | null;
  diff_base_ref: string | null;
  diff_target_ref: string | null;
  diff_stat: string;
  name_status: string;
}

export interface ProofGenerateInput {
  manifest: LaneManifest;
  generatedAt: string;
  gitTruth: ProofGitTruth;
  verificationCommands?: string[];
  runtimeResult?: 'pass' | 'fail' | 'not_run';
  runtimeNotes?: string[];
}

export interface ProofGenerateResult {
  ok: true;
  code: 'proof_generated';
  issue_id: string;
  head_sha: string | null;
  merge_sha: string | null;
  generated_paths: string[];
  updated_paths: string[];
  unchanged_paths: string[];
  stale_paths_replaced: string[];
}

/** UTV2-1392: SHA rebind result for evidence.json / verification.md (T1/T2 proof bundle files). */
export interface ShaRebindOutcome {
  path: string;
  status: 'updated' | 'unchanged' | 'missing';
}

export type ModelRoutingRebindErrorCode =
  | 'binding_conflict'
  | 'incomplete_required_sidecar'
  | 'legacy_binding_conflict'
  | 'malformed_required_sidecar'
  | 'missing_pr_url'
  | 'missing_required_sidecar'
  | 'sidecar_identity_mismatch'
  | 'sidecar_manifest_routing_mismatch';

/**
 * Fields a required model-routing sidecar must carry as non-empty strings
 * before it is eligible to receive an authoritative closeout_binding. A
 * truncated or tampered sidecar that retains a matching `issue_id` but drops
 * these -- e.g. `{"issue_id":"UTV2-1586"}` -- would otherwise pass identity
 * validation and get bound despite providing no evidence of which model
 * actually executed the lane (independent review finding).
 */
const REQUIRED_MODEL_ROUTING_PROVENANCE_FIELDS = ['model', 'reasoning_effort'] as const;

/**
 * Canonical manifest-side routing fields, keyed by their MATCHING sidecar
 * field name (which is not always the same key -- the manifest's
 * ModelRoutingBlock.profile corresponds to the sidecar's model_profile).
 * `always` fields must agree whenever a manifest model_routing block is
 * supplied at all (execution identity: which model, at what effort).
 * `whenBothPresent` fields are administrative metadata that must still
 * agree if both sides happen to carry them, but their absence on either
 * side is not itself a failure (PM directive, UTV2-1589).
 */
const ALWAYS_MATCHED_ROUTING_FIELDS: ReadonlyArray<{
  sidecarField: string;
  manifestField: keyof ModelRoutingBlock;
}> = [
  { sidecarField: 'model', manifestField: 'model' },
  { sidecarField: 'reasoning_effort', manifestField: 'reasoning_effort' },
];
const OPTIONALLY_MATCHED_ROUTING_FIELDS: ReadonlyArray<{
  sidecarField: string;
  manifestField: keyof ModelRoutingBlock;
}> = [
  { sidecarField: 'model_profile', manifestField: 'profile' },
  { sidecarField: 'policy_version', manifestField: 'policy_version' },
];

export class ModelRoutingRebindError extends Error {
  constructor(
    public readonly code: ModelRoutingRebindErrorCode,
    public readonly proofPath: string,
    message: string,
  ) {
    super(message);
    this.name = 'ModelRoutingRebindError';
  }
}

export interface ProofGenerateOptions {
  root?: string;
  write?: boolean;
  /**
   * Skip binding model-routing.json entirely, touching only evidence.json/
   * verification.md. For an ordinary first-time closeout, manifest.pr_url
   * has not yet been independently validated against GitHub at this call
   * site (no --pr/--pr-url override is passed, so it falls back to
   * whatever's on disk) -- writing model-routing.json's IMMUTABLE
   * closeout_binding from that unvalidated value risks baking in a stale or
   * incorrect PR identity (e.g. after a PR rename/reopen) that the later,
   * properly-validated ops:lane-close --repair-merged path can then never
   * correct, since createRepairRollbackTransaction's snapshot is taken
   * after this already ran (independent review finding, UTV2-1589). The
   * trusted repair path always runs afterward for every closeout -- push or
   * workflow_dispatch -- and already binds model-routing.json itself using
   * its own validated PR/SHA resolution, so this option lets a caller (the
   * post-merge-lane-close.yml early-bind step) defer that binding entirely
   * rather than attempt it twice with different trust levels.
   */
  skipModelRouting?: boolean;
}

export interface ProofManifestOverrides {
  branch?: string | null;
  prUrl?: string | null;
}

type GitRunner = (args: string[], cwd?: string) => { ok: boolean; stdout: string; stderr: string };

const STANDARD_PROOF_FILES: ProofArtifactName[] = ['diff-summary.md', 'verification.md'];
const DEFAULT_VERIFICATION_COMMANDS = [
  'pnpm type-check',
  'pnpm test',
  'pnpm verify',
  'npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD',
];

export function standardProofPaths(issueId: string): Record<ProofArtifactName, string> {
  const proofRoot = path.posix.join('docs', '06_status', 'proof', issueId.toUpperCase());
  return {
    'diff-summary.md': path.posix.join(proofRoot, 'diff-summary.md'),
    'verification.md': path.posix.join(proofRoot, 'verification.md'),
  };
}

export function collectProofGitTruth(
  manifest: LaneManifest,
  options: {
    root?: string;
    gitRunner?: GitRunner;
    headSha?: string | null;
    mergeSha?: string | null;
  } = {},
): ProofGitTruth {
  const root = options.root ?? ROOT;
  const runGit = options.gitRunner ?? git;
  const worktreePath = path.resolve(root, manifest.worktree_path);
  const hasWorktree = fs.existsSync(worktreePath);
  const cwd = hasWorktree ? worktreePath : root;
  const headSha = options.headSha?.trim() || firstGitStdout(
    hasWorktree
      ? [
          ['rev-parse', 'HEAD'],
          ['rev-parse', `refs/heads/${manifest.branch}`],
          ['rev-parse', `refs/remotes/origin/${manifest.branch}`],
        ]
      : [
          ['rev-parse', `refs/heads/${manifest.branch}`],
          ['rev-parse', `refs/remotes/origin/${manifest.branch}`],
          ['rev-parse', 'HEAD'],
        ],
    runGit,
    cwd,
  );
  const mergeSha = options.mergeSha?.trim() || manifest.commit_sha?.trim() || null;
  const diffTargetRef = mergeSha ?? headSha;
  const diffBaseRef = mergeSha
    ? `${mergeSha}^1`
    : firstGitStdout(
        [
          ['merge-base', manifest.base_branch, headSha ?? 'HEAD'],
          ['merge-base', `origin/${manifest.base_branch}`, headSha ?? 'HEAD'],
        ],
        runGit,
        cwd,
      );
  const diffRange = diffBaseRef && diffTargetRef ? [diffBaseRef, diffTargetRef] : null;

  return {
    head_sha: headSha,
    merge_sha: mergeSha,
    diff_base_ref: diffBaseRef,
    diff_target_ref: diffTargetRef,
    diff_stat: diffRange
      ? gitStdoutOrEmpty(runGit(['diff', '--stat', ...diffRange], cwd))
      : '',
    name_status: diffRange
      ? gitStdoutOrEmpty(runGit(['diff', '--name-status', ...diffRange], cwd))
      : '',
  };
}

export function applyProofManifestOverrides(
  manifest: LaneManifest,
  overrides: ProofManifestOverrides,
): LaneManifest {
  return {
    ...manifest,
    branch: overrides.branch?.trim() || manifest.branch,
    pr_url: overrides.prUrl?.trim() || manifest.pr_url,
  };
}

export function detectCurrentProofContext(
  options: { root?: string; gitRunner?: GitRunner } = {},
): ProofManifestOverrides & { headSha: string | null } {
  const root = options.root ?? ROOT;
  const runGit = options.gitRunner ?? git;
  const branch = gitStdoutOrEmpty(runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root)) || null;
  return {
    branch,
    prUrl: branch ? gitStdoutOrEmpty(runGit(['config', '--get', `branch.${branch}.pr-url`], root)) || null : null,
    headSha: gitStdoutOrEmpty(runGit(['rev-parse', 'HEAD'], root)) || null,
  };
}

export function buildDiffSummary(input: ProofGenerateInput): string {
  const { manifest, gitTruth } = input;
  return [
    `# ${manifest.issue_id} Diff Summary`,
    '',
    `Generated at: ${input.generatedAt}`,
    `Issue: ${manifest.issue_id}`,
    `Tier: ${manifest.tier}`,
    `Lane type: ${manifest.lane_type}`,
    `Branch: ${manifest.branch}`,
    `PR URL: ${manifest.pr_url ?? 'N/A'}`,
    `Head SHA: ${gitTruth.head_sha ?? 'N/A'}`,
    `Merge SHA: ${gitTruth.merge_sha ?? 'N/A'}`,
    `Diff base: ${gitTruth.diff_base_ref ?? 'N/A'}`,
    `Diff target: ${gitTruth.diff_target_ref ?? 'N/A'}`,
    '',
    '## Git Diff Stat',
    fenced(gitTruth.diff_stat || 'No git diff stat available.'),
    '',
    '## Git Name Status',
    fenced(gitTruth.name_status || 'No git name-status diff available.'),
    '',
    '## Manifest Files Changed',
    ...(manifest.files_changed.length > 0
      ? manifest.files_changed.map((entry) => `- ${entry}`)
      : ['- No files_changed entries recorded.']),
    '',
    '## SHA Binding',
    `Head SHA: ${gitTruth.head_sha ?? 'N/A'}`,
    `Merge SHA: ${gitTruth.merge_sha ?? 'N/A'}`,
    '',
  ].join('\n');
}

export function buildRuntimeVerification(input: ProofGenerateInput): string {
  const { manifest, gitTruth } = input;
  const runtimeResult = input.runtimeResult ?? 'not_run';
  const commands = input.verificationCommands ?? DEFAULT_VERIFICATION_COMMANDS;
  const notes = input.runtimeNotes ?? [
    'Generated foundation artifact. Replace or append command output when runtime proof is executed.',
  ];

  return [
    `# ${manifest.issue_id} Runtime Verification`,
    '',
    `Generated at: ${input.generatedAt}`,
    `Issue: ${manifest.issue_id}`,
    `Tier: ${manifest.tier}`,
    `Lane type: ${manifest.lane_type}`,
    `Branch: ${manifest.branch}`,
    `PR URL: ${manifest.pr_url ?? 'N/A'}`,
    `Head SHA: ${gitTruth.head_sha ?? 'N/A'}`,
    `Merge SHA: ${gitTruth.merge_sha ?? 'N/A'}`,
    `result: ${runtimeResult}`,
    '',
    '## Verification',
    ...commands.map((command) => `- [ ] \`${command}\`: not run by proof-generate`),
    '',
    '## Runtime Verification',
    ...notes.map((note) => `- ${note}`),
    '',
    '## SHA Binding',
    `Head SHA: ${gitTruth.head_sha ?? 'N/A'}`,
    `Merge SHA: ${gitTruth.merge_sha ?? 'N/A'}`,
    '',
  ].join('\n');
}

const PRE_MERGE_STATUSES = new Set(['branch_head', 'in_review', 'pre_merge', 'open']);
const COMMIT_SHA_ROW_LINE_PATTERN = /^\|\s*Commit SHA\(s\)\s*\|/;
const MERGE_SHA_BINDING_HEADING = '## Merge SHA Binding';

/**
 * Line-based rewrite (not regex substitution across the whole file) so a greedy `$`-anchored
 * pattern can't accidentally swallow adjacent blank lines — the exact bug this replaced.
 */
function rewriteVerificationMdLines(content: string, mergeSha: string, prUrl: string | null): string {
  const hasTrailingNewline = content.endsWith('\n');
  const lines = content.split('\n');

  const rowIndex = lines.findIndex((line) => COMMIT_SHA_ROW_LINE_PATTERN.test(line));
  if (rowIndex !== -1) {
    lines[rowIndex] = `| Commit SHA(s) | \`${mergeSha}\` (merge SHA) |`;
  }

  const headingIndex = lines.findIndex((line) => line.trim() === MERGE_SHA_BINDING_HEADING);
  if (headingIndex !== -1) {
    let sectionEnd = lines.length;
    for (let i = headingIndex + 1; i < lines.length; i += 1) {
      if (lines[i].startsWith('## ')) {
        sectionEnd = i;
        break;
      }
    }
    lines.splice(headingIndex + 1, sectionEnd - (headingIndex + 1), '', `Merge SHA: \`${mergeSha}\``, `PR: ${prUrl ?? 'N/A'}`);
  }

  const joined = lines.join('\n');
  return hasTrailingNewline && !joined.endsWith('\n') ? `${joined}\n` : joined;
}

function hasVerificationShaBindingMarkers(content: string): boolean {
  return content
    .split('\n')
    .some((line) => COMMIT_SHA_ROW_LINE_PATTERN.test(line) || line.trim() === MERGE_SHA_BINDING_HEADING);
}

/**
 * UTV2-1392: `evidence.json` and `verification.md` are the files T1/T2 lanes actually use
 * for SHA-binding truth-check (C4/P3) and proof-gate checks — not the generic
 * generated diff-summary.md/verification.md pair above. Without this rebind, every merged
 * lane needed a manual post-merge SHA edit before `ops:lane-close` could pass.
 */
export function rebindEvidenceJsonSha(
  absolutePath: string,
  mergeSha: string,
  generatedAt: string,
  options: { write?: boolean; relPath?: string } = {},
): ShaRebindOutcome {
  const relPath = options.relPath ?? absolutePath;
  if (!fs.existsSync(absolutePath)) {
    return { path: relPath, status: 'missing' };
  }

  const previousContent = fs.readFileSync(absolutePath, 'utf8');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(previousContent) as Record<string, unknown>;
  } catch {
    // Not valid JSON (or not an evidence bundle) — leave untouched rather than corrupt it.
    return { path: relPath, status: 'unchanged' };
  }

  const shaBinding = (parsed['sha_binding'] as Record<string, unknown> | undefined) ?? undefined;
  if (!shaBinding || typeof shaBinding !== 'object') {
    return { path: relPath, status: 'unchanged' };
  }

  const wasPreMerge = shaBinding['sha_type'] !== 'merge_sha' || shaBinding['verified_source_sha'] !== mergeSha;
  if (!wasPreMerge) {
    // Already bound to this exact merge SHA — leave bound_at alone so re-running
    // ops:proof-generate doesn't perturb an already-correct file (idempotent).
    return { path: relPath, status: 'unchanged' };
  }

  const nextShaBinding = {
    ...shaBinding,
    verified_source_sha: mergeSha,
    sha_type: 'merge_sha',
    bound_at: generatedAt,
  };
  const nextParsed = { ...parsed, sha_binding: nextShaBinding };
  if (PRE_MERGE_STATUSES.has(String(parsed['status']))) {
    nextParsed['status'] = 'merged';
  }

  const nextContent = `${JSON.stringify(nextParsed, null, 2)}\n`;
  if (nextContent === previousContent) {
    return { path: relPath, status: 'unchanged' };
  }

  if (options.write ?? true) {
    fs.writeFileSync(absolutePath, nextContent, 'utf8');
  }
  return { path: relPath, status: 'updated' };
}

export function rebindVerificationMdSha(
  absolutePath: string,
  mergeSha: string,
  prUrl: string | null,
  options: { write?: boolean; relPath?: string } = {},
): ShaRebindOutcome {
  const relPath = options.relPath ?? absolutePath;
  if (!fs.existsSync(absolutePath)) {
    return { path: relPath, status: 'missing' };
  }

  const previousContent = fs.readFileSync(absolutePath, 'utf8');
  const nextContent = rewriteVerificationMdLines(previousContent, mergeSha, prUrl);

  if (nextContent === previousContent) {
    return { path: relPath, status: 'unchanged' };
  }

  if (options.write ?? true) {
    fs.writeFileSync(absolutePath, nextContent, 'utf8');
  }
  return { path: relPath, status: 'updated' };
}

/**
 * Appends authoritative post-merge identity to an immutable Codex model-routing
 * sidecar. Existing execution provenance is preserved; an existing binding may
 * only be replayed for the exact same PR and merge SHA.
 */
export function rebindModelRoutingJsonSha(
  absolutePath: string,
  mergeSha: string,
  generatedAt: string,
  prUrl: string | null,
  options: {
    required?: boolean;
    write?: boolean;
    relPath?: string;
    expectedIssueId?: string;
    manifestModelRouting?: ModelRoutingBlock | null;
  } = {},
): ShaRebindOutcome {
  const relPath = options.relPath ?? absolutePath;
  const required = options.required ?? false;
  if (!fs.existsSync(absolutePath)) {
    if (required) {
      throw new ModelRoutingRebindError(
        'missing_required_sidecar',
        relPath,
        `Required model-routing sidecar is missing: ${relPath}`,
      );
    }
    return { path: relPath, status: 'missing' };
  }

  const normalizedPrUrl = normalizePrUrl(prUrl);
  if (!normalizedPrUrl) {
    throw new ModelRoutingRebindError(
      'missing_pr_url',
      relPath,
      `Cannot bind model-routing sidecar without an authoritative PR URL: ${relPath}`,
    );
  }

  const previousContent = fs.readFileSync(absolutePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(previousContent);
  } catch {
    throw new ModelRoutingRebindError(
      'malformed_required_sidecar',
      relPath,
      `Required model-routing sidecar is not valid JSON: ${relPath}`,
    );
  }
  if (!isJsonObject(parsed)) {
    throw new ModelRoutingRebindError(
      'malformed_required_sidecar',
      relPath,
      `Required model-routing sidecar must be a JSON object: ${relPath}`,
    );
  }

  if (options.expectedIssueId !== undefined) {
    const sidecarIssueId = parsed['issue_id'];
    if (
      typeof sidecarIssueId !== 'string' ||
      sidecarIssueId.trim().toUpperCase() !== options.expectedIssueId.trim().toUpperCase()
    ) {
      throw new ModelRoutingRebindError(
        'sidecar_identity_mismatch',
        relPath,
        `Model-routing sidecar issue_id ${JSON.stringify(sidecarIssueId)} does not match ` +
          `expected lane ${options.expectedIssueId}: ${relPath}`,
      );
    }
  }

  if (required) {
    const missingOrEmpty = REQUIRED_MODEL_ROUTING_PROVENANCE_FIELDS.filter(
      (field) => typeof parsed[field] !== 'string' || parsed[field].trim() === '',
    );
    if (missingOrEmpty.length > 0) {
      throw new ModelRoutingRebindError(
        'incomplete_required_sidecar',
        relPath,
        `Required model-routing sidecar is missing execution-provenance fields (${missingOrEmpty.join(', ')}): ${relPath}`,
      );
    }
  }

  if (required && options.manifestModelRouting) {
    const manifestRouting = options.manifestModelRouting;

    for (const { sidecarField, manifestField } of ALWAYS_MATCHED_ROUTING_FIELDS) {
      const manifestValue = manifestRouting[manifestField];
      if (typeof manifestValue !== 'string' || manifestValue.trim() === '') {
        throw new ModelRoutingRebindError(
          'sidecar_manifest_routing_mismatch',
          relPath,
          `Manifest model_routing.${manifestField} is missing or empty; cannot validate sidecar routing field "${sidecarField}": ${relPath}`,
        );
      }
      const sidecarValue = parsed[sidecarField];
      if (sidecarValue !== manifestValue) {
        throw new ModelRoutingRebindError(
          'sidecar_manifest_routing_mismatch',
          relPath,
          `Sidecar ${sidecarField} ${JSON.stringify(sidecarValue)} does not match manifest ` +
            `model_routing.${manifestField} ${JSON.stringify(manifestValue)}: ${relPath}`,
        );
      }
    }

    for (const { sidecarField, manifestField } of OPTIONALLY_MATCHED_ROUTING_FIELDS) {
      const sidecarValue = parsed[sidecarField];
      const manifestValue = manifestRouting[manifestField];
      const sidecarPresent = typeof sidecarValue === 'string' && sidecarValue.trim() !== '';
      const manifestPresent = typeof manifestValue === 'string' && manifestValue.trim() !== '';
      if (sidecarPresent && manifestPresent && sidecarValue !== manifestValue) {
        throw new ModelRoutingRebindError(
          'sidecar_manifest_routing_mismatch',
          relPath,
          `Sidecar ${sidecarField} ${JSON.stringify(sidecarValue)} does not match manifest ` +
            `model_routing.${manifestField} ${JSON.stringify(manifestValue)}: ${relPath}`,
        );
      }
    }
  }

  // Some historical sidecars (pre-dating closeout_binding) carry a legacy
  // top-level merge_sha field. The object spread below preserves it
  // untouched, so if it disagrees with the authoritative SHA being bound
  // here, the file would end up asserting two different merge identities --
  // and P3/C4 would both still pass, since they only require the
  // authoritative SHA to appear somewhere in the file, not that the file is
  // internally consistent (independent review finding).
  const legacyMergeSha = parsed['merge_sha'];
  if (typeof legacyMergeSha === 'string' && legacyMergeSha.trim() !== '' && legacyMergeSha !== mergeSha) {
    throw new ModelRoutingRebindError(
      'legacy_binding_conflict',
      relPath,
      `Sidecar legacy top-level merge_sha ${JSON.stringify(legacyMergeSha)} conflicts with the ` +
        `authoritative merge SHA ${JSON.stringify(mergeSha)}: ${relPath}`,
    );
  }

  const existingBinding = parsed['closeout_binding'];
  if (existingBinding !== undefined) {
    if (
      !isJsonObject(existingBinding) ||
      existingBinding['sha_type'] !== 'merge_sha' ||
      typeof existingBinding['merge_sha'] !== 'string' ||
      typeof existingBinding['pr_url'] !== 'string' ||
      typeof existingBinding['bound_at'] !== 'string' ||
      !isIsoTimestamp(existingBinding['bound_at'])
    ) {
      throw new ModelRoutingRebindError(
        'malformed_required_sidecar',
        relPath,
        `Existing model-routing closeout binding is malformed: ${relPath}`,
      );
    }

    const boundMergeSha = existingBinding['merge_sha'];
    const boundPrUrl = normalizePrUrl(existingBinding['pr_url']);
    if (boundMergeSha !== mergeSha || boundPrUrl !== normalizedPrUrl) {
      throw new ModelRoutingRebindError(
        'binding_conflict',
        relPath,
        `Existing model-routing closeout binding conflicts with PR ${normalizedPrUrl} at ${mergeSha}: ${relPath}`,
      );
    }

    return { path: relPath, status: 'unchanged' };
  }

  const nextParsed = {
    ...parsed,
    closeout_binding: {
      sha_type: 'merge_sha',
      merge_sha: mergeSha,
      pr_url: normalizedPrUrl,
      bound_at: generatedAt,
    },
  };
  const nextContent = `${JSON.stringify(nextParsed, null, 2)}\n`;
  if (options.write ?? true) {
    fs.writeFileSync(absolutePath, nextContent, 'utf8');
  }
  return { path: relPath, status: 'updated' };
}

/** Rebinds evidence.json + verification.md for an issue if they exist. No-op without a merge SHA. */
export function rebindMergeSha(
  root: string,
  issueId: string,
  mergeSha: string | null,
  generatedAt: string,
  prUrl: string | null,
  options: { write?: boolean } = {},
): ShaRebindOutcome[] {
  if (!mergeSha) {
    return [];
  }
  const proofRoot = path.posix.join('docs', '06_status', 'proof', issueId.toUpperCase());
  const evidenceRelPath = path.posix.join(proofRoot, 'evidence.json');
  const verificationRelPath = path.posix.join(proofRoot, 'verification.md');
  return [
    rebindEvidenceJsonSha(safeRepoPath(root, evidenceRelPath), mergeSha, generatedAt, {
      ...options,
      relPath: evidenceRelPath,
    }),
    rebindVerificationMdSha(safeRepoPath(root, verificationRelPath), mergeSha, prUrl, {
      ...options,
      relPath: verificationRelPath,
    }),
  ];
}

export function generateProofArtifacts(
  input: ProofGenerateInput,
  options: ProofGenerateOptions = {},
): ProofGenerateResult {
  const root = options.root ?? ROOT;
  const shouldWrite = options.write ?? true;
  const contentByFile: Record<ProofArtifactName, string> = {
    'diff-summary.md': buildDiffSummary(input),
    'verification.md': buildRuntimeVerification(input),
  };
  const paths = standardProofPaths(input.manifest.issue_id);
  const generatedPaths: string[] = [];
  const updatedPaths: string[] = [];
  const unchangedPaths: string[] = [];
  const stalePathsReplaced: string[] = [];
  const pushUnique = (paths: string[], proofPath: string): void => {
    if (!paths.includes(proofPath)) {
      paths.push(proofPath);
    }
  };
  const requiredShas = [input.gitTruth.head_sha, input.gitTruth.merge_sha].filter(isPresent);
  const modelRoutingPaths = input.manifest.expected_proof_paths.filter(
    (proofPath) => path.posix.basename(proofPath) === 'model-routing.json',
  );

  // Validate every required routing sidecar before mutating any proof artifact
  // so conflicts and malformed historical authority fail as one atomic
  // operation. A manifest declaring more than one model-routing.json (not
  // used by any lane today, but not disallowed by the schema either) must
  // have every one bound -- the truth gate evaluates every expected proof
  // artifact, so leaving a second match unbound would permanently block
  // closeout even though this function reported success.
  if (input.gitTruth.merge_sha && !options.skipModelRouting) {
    for (const modelRoutingPath of modelRoutingPaths) {
      rebindModelRoutingJsonSha(
        safeRepoPath(root, modelRoutingPath),
        input.gitTruth.merge_sha,
        input.generatedAt,
        input.manifest.pr_url,
        {
          required: true,
          write: false,
          relPath: modelRoutingPath,
          expectedIssueId: input.manifest.issue_id,
          manifestModelRouting: input.manifest.model_routing,
        },
      );
    }
  }

  for (const proofFile of STANDARD_PROOF_FILES) {
    const proofPath = paths[proofFile];
    const absolutePath = safeRepoPath(root, proofPath);
    const nextContent = contentByFile[proofFile];
    const exists = fs.existsSync(absolutePath);
    const previousContent = exists ? fs.readFileSync(absolutePath, 'utf8') : null;
    const stale = previousContent !== null &&
      requiredShas.some((sha) => !previousContent.includes(sha));

    if (proofFile === 'verification.md' && previousContent !== null && hasVerificationShaBindingMarkers(previousContent)) {
      continue;
    }

    if (previousContent === nextContent) {
      pushUnique(unchangedPaths, proofPath);
      continue;
    }

    if (shouldWrite) {
      ensureDir(path.dirname(absolutePath));
      fs.writeFileSync(absolutePath, nextContent, 'utf8');
    }

    if (!exists) {
      pushUnique(generatedPaths, proofPath);
    } else {
      pushUnique(updatedPaths, proofPath);
      if (stale) {
        pushUnique(stalePathsReplaced, proofPath);
      }
    }
  }

  const rebindOutcomes = rebindMergeSha(
    root,
    input.manifest.issue_id,
    input.gitTruth.merge_sha,
    input.generatedAt,
    input.manifest.pr_url,
    { write: shouldWrite },
  );
  for (const outcome of rebindOutcomes) {
    if (outcome.status === 'updated') {
      pushUnique(updatedPaths, outcome.path);
      pushUnique(stalePathsReplaced, outcome.path);
    } else if (outcome.status === 'unchanged') {
      pushUnique(unchangedPaths, outcome.path);
    }
    // 'missing' outcomes are intentionally not reported — evidence.json/verification.md
    // are optional per lane_type (e.g. T3 lanes have neither); absence is not an error.
  }

  if (input.gitTruth.merge_sha && !options.skipModelRouting) {
    for (const modelRoutingPath of modelRoutingPaths) {
      const outcome = rebindModelRoutingJsonSha(
        safeRepoPath(root, modelRoutingPath),
        input.gitTruth.merge_sha,
        input.generatedAt,
        input.manifest.pr_url,
        {
          required: true,
          write: shouldWrite,
          relPath: modelRoutingPath,
          expectedIssueId: input.manifest.issue_id,
          manifestModelRouting: input.manifest.model_routing,
        },
      );
      if (outcome.status === 'updated') {
        pushUnique(updatedPaths, outcome.path);
        pushUnique(stalePathsReplaced, outcome.path);
      } else if (outcome.status === 'unchanged') {
        pushUnique(unchangedPaths, outcome.path);
      }
    }
  }

  return {
    ok: true,
    code: 'proof_generated',
    issue_id: input.manifest.issue_id,
    head_sha: input.gitTruth.head_sha,
    merge_sha: input.gitTruth.merge_sha,
    generated_paths: generatedPaths,
    updated_paths: updatedPaths,
    unchanged_paths: unchangedPaths,
    stale_paths_replaced: stalePathsReplaced,
  };
}

function firstGitStdout(commands: string[][], runGit: GitRunner, cwd: string): string | null {
  for (const command of commands) {
    if (command.some((arg) => arg === null || arg === undefined || arg === '')) {
      continue;
    }
    const result = runGit(command, cwd);
    if (result.ok && result.stdout.trim()) {
      return result.stdout.trim();
    }
  }
  return null;
}

function gitStdoutOrEmpty(result: { ok: boolean; stdout: string }): string {
  return result.ok ? result.stdout.trim() : '';
}

function fenced(content: string): string {
  return ['```', content, '```'].join('\n');
}

function isPresent(value: string | null): value is string {
  return value !== null && value.trim() !== '';
}

function isIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePrUrl(value: string | null): string | null {
  const normalized = value?.trim().replace(/\/+$/, '') ?? '';
  return normalized || null;
}

/**
 * Resolves a repo-relative proof path and refuses to return one that escapes
 * `root` (e.g. a manifest.expected_proof_paths entry containing `../../`).
 * Exported so callers outside this module -- e.g. lane-close.ts's trusted
 * `--repair-merged` path, which resolves the same manifest-declared
 * model-routing.json paths -- get the identical guard rather than a bare
 * path.resolve() with no escape check (UTV2-1589 independent review).
 */
export function safeRepoPath(root: string, repoRelativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const absolutePath = path.resolve(resolvedRoot, repoRelativePath);
  if (!absolutePath.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Proof path escapes repo root: ${repoRelativePath}`);
  }
  return absolutePath;
}

function main(argv = process.argv.slice(2)): number {
  const { positionals, flags, bools } = parseArgs(argv);
  const issueId = requireIssueId(getFlag(flags, 'issue') ?? positionals[0] ?? '');
  const detected = bools.has('current') ? detectCurrentProofContext() : { headSha: null };
  const manifest = applyProofManifestOverrides(readManifest(issueId), {
    branch: getFlag(flags, 'branch') ?? detected.branch ?? null,
    prUrl: getFlag(flags, 'pr-url') ?? getFlag(flags, 'pr') ?? detected.prUrl ?? null,
  });
  const input: ProofGenerateInput = {
    manifest,
    generatedAt: new Date().toISOString(),
    gitTruth: collectProofGitTruth(manifest, {
      headSha: getFlag(flags, 'head-sha') ?? detected.headSha ?? null,
      mergeSha: getFlag(flags, 'merge-sha') ?? null,
    }),
    runtimeResult: (getFlag(flags, 'runtime-result') as ProofGenerateInput['runtimeResult']) ?? 'not_run',
  };

  let result: ProofGenerateResult;
  try {
    result = generateProofArtifacts(input, {
      root: ROOT,
      write: !bools.has('dry-run'),
      skipModelRouting: bools.has('skip-model-routing'),
    });
  } catch (error) {
    if (error instanceof ModelRoutingRebindError) {
      // A required model-routing sidecar was missing, malformed, or already bound
      // to conflicting historical authority. No proof artifact was mutated (the
      // routing-sidecar validation runs before any write). Fail with a structured,
      // parseable result rather than an uncaught crash, per UTV2-1589.
      const failure = {
        ok: false as const,
        code: error.code,
        issue_id: issueId,
        proof_path: error.proofPath,
        message: error.message,
      };
      if (bools.has('json')) {
        emitJson(failure);
      } else {
        process.stderr.write(`${failure.code}: ${failure.message}\n`);
      }
      return 1;
    }
    throw error;
  }

  if (bools.has('json')) {
    emitJson(result);
  } else {
    process.stdout.write(`Generated proof artifacts for ${result.issue_id}\n`);
    for (const generatedPath of result.generated_paths) {
      process.stdout.write(`generated: ${relativeToRoot(path.resolve(ROOT, generatedPath))}\n`);
    }
    for (const updatedPath of result.updated_paths) {
      process.stdout.write(`updated: ${relativeToRoot(path.resolve(ROOT, updatedPath))}\n`);
    }
    for (const unchangedPath of result.unchanged_paths) {
      process.stdout.write(`unchanged: ${relativeToRoot(path.resolve(ROOT, unchangedPath))}\n`);
    }
  }

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
