import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';
import { ROOT, readManifest, type LaneManifest } from './shared.js';

export interface ProofArtifactChecklistEntry {
  artifact: string;
  present: boolean;
}

export interface CiStatusSummaryEntry {
  name: string;
  status: 'pass' | 'fail' | 'pending';
}

export interface RLevelCompliance {
  status: 'PASS' | 'FAIL' | 'UNKNOWN';
  reason: string;
}

export interface PRReviewPacket {
  issue_id: string;
  pr_number: number;
  pr_url: string;
  title: string;
  branch: string;
  tier: string;
  tier_label_present: boolean;
  file_scope_summary: string[];
  tier_c_paths: string[];
  scope_bleed: string[];
  r_level_compliance: RLevelCompliance;
  proof_artifact_checklist: ProofArtifactChecklistEntry[];
  ci_status_summary: CiStatusSummaryEntry[];
  merge_order_notes: string;
  missing_tier_label: boolean;
  missing_proof: boolean;
}

interface GitHubLabel {
  name: string;
}

interface GitHubFile {
  path: string;
}

interface GitHubStatusCheck {
  __typename?: string | null;
  conclusion?: string | null;
  status?: string | null;
  name?: string | null;
  context?: string | null;
  workflowName?: string | null;
}

interface PullRequestSnapshot {
  number: number;
  url: string;
  title: string;
  headRefName: string;
  labels: GitHubLabel[];
  files: GitHubFile[];
  statusCheckRollup?: GitHubStatusCheck[] | null;
}

export interface PacketInput {
  issue_id: string;
  pr_number?: number;
  prebuilt?: {
    manifest: LaneManifest;
    pull_request: PullRequestSnapshot;
    present_proof_paths?: string[];
    r_level_compliance?: RLevelCompliance;
  };
}

const TIER_LABEL_PATTERN = /^tier:T[123]$/;
const PASS_STATES = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const FAIL_STATES = new Set([
  'FAILURE',
  'ERROR',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
]);
const PENDING_STATES = new Set([
  'PENDING',
  'IN_PROGRESS',
  'QUEUED',
  'EXPECTED',
  'REQUESTED',
  'WAITING',
]);

export async function generatePRReviewPacket(input: PacketInput): Promise<PRReviewPacket> {
  const manifest = input.prebuilt?.manifest ?? readManifest(input.issue_id);
  const pullRequest = input.prebuilt?.pull_request ?? readPullRequest(input.pr_number, manifest);
  const changedFiles = normalizePaths(pullRequest.files.map((file) => file.path));
  const tierLabel = pullRequest.labels
    .map((label) => label.name)
    .find((name) => TIER_LABEL_PATTERN.test(name));
  const proofArtifactChecklist = buildProofArtifactChecklist(
    manifest,
    input.prebuilt?.present_proof_paths,
  );
  const rLevelCompliance = input.prebuilt?.r_level_compliance ?? readRLevelCompliance();

  return {
    issue_id: manifest.issue_id,
    pr_number: pullRequest.number,
    pr_url: pullRequest.url,
    title: pullRequest.title,
    branch: pullRequest.headRefName,
    tier: tierLabel?.replace('tier:', '') ?? manifest.tier,
    tier_label_present: tierLabel !== undefined,
    file_scope_summary: changedFiles,
    tier_c_paths: changedFiles.filter(isTierCPath),
    scope_bleed: changedFiles.filter((filePath) => !matchesAnyScopeLock(filePath, manifest.file_scope_lock)),
    r_level_compliance: rLevelCompliance,
    proof_artifact_checklist: proofArtifactChecklist,
    ci_status_summary: summarizeChecks(pullRequest.statusCheckRollup ?? []),
    merge_order_notes: manifest.notes ?? '',
    missing_tier_label: tierLabel === undefined,
    missing_proof: proofArtifactChecklist.some((entry) => !entry.present),
  };
}

function buildProofArtifactChecklist(
  manifest: LaneManifest,
  presentProofPaths?: string[],
): ProofArtifactChecklistEntry[] {
  const presentSet = presentProofPaths
    ? new Set(normalizePaths(presentProofPaths))
    : null;

  return normalizePaths(manifest.expected_proof_paths).map((artifact) => ({
    artifact,
    present: presentSet
      ? presentSet.has(artifact)
      : fs.existsSync(path.join(ROOT, artifact)),
  }));
}

function summarizeChecks(checks: GitHubStatusCheck[]): CiStatusSummaryEntry[] {
  return checks
    .map((check) => {
      const name = check.name ?? check.context ?? check.workflowName ?? check.__typename ?? 'unknown';
      const rawState = (check.conclusion ?? check.status ?? 'UNKNOWN').toUpperCase();
      return {
        name,
        status: normalizeCheckStatus(rawState),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeCheckStatus(state: string): 'pass' | 'fail' | 'pending' {
  if (PASS_STATES.has(state)) {
    return 'pass';
  }
  if (FAIL_STATES.has(state)) {
    return 'fail';
  }
  if (PENDING_STATES.has(state)) {
    return 'pending';
  }
  return 'pending';
}

function matchesAnyScopeLock(filePath: string, scopeLock: string[]): boolean {
  return scopeLock.some((pattern) => {
    const normalizedPattern = normalizePath(pattern);
    if (normalizedPattern.endsWith('/')) {
      return filePath.startsWith(normalizedPattern);
    }
    return micromatch.isMatch(filePath, normalizedPattern, { dot: true });
  });
}

function isTierCPath(filePath: string): boolean {
  return (
    filePath.startsWith('packages/domain/') ||
    filePath.startsWith('packages/config/') ||
    (filePath.startsWith('supabase/migrations/') && filePath.endsWith('.sql'))
  );
}

function readPullRequest(prNumber: number | undefined, manifest: LaneManifest): PullRequestSnapshot {
  const selector = prNumber ?? readPrNumberFromManifest(manifest);
  const fields = [
    'number',
    'url',
    'title',
    'headRefName',
    'labels',
    'files',
    'statusCheckRollup',
  ].join(',');
  const stdout = execSync(
    `gh pr view ${quoteForShell(String(selector))} --json ${fields}`,
    {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return JSON.parse(stdout) as PullRequestSnapshot;
}

function readPrNumberFromManifest(manifest: LaneManifest): number {
  const prUrl = manifest.pr_url;
  if (!prUrl) {
    throw new Error(`No pr_number provided and manifest ${manifest.issue_id} has no pr_url`);
  }

  const match = /\/pull\/(\d+)(?:\/|$)/.exec(prUrl);
  if (!match) {
    throw new Error(`Unable to parse PR number from manifest pr_url: ${prUrl}`);
  }

  return Number.parseInt(match[1] ?? '', 10);
}

function readRLevelCompliance(): RLevelCompliance {
  const command = 'npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD';
  try {
    const stdout = execSync(command, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return {
      status: stdout.includes('Verdict: PASS') ? 'PASS' : 'UNKNOWN',
      reason: firstNonEmptyLine(stdout) ?? 'r-level-check completed without a parseable verdict',
    };
  } catch (error) {
    if (!hasRLevelCheckScript()) {
      return {
        status: 'UNKNOWN',
        reason: 'scripts/ci/r-level-check.ts is unavailable',
      };
    }

    const stderr = extractExecErrorOutput(error);
    if (stderr.includes('Verdict: FAIL')) {
      return {
        status: 'FAIL',
        reason: firstNonEmptyLine(stderr) ?? 'r-level-check reported FAIL',
      };
    }

    return {
      status: 'UNKNOWN',
      reason: firstNonEmptyLine(stderr) ?? 'unable to determine r-level compliance',
    };
  }
}

function hasRLevelCheckScript(): boolean {
  return fs.existsSync(path.join(ROOT, 'scripts', 'ci', 'r-level-check.ts'));
}

function extractExecErrorOutput(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const withStreams = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer };
  return [withStreams.stdout, withStreams.stderr]
    .map((value) => {
      if (typeof value === 'string') {
        return value;
      }
      if (Buffer.isBuffer(value)) {
        return value.toString('utf8');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function firstNonEmptyLine(input: string): string | undefined {
  return input
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
}

function normalizePaths(paths: string[]): string[] {
  return [...new Set(paths.map(normalizePath))].sort((left, right) => left.localeCompare(right));
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function quoteForShell(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}
