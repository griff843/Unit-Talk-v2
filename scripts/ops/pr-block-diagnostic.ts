import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { emitJson, getFlag, parseArgs, ROOT } from './shared.js';

export interface CheckObservation {
  name: string;
  conclusion: string | null;
  status?: string | null;
  sha: string;
  completed_at?: string | null;
}

export interface PrBlockDiagnosticInput {
  pr: number;
  merge_state_status: string;
  branch_protection_required_checks: string[];
  head_sha: string;
  checks: CheckObservation[];
}

export interface PrBlockDiagnostic {
  schema_version: 1;
  pr: number;
  merge_state_status: string;
  required_checks: string[];
  latest_required: Array<{
    name: string;
    conclusion: string | null;
    status: string | null;
    sha: string | null;
  }>;
  duplicate_contexts: Array<{ name: string; count: number }>;
  stale_failed_contexts: Array<{ name: string; sha: string; conclusion: string | null }>;
  verdict: 'PASS' | 'BLOCKED';
  blockers: string[];
}

export function buildPrBlockDiagnostic(input: PrBlockDiagnosticInput): PrBlockDiagnostic {
  const byName = new Map<string, CheckObservation[]>();
  for (const check of input.checks) {
    const bucket = byName.get(check.name) ?? [];
    bucket.push(check);
    byName.set(check.name, bucket);
  }

  const latestRequired = input.branch_protection_required_checks.map((name) => {
    const allChecks = [...(byName.get(name) ?? [])].sort(compareChecksDesc);
    const headChecks = allChecks.filter((check) => check.sha === input.head_sha);
    const checks = headChecks.length > 0 ? headChecks : allChecks;
    const latest = checks[0];
    return {
      name,
      conclusion: latest?.conclusion ?? null,
      status: latest?.status ?? null,
      sha: latest?.sha ?? null,
    };
  });

  const duplicateContexts = [...byName.entries()]
    .filter(([, checks]) => checks.length > 1)
    .map(([name, checks]) => ({ name, count: checks.length }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const staleFailedContexts = [...byName.entries()].flatMap(([name, checks]) => {
    const latest = [...checks]
      .filter((check) => check.sha === input.head_sha)
      .sort(compareChecksDesc)[0];
    return checks
      .filter((check) => check !== latest)
      .filter((check) => check.sha !== input.head_sha)
      .filter((check) => check.conclusion === 'failure' || check.conclusion === 'cancelled' || check.conclusion === 'timed_out')
      .map((check) => ({ name, sha: check.sha, conclusion: check.conclusion }));
  });

  const blockers = latestRequired
    .filter((check) => check.conclusion !== 'success' && check.conclusion !== 'neutral' && check.conclusion !== 'skipped')
    .map((check) => `required check not passing: ${check.name} (${check.conclusion ?? check.status ?? 'missing'})`);
  if (input.merge_state_status === 'BLOCKED' && blockers.length === 0 && staleFailedContexts.length > 0) {
    blockers.push('mergeStateStatus is BLOCKED with stale failed duplicate contexts present');
  }

  return {
    schema_version: 1,
    pr: input.pr,
    merge_state_status: input.merge_state_status,
    required_checks: input.branch_protection_required_checks,
    latest_required: latestRequired,
    duplicate_contexts: duplicateContexts,
    stale_failed_contexts: staleFailedContexts,
    verdict: blockers.length === 0 ? 'PASS' : 'BLOCKED',
    blockers,
  };
}

function compareChecksDesc(left: CheckObservation, right: CheckObservation): number {
  const leftTime = Date.parse(left.completed_at ?? '') || 0;
  const rightTime = Date.parse(right.completed_at ?? '') || 0;
  return rightTime - leftTime;
}

function runGhJson(args: string[]): unknown {
  const result = spawnSync('gh', args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) {
    throw new Error(result.stderr || `gh ${args.join(' ')} failed`);
  }
  return JSON.parse(result.stdout) as unknown;
}

function main(): void {
  const { flags } = parseArgs(process.argv.slice(2));
  const pr = Number.parseInt(getFlag(flags, 'pr') ?? '', 10);
  if (!Number.isFinite(pr)) {
    throw new Error('Usage: pnpm ops:pr-block-diagnostic --pr <number>');
  }
  const prData = runGhJson(['pr', 'view', String(pr), '--json', 'mergeStateStatus,headRefOid,statusCheckRollup']) as {
    mergeStateStatus?: string;
    headRefOid?: string;
    statusCheckRollup?: Array<{ name?: string; conclusion?: string | null; status?: string | null; completedAt?: string | null }>;
  };
  const protection = runGhJson(['api', 'repos/{owner}/{repo}/branches/main/protection/required_status_checks']) as {
    contexts?: string[];
    checks?: Array<{ context?: string }>;
  };
  const required = [
    ...(protection.contexts ?? []),
    ...(protection.checks ?? []).map((check) => check.context).filter((entry): entry is string => Boolean(entry)),
  ];
  emitJson(buildPrBlockDiagnostic({
    pr,
    merge_state_status: prData.mergeStateStatus ?? 'UNKNOWN',
    branch_protection_required_checks: [...new Set(required)],
    head_sha: prData.headRefOid ?? '',
    checks: (prData.statusCheckRollup ?? []).map((check) => ({
      name: check.name ?? 'unknown',
      conclusion: check.conclusion ?? null,
      status: check.status ?? null,
      sha: prData.headRefOid ?? '',
      completed_at: check.completedAt ?? null,
    })),
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    emitJson({
      schema_version: 1,
      verdict: 'BLOCKED',
      blockers: [error instanceof Error ? error.message : String(error)],
    });
    process.exitCode = 1;
  }
}
