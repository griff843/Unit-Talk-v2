#!/usr/bin/env tsx

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emitJson, getFlag, parseArgs, requireIssueId, ROOT } from './shared.js';

export interface PmVerdictOptions {
  issueId: string;
  prNumber: number | null;
  actor: string | null;
  approve: boolean;
  post: boolean;
  json: boolean;
  dryRun: boolean;
  note: string | null;
}

export interface PmVerdictPayload {
  schema: 'pm-verdict/v1';
  verdict: 'APPROVED';
  issue_id: string;
  pr_number: number;
  actor: string;
  approved_at: string;
  source: 'pnpm ops:pm-verdict';
  approval_boundary: 'comment_only_does_not_bypass_branch_protection';
  note: string | null;
}

export interface PmVerdictResult {
  ok: boolean;
  dry_run: boolean;
  posted: boolean;
  body: string;
  payload: PmVerdictPayload | null;
  failures: string[];
  warnings: string[];
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string },
) => Pick<SpawnSyncReturns<string>, 'status' | 'stdout' | 'stderr'>;

const DEFAULT_ACTOR = 'pm';

export function parsePmVerdictArgs(argv: string[]): PmVerdictOptions {
  const { positionals, flags, bools } = parseArgs(argv.filter((arg) => arg !== '--'));
  const issueId = requireIssueId(positionals[0] ?? '');
  const prRaw = getFlag(flags, 'pr');
  const prNumber = prRaw != null ? Number(prRaw) : null;
  const post = bools.has('post') || flags.has('post');
  const approve = bools.has('approve') || flags.has('approve');
  const dryRun = bools.has('dry-run') || flags.has('dry-run') || !post;

  return {
    issueId,
    prNumber: prNumber != null && Number.isInteger(prNumber) && prNumber > 0 ? prNumber : null,
    actor: getFlag(flags, 'actor') ?? null,
    approve,
    post,
    json: bools.has('json') || flags.has('json'),
    dryRun,
    note: getFlag(flags, 'note') ?? null,
  };
}

export function buildPmVerdictPayload(input: {
  issueId: string;
  prNumber: number;
  actor?: string | null;
  approvedAt?: string;
  note?: string | null;
}): PmVerdictPayload {
  return {
    schema: 'pm-verdict/v1',
    verdict: 'APPROVED',
    issue_id: requireIssueId(input.issueId),
    pr_number: input.prNumber,
    actor: input.actor?.trim() || DEFAULT_ACTOR,
    approved_at: input.approvedAt ?? new Date().toISOString(),
    source: 'pnpm ops:pm-verdict',
    approval_boundary: 'comment_only_does_not_bypass_branch_protection',
    note: input.note?.trim() || null,
  };
}

export function buildPmVerdictBody(payload: PmVerdictPayload): string {
  const lines = [
    'PM_VERDICT: APPROVED',
    'schema: pm-verdict/v1',
    `Issue: ${payload.issue_id}`,
    `PR: #${payload.pr_number}`,
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    'This comment records the structured PM verdict payload only. It does not bypass branch protection, CODEOWNERS, required labels, CI, or merge-mutex policy.',
  ];
  return lines.join('\n');
}

export function runPmVerdict(
  options: PmVerdictOptions,
  runner: CommandRunner = (command, args, runOptions) =>
    spawnSync(command, args, {
      cwd: runOptions.cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      shell: process.platform === 'win32',
    }),
): PmVerdictResult {
  const failures: string[] = [];
  const warnings: string[] = [];

  if (!options.approve) {
    failures.push('Explicit --approve is required before emitting a PM_VERDICT: APPROVED payload.');
  }
  if (options.prNumber == null) {
    failures.push('A positive --pr <number> is required.');
  }
  if (options.post && options.dryRun) {
    warnings.push('--dry-run was supplied with --post; posting skipped.');
  }

  if (failures.length > 0) {
    return {
      ok: false,
      dry_run: options.dryRun,
      posted: false,
      body: '',
      payload: null,
      failures,
      warnings,
    };
  }

  const payload = buildPmVerdictPayload({
    issueId: options.issueId,
    prNumber: options.prNumber ?? 0,
    actor: options.actor,
    note: options.note,
  });
  const body = buildPmVerdictBody(payload);

  if (!options.post || options.dryRun) {
    if (!options.post) {
      warnings.push('Dry-run default: use --post with --approve to post this comment to GitHub.');
    }
    return {
      ok: true,
      dry_run: true,
      posted: false,
      body,
      payload,
      failures,
      warnings,
    };
  }

  const result = runner('gh', ['pr', 'comment', String(payload.pr_number), '--body', body], { cwd: ROOT });
  const exitCode = result.status ?? 1;
  if (exitCode !== 0) {
    failures.push((result.stderr ?? '').trim() || `gh pr comment exited ${exitCode}`);
  }

  return {
    ok: failures.length === 0,
    dry_run: false,
    posted: failures.length === 0,
    body,
    payload,
    failures,
    warnings,
  };
}

function printHuman(result: PmVerdictResult): void {
  if (result.failures.length > 0) {
    console.log('PM verdict helper failed:');
    for (const failure of result.failures) {
      console.log(`  FAIL ${failure}`);
    }
    return;
  }

  console.log(result.body);
  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of result.warnings) {
      console.log(`  WARN ${warning}`);
    }
  }
  console.log(`\nPosted: ${result.posted ? 'yes' : 'no'}${result.dry_run ? ' (dry-run)' : ''}`);
}

function main(): void {
  const options = parsePmVerdictArgs(process.argv.slice(2));
  const result = runPmVerdict(options);
  if (options.json) {
    emitJson(result);
  } else {
    printHuman(result);
  }
  process.exitCode = result.ok ? 0 : 1;
}

const isDirectRun = process.argv[1] != null
  && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(`[pm-verdict] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
