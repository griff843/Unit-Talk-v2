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

type ProofArtifactName = 'diff-summary.md' | 'runtime-verification.md';

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

export interface ProofGenerateOptions {
  root?: string;
  write?: boolean;
}

type GitRunner = (args: string[], cwd?: string) => { ok: boolean; stdout: string; stderr: string };

const STANDARD_PROOF_FILES: ProofArtifactName[] = ['diff-summary.md', 'runtime-verification.md'];
const DEFAULT_VERIFICATION_COMMANDS = ['pnpm type-check', 'pnpm test'];

export function standardProofPaths(issueId: string): Record<ProofArtifactName, string> {
  const proofRoot = path.posix.join('docs', '06_status', 'proof', issueId.toUpperCase());
  return {
    'diff-summary.md': path.posix.join(proofRoot, 'diff-summary.md'),
    'runtime-verification.md': path.posix.join(proofRoot, 'runtime-verification.md'),
  };
}

export function collectProofGitTruth(
  manifest: LaneManifest,
  options: { root?: string; gitRunner?: GitRunner } = {},
): ProofGitTruth {
  const root = options.root ?? ROOT;
  const runGit = options.gitRunner ?? git;
  const worktreePath = path.resolve(root, manifest.worktree_path);
  const hasWorktree = fs.existsSync(worktreePath);
  const cwd = hasWorktree ? worktreePath : root;
  const headSha = firstGitStdout(
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
  const mergeSha = manifest.commit_sha?.trim() || null;
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

export function generateProofArtifacts(
  input: ProofGenerateInput,
  options: ProofGenerateOptions = {},
): ProofGenerateResult {
  const root = options.root ?? ROOT;
  const shouldWrite = options.write ?? true;
  const contentByFile: Record<ProofArtifactName, string> = {
    'diff-summary.md': buildDiffSummary(input),
    'runtime-verification.md': buildRuntimeVerification(input),
  };
  const paths = standardProofPaths(input.manifest.issue_id);
  const generatedPaths: string[] = [];
  const updatedPaths: string[] = [];
  const unchangedPaths: string[] = [];
  const stalePathsReplaced: string[] = [];
  const requiredShas = [input.gitTruth.head_sha, input.gitTruth.merge_sha].filter(isPresent);

  for (const proofFile of STANDARD_PROOF_FILES) {
    const proofPath = paths[proofFile];
    const absolutePath = safeRepoPath(root, proofPath);
    const nextContent = contentByFile[proofFile];
    const exists = fs.existsSync(absolutePath);
    const previousContent = exists ? fs.readFileSync(absolutePath, 'utf8') : null;
    const stale = previousContent !== null &&
      requiredShas.some((sha) => !previousContent.includes(sha));

    if (previousContent === nextContent) {
      unchangedPaths.push(proofPath);
      continue;
    }

    if (shouldWrite) {
      ensureDir(path.dirname(absolutePath));
      fs.writeFileSync(absolutePath, nextContent, 'utf8');
    }

    if (!exists) {
      generatedPaths.push(proofPath);
    } else {
      updatedPaths.push(proofPath);
      if (stale) {
        stalePathsReplaced.push(proofPath);
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
  const manifest = readManifest(issueId);
  const input: ProofGenerateInput = {
    manifest,
    generatedAt: new Date().toISOString(),
    gitTruth: collectProofGitTruth(manifest),
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
