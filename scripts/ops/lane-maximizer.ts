import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface LaneManifest {
  schema_version: number;
  issue_id: string;
  lane_type: string;
  executor: 'claude' | 'codex-cli';
  tier: 'T1' | 'T2' | 'T3';
  branch: string;
  base_branch: string;
  status: 'started' | 'done' | 'blocked';
  file_scope_lock: string[];
  blocked_by: string[];
  commit_sha: string | null;
  pr_url: string | null;
}

export interface CandidateLane {
  issue_id: string;
  tier: 'T1' | 'T2' | 'T3';
  executor: 'claude' | 'codex-cli';
  file_scope: string[];
  blocked_by: string[];
}

export type RecommendDecision = 'recommended' | 'blocked' | 'risky' | 'deferred';

export interface RecommendationResult {
  issue_id: string;
  decision: RecommendDecision;
  reason_codes: string[];
  reasons: string[];
}

export interface DispatchLimits {
  max_claude: number;
  max_codex: number;
  active_claude: number;
  active_codex: number;
  claude_available: boolean;
  codex_available: boolean;
}

export interface MaximizationReport {
  generated_at: string;
  dispatch_limits: DispatchLimits;
  recommended: RecommendationResult[];
  blocked: RecommendationResult[];
  risky: RecommendationResult[];
  deferred: RecommendationResult[];
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LANE_DIR = path.join(ROOT, 'docs', '06_status', 'lanes');

const REASON_MESSAGES: Record<string, string> = {
  OVERLAP: 'Candidate file scope overlaps an active lane lock.',
  BLOCKED_DEP: 'Candidate is blocked by one or more incomplete dependencies.',
  DISPATCH_LIMIT_CLAUDE: 'Claude executor has no remaining dispatch capacity.',
  DISPATCH_LIMIT_CODEX: 'Codex executor has no remaining dispatch capacity.',
  TIER_C_PATH: 'Candidate touches a Tier C path and should be treated as risky.',
  MIGRATION_PATH: 'Candidate touches a migration-sensitive path and is fail-closed blocked.',
  T1_REQUIRES_PM: 'T1 work requires PM authorization before recommendation.',
};

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

function overlapsPath(left: string, right: string): boolean {
  const lhs = normalizePath(left);
  const rhs = normalizePath(right);
  return lhs === rhs || lhs.startsWith(`${rhs}/`) || rhs.startsWith(`${lhs}/`);
}

function isMigrationPath(fileScope: string): boolean {
  const normalized = normalizePath(fileScope);
  return (
    normalized.startsWith('supabase/migrations/') ||
    normalized.startsWith('packages/database/') ||
    normalized.endsWith('/database.types.ts') ||
    normalized === 'database.types.ts' ||
    normalized.endsWith('/schema.generated.ts') ||
    normalized === 'schema.generated.ts'
  );
}

function isTierCPath(fileScope: string): boolean {
  const normalized = normalizePath(fileScope);
  return (
    normalized.startsWith('packages/') ||
    normalized.startsWith('apps/api/') ||
    normalized.startsWith('apps/worker/') ||
    normalized.startsWith('apps/ingestor/')
  );
}

function buildResult(
  issueId: string,
  decision: RecommendDecision,
  reasonCode?: keyof typeof REASON_MESSAGES,
): RecommendationResult {
  if (!reasonCode) {
    return {
      issue_id: issueId,
      decision,
      reason_codes: [],
      reasons: [],
    };
  }

  return {
    issue_id: issueId,
    decision,
    reason_codes: [reasonCode],
    reasons: [REASON_MESSAGES[reasonCode]],
  };
}

function readLaneManifests(dir: string = LANE_DIR): LaneManifest[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => path.join(dir, entry))
    .map((filePath) => {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8')) as LaneManifest;
      } catch {
        return null;
      }
    })
    .filter((manifest): manifest is LaneManifest => manifest !== null);
}

function readActiveLanes(dir: string = LANE_DIR): LaneManifest[] {
  return readLaneManifests(dir).filter(
    (manifest) => manifest.status === 'started' && manifest.commit_sha === null,
  );
}

function readDoneIssueIds(dir: string = LANE_DIR): Set<string> {
  return new Set(
    readLaneManifests(dir)
      .filter((manifest) => manifest.status === 'done')
      .map((manifest) => manifest.issue_id),
  );
}

function parseCandidatesArg(argv: string[]): CandidateLane[] {
  const index = argv.indexOf('--candidates');
  if (index === -1) {
    const stdin = fs.readFileSync(0, 'utf8').trim();
    if (stdin.length === 0) {
      return [];
    }
    return JSON.parse(stdin) as CandidateLane[];
  }

  const raw = argv[index + 1] ?? '[]';
  return JSON.parse(raw) as CandidateLane[];
}

function parseLimits(argv: string[]): { maxClaude: number; maxCodex: number } {
  const getNumberFlag = (name: string, fallback: number): number => {
    const index = argv.indexOf(name);
    if (index === -1) {
      return fallback;
    }
    const raw = Number.parseInt(argv[index + 1] ?? '', 10);
    return Number.isFinite(raw) ? raw : fallback;
  };

  return {
    maxClaude: getNumberFlag('--max-claude', 1),
    maxCodex: getNumberFlag('--max-codex', 2),
  };
}

export function evaluateCandidates(
  candidates: CandidateLane[],
  activeLanes: LaneManifest[],
  limits: { maxClaude: number; maxCodex: number },
): MaximizationReport {
  const doneIssueIds = readDoneIssueIds();
  const activeClaude = activeLanes.filter((lane) => lane.executor === 'claude').length;
  const activeCodex = activeLanes.filter((lane) => lane.executor === 'codex-cli').length;

  const report: MaximizationReport = {
    generated_at: new Date().toISOString(),
    dispatch_limits: {
      max_claude: limits.maxClaude,
      max_codex: limits.maxCodex,
      active_claude: activeClaude,
      active_codex: activeCodex,
      claude_available: activeClaude < limits.maxClaude,
      codex_available: activeCodex < limits.maxCodex,
    },
    recommended: [],
    blocked: [],
    risky: [],
    deferred: [],
  };

  for (const candidate of candidates) {
    const fileScope = candidate.file_scope.map(normalizePath);
    const hasIncompleteDependency = candidate.blocked_by.some((issueId) => !doneIssueIds.has(issueId));
    if (hasIncompleteDependency) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'BLOCKED_DEP'));
      continue;
    }

    if (fileScope.some(isMigrationPath)) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'MIGRATION_PATH'));
      continue;
    }

    if (candidate.tier === 'T1') {
      report.deferred.push(buildResult(candidate.issue_id, 'deferred', 'T1_REQUIRES_PM'));
      continue;
    }

    if (candidate.executor === 'claude' && activeClaude >= limits.maxClaude) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'DISPATCH_LIMIT_CLAUDE'));
      continue;
    }

    if (candidate.executor === 'codex-cli' && activeCodex >= limits.maxCodex) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'DISPATCH_LIMIT_CODEX'));
      continue;
    }

    const overlaps = fileScope.some((candidatePath) =>
      activeLanes.some((lane) => lane.file_scope_lock.some((lockedPath) => overlapsPath(candidatePath, lockedPath))),
    );
    if (overlaps) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'OVERLAP'));
      continue;
    }

    if (fileScope.some(isTierCPath)) {
      report.risky.push(buildResult(candidate.issue_id, 'risky', 'TIER_C_PATH'));
      continue;
    }

    report.recommended.push(buildResult(candidate.issue_id, 'recommended'));
  }

  return report;
}

function runCli(): void {
  let candidates: CandidateLane[] = [];
  let activeLanes: LaneManifest[] = [];
  let limits = { maxClaude: 1, maxCodex: 2 };

  try {
    candidates = parseCandidatesArg(process.argv.slice(2));
    activeLanes = readActiveLanes();
    limits = parseLimits(process.argv.slice(2));
  } catch {
    candidates = [];
    activeLanes = [];
    limits = { maxClaude: 1, maxCodex: 2 };
  }

  const report = evaluateCandidates(candidates, activeLanes, limits);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 0;
}

const argv1 = process.argv[1] ?? '';
if (argv1.endsWith('lane-maximizer.ts') || argv1.endsWith('lane-maximizer.js')) {
  runCli();
}
