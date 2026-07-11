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

export interface ProofGenerateOptions {
  root?: string;
  write?: boolean;
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

function safeRepoPath(root: string, repoRelativePath: string): string {
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
  const result = generateProofArtifacts(input, { root: ROOT, write: !bools.has('dry-run') });

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
