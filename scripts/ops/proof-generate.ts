import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type HarvestCiDbProofOptions,
  type HarvestIoOptions,
  findWorkflowJobForHeadSha,
  harvestCiDbProofForMergeSha,
} from './ci-db-proof-harvest.js';
import {
  ROOT,
  emitJson,
  ensureDir,
  getFlag,
  git,
  mergeVerifierIdentity,
  parseArgs,
  readManifest,
  relativeToRoot,
  requireIssueId,
  type LaneManifest,
} from './shared.js';
import type { ModelRoutingBlock } from './model-routing.js';
import { declaredProfileForLaneType } from './proof-schema.js';

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
  /**
   * UTV2-1631: retained for consumers, but now always empty. It used to name
   * the proof artifacts this script had just overwritten wholesale with an
   * empty `result: not_run` template -- i.e. it reported *destroyed measured
   * evidence* as if it were routine maintenance. Existing proof artifacts are
   * never replaced any more (see `generateProofArtifacts`), so nothing can be
   * "stale-replaced"; SHA-rebound files are reported in `rebound_paths` and
   * untouched ones in `preserved_paths`.
   */
  stale_paths_replaced: string[];
  /** Existing artifacts that were found on disk and NOT regenerated (UTV2-1631). */
  preserved_paths: string[];
  /** Preserved artifacts whose merge-SHA-bearing fields were rebound in place (UTV2-1631). */
  rebound_paths: string[];
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

/**
 * UTV2-1631. Raised when an existing, hand-authored proof artifact cannot be
 * safely rebound to the authoritative merge SHA. The contract is: fail loudly
 * and leave the file byte-identical on disk. Overwriting on uncertainty is
 * exactly the defect this class exists to make impossible -- two independent
 * agents lost a full measured T1 bundle to a silent template replacement and
 * had to restore it by hand.
 */
export type ProofPreservationErrorCode =
  | 'unbindable_proof_artifact'
  | 'malformed_evidence_json';

export class ProofPreservationError extends Error {
  constructor(
    public readonly code: ProofPreservationErrorCode,
    public readonly proofPath: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProofPreservationError';
  }
}

export interface ProofGenerateOptions {
  root?: string;
  write?: boolean;
  /**
   * Explicit opt-in required to bind model-routing.json at all; the default
   * is to leave it untouched (only evidence.json/verification.md are bound).
   * Any caller of this function or the ops:proof-generate CLI resolves
   * manifest.pr_url from disk with no independent GitHub validation unless
   * it explicitly supplies --pr/--pr-url itself -- and even then, that
   * value is not verified against the real PR/merge state the way
   * ops:lane-close --repair-merged's fetchMergedPrInfo/validateTrustedPostMergeRepair
   * do. Writing model-routing.json's IMMUTABLE closeout_binding from an
   * unvalidated PR/SHA (whether from an untrusted CLI invocation, e.g. an
   * operator following proof-repair.ts's printed remediation command, or
   * any other caller) risks baking in a stale or incorrect identity that
   * the later, properly-validated repair path can then never correct,
   * since createRepairRollbackTransaction's snapshot is taken after this
   * already ran (independent review findings, UTV2-1589). The trusted
   * repair path (scripts/ops/lane-close.ts's rebindRepairedLaneProof) is
   * the sole caller with real validated authority, and it does not go
   * through this function at all -- it calls rebindModelRoutingJsonSha
   * directly. There is currently no legitimate caller that needs to set
   * this to true; it exists only so a future genuinely-trusted caller has
   * an explicit, auditable way to opt in rather than model-routing binding
   * being the silent default for anyone who calls this function or CLI.
   */
  bindModelRouting?: boolean;
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

  // UTV2-1701: four gates read this document and each demands a different
  // shape. Every requirement is a presence assertion -- none forbids anything --
  // so the satisfying template is their strict union and no gate is weakened to
  // reach it. Requirements, with the source that enforces each:
  //
  //   `# PROOF:`            executor-result-validator.yml:263; truth-check-lib.ts:507 (CEP-E3)
  //   bare `MERGE_SHA:`     executor-result-validator.yml:266; truth-check-lib.ts:507
  //   `ASSERTIONS:`         executor-result-validator.yml:303; truth-check-lib.ts:507
  //   `EVIDENCE:`           executor-result-validator.yml:317; truth-check-lib.ts:507
  //   fenced block in it    executor-result-validator.yml:325
  //   any 40-hex SHA        runtime-verifier-gate.ts:132  (HARD fail when absent)
  //   `## Verification`     runtime-verifier-gate.ts:121 AND proof-auditor-gate.ts:25
  //   command literals      truth-check-lib.ts:676,682,689 (P12/P13/P14)
  //
  // `## Verification` satisfies both header checks, and the command literals
  // already come from DEFAULT_VERIFICATION_COMMANDS, so the union is smaller
  // than the four requirement lists suggest.
  //
  // The SHA anchor takes the merge SHA when it exists and the head SHA before
  // merge. It must never be a placeholder word: runtime-verifier-gate hard-fails
  // when the file contains no 40-hex token at all, and only *warns* when the
  // token differs from the current head. Emitting `N/A` therefore failed the
  // gate outright on every freshly generated bundle, which is why each lane
  // repaired this line by hand. `N/A` survives only when neither SHA is known,
  // where failing is the correct outcome.
  const shaAnchor = gitTruth.merge_sha ?? gitTruth.head_sha ?? 'N/A';

  return [
    `# PROOF: ${manifest.issue_id}`,
    '',
    `MERGE_SHA: ${shaAnchor}`,
    '',
    '> Pre-merge this anchor carries the verified implementation SHA; the merge SHA does',
    '> not exist yet. `post-merge-lane-close.yml` rebinds it to the authoritative merge',
    '> SHA via `ops:proof-generate --merge-sha`.',
    '',
    `Generated at: ${input.generatedAt}`,
    `Issue: ${manifest.issue_id}`,
    `Tier: ${manifest.tier}`,
    `Lane type: ${manifest.lane_type}`,
    `Branch: ${manifest.branch}`,
    `PR URL: ${manifest.pr_url ?? 'N/A'}`,
    `Head SHA: ${gitTruth.head_sha ?? 'N/A'}`,
    `result: ${runtimeResult}`,
    '',
    '## ASSERTIONS:',
    '',
    '- [ ] Replace with the acceptance criteria this lane claims to satisfy, one per line.',
    '- [ ] Every box left unchecked is an unmet criterion, not a formatting placeholder.',
    '',
    '## EVIDENCE:',
    '',
    'The measured commands are recorded below. Replace the block with real output',
    'when the commands are executed; a fenced block is required and must not be empty.',
    '',
    '```',
    ...commands.map((command) => `$ ${command}`),
    '(not run by proof-generate)',
    '```',
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
 * A line that *labels* a merge SHA, in any of the shapes proof authors and this
 * generator actually use:
 *   `MERGE_SHA: <sha>`                  (canonical `# PROOF:` bundle format)
 *   `Merge SHA: <sha>`                  (generated template + most hand-authored bundles)
 *   `- Merge SHA: \`<sha>\``            (bulleted)
 *   `**Merge SHA:** <sha>`              (bolded)
 * The capture group is the label prefix; only the SHA *token* inside the value
 * is substituted, never the whole line, so trailing commentary such as
 * "(merge SHA, PR #1324)" survives byte-identically.
 */
const MERGE_SHA_LABEL_PATTERN = /^(\s*(?:[-*]\s+)?(?:\*\*)?(?:MERGE_SHA|Merge SHA|MERGE SHA)(?:\*\*)?:\s*)(.*)$/;
const FULL_SHA_TOKEN_PATTERN = /\b[0-9a-f]{40}\b/;
const PLACEHOLDER_VALUE_PATTERN = /^`?(?:N\/A|TBD|pending|stale|<merge[_ -]?sha>)`?$/i;

/**
 * Substitutes the SHA token inside a labelled merge-SHA value, preserving any
 * backticks and any surrounding prose. Returns null when the value carries no
 * bindable token at all (so the caller can treat the line as a non-anchor
 * rather than clobbering it).
 */
function substituteMergeShaValue(value: string, mergeSha: string): string | null {
  if (FULL_SHA_TOKEN_PATTERN.test(value)) {
    return value.replace(FULL_SHA_TOKEN_PATTERN, mergeSha);
  }
  const trimmed = value.trim();
  if (PLACEHOLDER_VALUE_PATTERN.test(trimmed)) {
    const backticked = trimmed.startsWith('`');
    return value.replace(trimmed, backticked ? `\`${mergeSha}\`` : mergeSha);
  }
  return null;
}

/**
 * True when the `## Merge SHA Binding` section body is a placeholder this
 * script owns (blank lines, a parenthetical "filled post-merge" note, or
 * previously generated `Merge SHA:` / `PR:` lines) rather than authored
 * content. Only a placeholder body may be replaced; anything else is
 * token-substituted in place so prose and measurements survive (UTV2-1631).
 */
function isReplaceableMergeShaBindingBody(bodyLines: string[]): boolean {
  return bodyLines.every((line) => {
    const trimmed = line.trim();
    if (trimmed === '') return true;
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) return true;
    if (MERGE_SHA_LABEL_PATTERN.test(line)) return true;
    if (/^PR:\s*/.test(trimmed)) return true;
    return false;
  });
}

/**
 * Line-based rewrite (not regex substitution across the whole file) so a greedy `$`-anchored
 * pattern can't accidentally swallow adjacent blank lines — the exact bug this replaced.
 *
 * UTV2-1631 widened this from two anchors (the `| Commit SHA(s) |` row and the
 * `## Merge SHA Binding` placeholder section) to every labelled merge-SHA line,
 * because the canonical `# PROOF:` bundle format binds via a bare `MERGE_SHA:`
 * line and carried neither of the two old anchors. A bundle in the repo's own
 * required proof format was therefore considered "unbindable" by this function
 * and got destroyed by the template overwrite in `generateProofArtifacts`
 * instead.
 */
export function rebindMergeShaAnchorsInMarkdown(
  content: string,
  mergeSha: string,
  prUrl: string | null,
): string {
  const hasTrailingNewline = content.endsWith('\n');
  const lines = content.split('\n');

  // A fenced block in a proof document is quoted evidence — a captured command
  // output, a diff, a TAP block. Rebinding a SHA inside one would rewrite the
  // measurement itself, which is the same class of harm as replacing the file
  // (UTV2-1631). Anchors are only honoured outside fences.
  const insideFence: boolean[] = [];
  let fenced = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      insideFence.push(true);
      fenced = !fenced;
      continue;
    }
    insideFence.push(fenced);
  }

  const rowIndex = lines.findIndex((line, i) => !insideFence[i] && COMMIT_SHA_ROW_LINE_PATTERN.test(line));
  if (rowIndex !== -1) {
    lines[rowIndex] = `| Commit SHA(s) | \`${mergeSha}\` (merge SHA) |`;
  }

  // Token substitution runs BEFORE the section splice below, because the splice
  // changes line indices and would invalidate `insideFence`.
  for (let i = 0; i < lines.length; i += 1) {
    if (insideFence[i]) continue;
    const match = MERGE_SHA_LABEL_PATTERN.exec(lines[i]);
    if (!match) continue;
    const substituted = substituteMergeShaValue(match[2], mergeSha);
    if (substituted !== null) {
      lines[i] = `${match[1]}${substituted}`;
    }
  }

  const headingIndex = lines.findIndex((line, i) => !insideFence[i] && line.trim() === MERGE_SHA_BINDING_HEADING);
  if (headingIndex !== -1) {
    let sectionEnd = lines.length;
    for (let i = headingIndex + 1; i < lines.length; i += 1) {
      if (lines[i].startsWith('## ')) {
        sectionEnd = i;
        break;
      }
    }
    const bodyLines = lines.slice(headingIndex + 1, sectionEnd);
    if (isReplaceableMergeShaBindingBody(bodyLines)) {
      lines.splice(headingIndex + 1, sectionEnd - (headingIndex + 1), '', `Merge SHA: \`${mergeSha}\``, `PR: ${prUrl ?? 'N/A'}`);
    }
  }

  const joined = lines.join('\n');
  return hasTrailingNewline && !joined.endsWith('\n') ? `${joined}\n` : joined;
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(previousContent);
  } catch {
    // UTV2-1631: this used to return 'unchanged' and say nothing. An evidence
    // bundle that cannot be parsed is not a bundle that needs no work — it is a
    // bundle whose SHA binding silently never happened, which then reads as a
    // clean closeout. Leave the bytes untouched, but fail loudly.
    throw new ProofPreservationError(
      'malformed_evidence_json',
      relPath,
      `Evidence bundle is not valid JSON and cannot be SHA-rebound; left untouched: ${relPath}`,
    );
  }
  if (!isJsonObject(parsed)) {
    throw new ProofPreservationError(
      'malformed_evidence_json',
      relPath,
      `Evidence bundle must be a JSON object to be SHA-rebound; left untouched: ${relPath}`,
    );
  }

  const shaBinding = isJsonObject(parsed['sha_binding']) ? parsed['sha_binding'] : undefined;
  const hasLegacyTopLevelMergeSha = typeof parsed['merge_sha'] === 'string';
  if (!shaBinding && !hasLegacyTopLevelMergeSha) {
    // No merge-SHA-bearing field exists to rebind. Nothing is destroyed by
    // doing nothing, so this is not an error — just a no-op.
    return { path: relPath, status: 'unchanged' };
  }

  // UTV2-1631: `sha_binding.merge_sha` and the legacy top-level `merge_sha` are
  // merge-SHA-bearing fields too. Rebinding only `verified_source_sha` left the
  // bundle asserting two different merge identities in the same file, which
  // both P3 and C4 still pass because they only require the authoritative SHA
  // to appear *somewhere*.
  const shaBindingAlreadyBound =
    !shaBinding ||
    (shaBinding['sha_type'] === 'merge_sha' &&
      shaBinding['verified_source_sha'] === mergeSha &&
      (!('merge_sha' in shaBinding) || shaBinding['merge_sha'] === mergeSha));
  const topLevelAlreadyBound = !hasLegacyTopLevelMergeSha || parsed['merge_sha'] === mergeSha;
  if (shaBindingAlreadyBound && topLevelAlreadyBound) {
    // Already bound to this exact merge SHA — leave bound_at alone so re-running
    // ops:proof-generate doesn't perturb an already-correct file (idempotent).
    return { path: relPath, status: 'unchanged' };
  }

  const nextParsed: Record<string, unknown> = { ...parsed };
  if (shaBinding) {
    const nextShaBinding: Record<string, unknown> = {
      ...shaBinding,
      verified_source_sha: mergeSha,
      sha_type: 'merge_sha',
      bound_at: generatedAt,
    };
    if ('merge_sha' in shaBinding) {
      nextShaBinding['merge_sha'] = mergeSha;
    }
    nextParsed['sha_binding'] = nextShaBinding;
  }
  if (hasLegacyTopLevelMergeSha) {
    nextParsed['merge_sha'] = mergeSha;
  }
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
  const nextContent = rebindMergeShaAnchorsInMarkdown(previousContent, mergeSha, prUrl);

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

    // Manual-override provenance must agree too: a sidecar recording
    // override_used: false (or a mismatched authorizer) while the manifest's
    // model_routing.selected_by is 'manual-override' would let the bound
    // routing evidence misrepresent who actually authorized the execution --
    // model/reasoning_effort/profile/policy_version agreement alone does not
    // catch this (independent review finding). Every real sidecar in the
    // repo carries override_used, so its absence is itself a failure here,
    // matching the always-required model/reasoning_effort fields above.
    const sidecarOverrideUsed = parsed['override_used'];
    if (typeof sidecarOverrideUsed !== 'boolean') {
      throw new ModelRoutingRebindError(
        'sidecar_manifest_routing_mismatch',
        relPath,
        `Sidecar override_used must be a boolean to validate against manifest model_routing.selected_by: ${relPath}`,
      );
    }
    const manifestOverrideUsed = manifestRouting.selected_by === 'manual-override';
    if (sidecarOverrideUsed !== manifestOverrideUsed) {
      throw new ModelRoutingRebindError(
        'sidecar_manifest_routing_mismatch',
        relPath,
        `Sidecar override_used ${sidecarOverrideUsed} does not match manifest ` +
          `model_routing.selected_by ${JSON.stringify(manifestRouting.selected_by)}: ${relPath}`,
      );
    }
    if (manifestOverrideUsed) {
      const manifestAuthorizedBy = manifestRouting.override?.authorized_by;
      if (typeof manifestAuthorizedBy !== 'string' || manifestAuthorizedBy.trim() === '') {
        throw new ModelRoutingRebindError(
          'sidecar_manifest_routing_mismatch',
          relPath,
          `Manifest model_routing.selected_by is manual-override but override.authorized_by is missing or empty: ${relPath}`,
        );
      }
      const sidecarAuthorizedBy = parsed['override_authorized_by'];
      if (sidecarAuthorizedBy !== manifestAuthorizedBy) {
        throw new ModelRoutingRebindError(
          'sidecar_manifest_routing_mismatch',
          relPath,
          `Sidecar override_authorized_by ${JSON.stringify(sidecarAuthorizedBy)} does not match ` +
            `manifest model_routing.override.authorized_by ${JSON.stringify(manifestAuthorizedBy)}: ${relPath}`,
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

/**
 * UTV2-1631: decides what to do with an EXISTING standard proof artifact.
 *
 * Before this, the answer was always "overwrite it with a freshly generated
 * `result: not_run` template", guarded only by a two-marker exemption for
 * verification.md. A real measured T1 bundle (7 queries, 8 row counts, a CI
 * verifier identity, ~20KB of assertions) written in the repo's own required
 * `# PROOF:` format matched neither marker, so `post-merge-lane-close.yml`
 * silently replaced it with an 850-byte stub and reported the loss as
 * `stale_paths_replaced`. The lane still read as closed.
 *
 * The rule now: an artifact that exists is authored evidence. It is never
 * regenerated. Only its merge-SHA-bearing fields are rebound, in place. If it
 * carries no bindable merge-SHA anchor and does not already name the
 * authoritative SHA, this throws and the file is left byte-identical —
 * uncertainty must never resolve to overwriting.
 */
function planExistingProofArtifact(
  previousContent: string,
  relPath: string,
  mergeSha: string | null,
  prUrl: string | null,
): { nextContent: string | null } {
  if (!mergeSha) {
    // Pre-merge run: there is no authoritative SHA to bind, so there is
    // nothing this script can legitimately do to an authored artifact.
    return { nextContent: null };
  }

  const rebound = rebindMergeShaAnchorsInMarkdown(previousContent, mergeSha, prUrl);
  if (rebound !== previousContent) {
    return { nextContent: rebound };
  }
  if (previousContent.includes(mergeSha)) {
    // Already names the authoritative merge SHA — nothing to do.
    return { nextContent: null };
  }
  throw new ProofPreservationError(
    'unbindable_proof_artifact',
    relPath,
    `Refusing to overwrite authored proof at ${relPath}: it carries no merge-SHA anchor to rebind ` +
      `to ${mergeSha}, and does not already name it. The file is untouched. Add a "MERGE_SHA: ${mergeSha}" ` +
      `line (or a "Merge SHA:" line / "| Commit SHA(s) |" row) and re-run, or bind it by hand.`,
  );
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
  const preservedPaths: string[] = [];
  const reboundPaths: string[] = [];
  const pushUnique = (paths: string[], proofPath: string): void => {
    if (!paths.includes(proofPath)) {
      paths.push(proofPath);
    }
  };
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
  if (input.gitTruth.merge_sha && options.bindModelRouting) {
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

  // Plan every standard artifact BEFORE writing any of them, so an unbindable
  // authored artifact aborts the whole run with zero mutation rather than
  // leaving half the bundle rewritten — the same validate-then-write ordering
  // the model-routing sidecars above use.
  type StandardPlan = {
    proofPath: string;
    absolutePath: string;
    nextContent: string | null;
    exists: boolean;
  };
  const standardPlans: StandardPlan[] = [];
  for (const proofFile of STANDARD_PROOF_FILES) {
    const proofPath = paths[proofFile];
    const absolutePath = safeRepoPath(root, proofPath);
    const exists = fs.existsSync(absolutePath);

    if (!exists) {
      // Templates are correct behaviour only when no bundle exists yet.
      standardPlans.push({ proofPath, absolutePath, nextContent: contentByFile[proofFile], exists });
      continue;
    }

    const previousContent = fs.readFileSync(absolutePath, 'utf8');
    const { nextContent } = planExistingProofArtifact(
      previousContent,
      proofPath,
      input.gitTruth.merge_sha,
      input.manifest.pr_url,
    );
    standardPlans.push({ proofPath, absolutePath, nextContent, exists });
  }

  // evidence.json is validated (write:false) before anything is written too, so
  // a malformed bundle fails the run without a partially-rebound proof dir.
  rebindMergeSha(
    root,
    input.manifest.issue_id,
    input.gitTruth.merge_sha,
    input.generatedAt,
    input.manifest.pr_url,
    { write: false },
  );

  for (const plan of standardPlans) {
    if (plan.nextContent === null) {
      pushUnique(preservedPaths, plan.proofPath);
      pushUnique(unchangedPaths, plan.proofPath);
      continue;
    }
    if (shouldWrite) {
      ensureDir(path.dirname(plan.absolutePath));
      fs.writeFileSync(plan.absolutePath, plan.nextContent, 'utf8');
    }
    if (plan.exists) {
      pushUnique(preservedPaths, plan.proofPath);
      pushUnique(reboundPaths, plan.proofPath);
      pushUnique(updatedPaths, plan.proofPath);
    } else {
      pushUnique(generatedPaths, plan.proofPath);
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
      pushUnique(preservedPaths, outcome.path);
      pushUnique(reboundPaths, outcome.path);
    } else if (outcome.status === 'unchanged') {
      pushUnique(unchangedPaths, outcome.path);
      pushUnique(preservedPaths, outcome.path);
    }
    // 'missing' outcomes are intentionally not reported — evidence.json/verification.md
    // are optional per lane_type (e.g. T3 lanes have neither); absence is not an error.
  }

  if (input.gitTruth.merge_sha && options.bindModelRouting) {
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
      // A model-routing sidecar is bound by APPENDING an immutable
      // closeout_binding; existing provenance is preserved. That is a rebind,
      // not a replacement, so it belongs in rebound_paths — reporting it as
      // `stale_paths_replaced` was part of the same conflation this lane
      // removes (UTV2-1631).
      if (outcome.status === 'updated') {
        pushUnique(updatedPaths, outcome.path);
        pushUnique(preservedPaths, outcome.path);
        pushUnique(reboundPaths, outcome.path);
      } else if (outcome.status === 'unchanged') {
        pushUnique(unchangedPaths, outcome.path);
        pushUnique(preservedPaths, outcome.path);
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
    // A path that was written cannot also be "unchanged". verification.md is
    // planned here AND re-checked by rebindMergeSha, so without this filter it
    // reported as both (visible in the reproduction of this defect).
    unchanged_paths: unchangedPaths.filter((proofPath) => !updatedPaths.includes(proofPath)),
    stale_paths_replaced: [],
    // A file this run created from a template was not "preserved" — the rebind
    // pass sees it on disk afterwards, so filter it back out.
    preserved_paths: preservedPaths.filter((proofPath) => !generatedPaths.includes(proofPath)),
    rebound_paths: reboundPaths.filter((proofPath) => !generatedPaths.includes(proofPath)),
  };
}

// ── UTV2-1683: mechanical static_proof from the merge SHA's verify run ───────

/** The `ci.yml` job whose success IS the repository's static verification. */
export const VERIFY_JOB_NAME = 'verify';

export interface AutoStaticProofResult {
  attempted: boolean;
  applied: boolean;
  code: string;
  reason?: string;
  evidence_path?: string;
}

/**
 * UTV2-1683 (B): populates `evidence.json`'s `static_proof` from the `verify`
 * job that CI actually ran for this merge SHA.
 *
 * Truth-check P7 requires BOTH `static_proof` and `runtime_proof` to be
 * populated, but nothing in `scripts/` has ever written `static_proof` -- the
 * UTV2-1641 harvest writes only `runtime_proof` and `verifier`. So P7 stayed
 * red even for a lane whose CI was fully green, and the only way to satisfy it
 * was to hand-author the section, which is exactly the narrative proof the
 * truth model exists to eliminate.
 *
 * The binding is deliberately the same one A1 uses for runtime proof: the
 * `verify` job on the merge SHA's own push-to-main run, so `static_proof` and
 * `runtime_proof` describe the same tree. `test_run_logs` carries `merge_sha`
 * because that is what P8 checks.
 *
 * Fails closed and writes NOTHING when the evidence does not exist:
 *   - no `evidence.json`         -> nothing to populate (T2/T3 lanes)
 *   - `static_proof` already set -> never overwritten
 *   - no `verify` job for this SHA, or it did not succeed -> honest failure,
 *     leaving P7 to fail on its own terms rather than asserting a green gate
 *     that never ran.
 */
export function autoPopulateStaticProofFromVerifyRun(
  root: string,
  issueId: string,
  mergeSha: string | null,
  options: HarvestIoOptions & { write?: boolean } = {},
): AutoStaticProofResult {
  if (!mergeSha) {
    return { attempted: false, applied: false, code: 'no_merge_sha' };
  }

  const evidenceRelPath = path.posix.join('docs', '06_status', 'proof', issueId.toUpperCase(), 'evidence.json');
  const evidenceAbsolutePath = safeRepoPath(root, evidenceRelPath);
  if (!fs.existsSync(evidenceAbsolutePath)) {
    return { attempted: false, applied: false, code: 'no_evidence_bundle', evidence_path: evidenceRelPath };
  }

  let existing: Record<string, unknown>;
  try {
    existing = JSON.parse(fs.readFileSync(evidenceAbsolutePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return { attempted: false, applied: false, code: 'evidence_unparseable', evidence_path: evidenceRelPath };
  }

  const existingStaticProof = existing['static_proof'];
  const alreadyPopulated =
    !!existingStaticProof &&
    typeof existingStaticProof === 'object' &&
    Object.keys(existingStaticProof as Record<string, unknown>).length > 0;
  if (alreadyPopulated) {
    return { attempted: false, applied: false, code: 'already_populated', evidence_path: evidenceRelPath };
  }

  const located = findWorkflowJobForHeadSha(mergeSha, VERIFY_JOB_NAME, {
    ...options,
    missingJobCode: 'no_db_proof_job',
  });
  if (!located.ok) {
    return {
      attempted: true,
      applied: false,
      code: located.code === 'no_db_proof_job' ? 'no_verify_job' : located.code,
      reason: located.reason,
      evidence_path: evidenceRelPath,
    };
  }
  if (located.job.conclusion !== 'success') {
    return {
      attempted: true,
      applied: false,
      code: 'verify_job_not_successful',
      reason:
        `the "${VERIFY_JOB_NAME}" job for merge SHA ${mergeSha} concluded ` +
        `"${located.job.conclusion ?? 'null'}", not "success" -- refusing to record a static proof for a gate that did not pass`,
      evidence_path: evidenceRelPath,
    };
  }

  const runUrl = located.run.html_url ?? `https://github.com/${options.repository ?? 'griff843/Unit-Talk-v2'}/actions/runs/${located.run.id}`;
  const jobUrl = located.job.html_url ?? `${runUrl}/job/${located.job.id}`;
  const staticProof = {
    command: 'pnpm verify',
    conclusion: located.job.conclusion,
    workflow: 'CI',
    job: VERIFY_JOB_NAME,
    run_id: located.run.id,
    job_id: located.job.id,
    run_url: runUrl,
    merge_sha: mergeSha,
    test_run_logs: [{ path: jobUrl, merge_sha: mergeSha }],
    note:
      `Harvested automatically by ops:proof-generate (UTV2-1683) from the "${VERIFY_JOB_NAME}" job ` +
      `(run ${located.run.id}, job ${located.job.id}) of the CI run triggered by merge commit ${mergeSha} itself. ` +
      'Not re-run locally -- the recorded conclusion is GitHub\'s, not this host\'s.',
  };

  const next: Record<string, unknown> = { ...existing, static_proof: staticProof };
  if (options.write ?? true) {
    fs.writeFileSync(evidenceAbsolutePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  }
  return { attempted: true, applied: true, code: 'static_proof_populated', evidence_path: evidenceRelPath };
}

// ── UTV2-1641: automatic CI-DB-proof harvest into evidence.json ──────────────

export interface AutoHarvestCiDbProofResult {
  attempted: boolean;
  applied: boolean;
  code: string;
  reason?: string;
  evidence_path?: string;
}

/**
 * UTV2-1641: when a merge SHA is available and `evidence.json` exists but does
 * belongs to the shared contract's app-runtime profile and does not yet carry
 * a populated `runtime_proof` (both `queries` and `row_counts` non-empty),
 * attempts to harvest CI's own genuine "Writable DB proof (staging only)"
 * evidence for that merge SHA and merge it in.
 *
 * This is deliberately best-effort and additive, mirroring
 * `scripts/ops/proof-repair.ts`'s idempotency contract:
 *   - If `evidence.json` doesn't exist at all (T2/T3 lanes, or a T1 lane before
 *     any proof has been authored), this is a no-op -- nothing to harvest into.
 *   - If `runtime_proof` is already populated, this is a no-op (never
 *     overwrites a previously-harvested or hand-authored measurement).
 *   - If no genuine CI receipt/log evidence can be found or verified for this
 *     merge SHA, this returns a specific failure code and writes NOTHING --
 *     `truth-check`'s R1/R2 are left to fail on their own honest terms, which
 *     is the correct outcome for a lane whose CI truly never ran a live DB
 *     proof (e.g. T2/T3, or a CI run that predates this job's existence).
 *   - Migration and static profiles are immutable to this app-runtime harvest.
 *     The manifest lane_type is authoritative through the shared profile
 *     resolver, and an unknown lane type fails closed without harvesting.
 *   - Schema-v2 evidence never receives an author-side verifier identity. Its
 *     verifier provenance comes only from external required-check receipts.
 *     Legacy schema-v1 bundles retain their historical additive behavior.
 *
 * The caller (`main`, and therefore `post-merge-lane-close.yml`'s
 * `pnpm ops:proof-generate ... --merge-sha ...` invocation) treats a failure
 * here as non-fatal: proof-generate's own artifacts were already written
 * successfully by the time this runs, and a harvest miss is not a reason to
 * fail the whole command -- it just means R1/R2 stay failed, same as today,
 * for a genuinely different reason (CI recorded no live DB proof) rather than
 * an operator having simply not gotten to it yet.
 */
export function autoHarvestCiDbProofIntoEvidence(
  root: string,
  issueId: string,
  mergeSha: string | null,
  laneType: string | null | undefined,
  manifestCreatedBy: string | null | undefined,
  options: HarvestCiDbProofOptions & { write?: boolean } = {},
): AutoHarvestCiDbProofResult {
  if (!mergeSha) {
    return { attempted: false, applied: false, code: 'no_merge_sha' };
  }

  const profile = declaredProfileForLaneType(laneType);
  if (!profile) {
    return {
      attempted: false,
      applied: false,
      code: 'unknown_proof_profile',
      reason: `manifest lane_type '${laneType ?? ''}' does not resolve to an authorable proof profile`,
    };
  }
  const evidenceRelPath = path.posix.join('docs', '06_status', 'proof', issueId.toUpperCase(), 'evidence.json');
  const evidenceAbsolutePath = safeRepoPath(root, evidenceRelPath);
  if (!fs.existsSync(evidenceAbsolutePath)) {
    return { attempted: false, applied: false, code: 'no_evidence_bundle', evidence_path: evidenceRelPath };
  }

  let existing: Record<string, unknown>;
  try {
    existing = JSON.parse(fs.readFileSync(evidenceAbsolutePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return { attempted: false, applied: false, code: 'evidence_unparseable', evidence_path: evidenceRelPath };
  }

  // Schema v1 predates proof profiles and retains its additive CI harvest
  // contract even when a modern manifest lane_type maps to migration/static.
  // Profile-aware immutability applies to schema-v2 bundles only.
  if (profile !== 'app-runtime' && existing['schema_version'] !== 1) {
    return { attempted: false, applied: false, code: `profile_${profile}_not_harvested` };
  }

  const existingRuntimeProof = existing['runtime_proof'];
  const existingVerifier = existing['verifier'];
  const hasNonEmptyArray = (value: unknown, key: string): boolean =>
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as Record<string, unknown>)[key]) &&
    ((value as Record<string, unknown>)[key] as unknown[]).length > 0;
  const alreadyPopulated =
    hasNonEmptyArray(existingRuntimeProof, 'queries') && hasNonEmptyArray(existingRuntimeProof, 'row_counts');
  if (alreadyPopulated) {
    return { attempted: false, applied: false, code: 'already_populated', evidence_path: evidenceRelPath };
  }

  const harvested = harvestCiDbProofForMergeSha(mergeSha, { root, ...options });
  if (!harvested.ok) {
    return { attempted: true, applied: false, code: harvested.code, reason: harvested.reason, evidence_path: evidenceRelPath };
  }

  const next: Record<string, unknown> = {
    ...existing,
    runtime_proof: harvested.runtimeProof,
  };
  if (existing['schema_version'] !== 2) {
    const priorIdentity =
      existingVerifier && typeof existingVerifier === 'object' && typeof (existingVerifier as Record<string, unknown>)['identity'] === 'string'
        ? ((existingVerifier as Record<string, unknown>)['identity'] as string)
        : null;
    const harvestNote =
      `runtime_proof auto-harvested by ops:proof-generate from CI job "${harvested.runInfo.job}" ` +
      `(run ${harvested.runInfo.run_id}, job ${harvested.runInfo.job_id})`;
    const identityCandidate = priorIdentity && priorIdentity.trim() ? `${priorIdentity}; ${harvestNote}` : harvestNote;

    if (manifestCreatedBy && identityCandidate === manifestCreatedBy) {
      return {
        attempted: true,
        applied: false,
        code: 'verifier_identity_matches_creator',
        reason: `harvested verifier identity would equal manifest.created_by (${manifestCreatedBy})`,
        evidence_path: evidenceRelPath,
      };
    }
    next['verifier'] = mergeVerifierIdentity(existingVerifier, identityCandidate);
  }
  if (options.write ?? true) {
    fs.writeFileSync(evidenceAbsolutePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  }

  return { attempted: true, applied: true, code: 'harvested', evidence_path: evidenceRelPath };
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
      bindModelRouting: bools.has('bind-model-routing'),
    });
  } catch (error) {
    if (error instanceof ProofPreservationError) {
      // UTV2-1631: an authored proof artifact could not be safely rebound. No
      // proof artifact was mutated (planning runs before any write). Exit
      // non-zero so the caller — including post-merge-lane-close.yml — sees a
      // failure instead of a silently scaffolded bundle.
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

  // UTV2-1641: best-effort auto-harvest of CI's own genuine DB-proof evidence.
  // Never fatal -- proof-generate's own artifacts (above) already succeeded by
  // this point, and a harvest miss just means R1/R2 stay honestly failed for a
  // lane whose CI never produced a live DB proof (T2/T3, or no such CI run).
  let harvestResult: AutoHarvestCiDbProofResult | null = null;
  if (!bools.has('no-harvest-ci-db-proof')) {
    try {
      harvestResult = autoHarvestCiDbProofIntoEvidence(
        ROOT,
        issueId,
        input.gitTruth.merge_sha,
        manifest.lane_type,
        manifest.created_by,
        {
          write: !bools.has('dry-run'),
        },
      );
    } catch (error) {
      harvestResult = {
        attempted: true,
        applied: false,
        code: 'harvest_threw',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // UTV2-1683: same best-effort, never-fatal contract as the DB-proof harvest
  // above. A miss leaves P7 honestly failed for a lane whose CI has no
  // successful verify run on the merge SHA, rather than asserting one.
  let staticProofResult: AutoStaticProofResult | null = null;
  if (!bools.has('no-static-proof')) {
    try {
      staticProofResult = autoPopulateStaticProofFromVerifyRun(ROOT, issueId, input.gitTruth.merge_sha, {
        write: !bools.has('dry-run'),
      });
    } catch (error) {
      staticProofResult = {
        attempted: true,
        applied: false,
        code: 'static_proof_threw',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (bools.has('json')) {
    emitJson({ ...result, ci_db_proof_harvest: harvestResult, static_proof: staticProofResult });
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
    for (const preservedPath of result.preserved_paths) {
      const action = result.rebound_paths.includes(preservedPath) ? 'sha-rebound in place' : 'left byte-identical';
      process.stdout.write(`preserved: ${relativeToRoot(path.resolve(ROOT, preservedPath))} (${action})\n`);
    }
    if (harvestResult) {
      if (harvestResult.applied) {
        process.stdout.write(`ci_db_proof_harvest: applied (${harvestResult.evidence_path})\n`);
      } else if (harvestResult.attempted) {
        process.stdout.write(
          `ci_db_proof_harvest: not applied -- ${harvestResult.code}${harvestResult.reason ? `: ${harvestResult.reason}` : ''}\n`,
        );
      } else {
        process.stdout.write(`ci_db_proof_harvest: skipped (${harvestResult.code})\n`);
      }
    }
    if (staticProofResult) {
      if (staticProofResult.applied) {
        process.stdout.write(`static_proof: applied (${staticProofResult.evidence_path})\n`);
      } else if (staticProofResult.attempted) {
        process.stdout.write(
          `static_proof: not applied -- ${staticProofResult.code}${staticProofResult.reason ? `: ${staticProofResult.reason}` : ''}\n`,
        );
      } else {
        process.stdout.write(`static_proof: skipped (${staticProofResult.code})\n`);
      }
    }
  }

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
