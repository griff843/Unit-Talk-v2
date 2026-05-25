import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageTouchingLaneRequiresSingleton } from './lane-execution.js';
import { loadConcurrencyConfig } from './concurrency-config.js';
import { ACTIVE_LOCK_STATUSES, readConfiguredEnvValue, resolveLaneExecutor } from './shared.js';
import { linearQuery } from './linear-client.js';

export interface LaneManifest {
  schema_version: number;
  issue_id: string;
  lane_type: string;
  executor: 'claude' | 'codex-cli' | 'codex-cloud';
  tier: 'T1' | 'T2' | 'T3';
  branch: string;
  base_branch: string;
  status: 'started' | 'in_progress' | 'in_review' | 'merged' | 'done' | 'blocked' | 'reopened';
  file_scope_lock: string[];
  blocked_by: string[];
  commit_sha: string | null;
  pr_url: string | null;
}

export interface CandidateLane {
  issue_id: string;
  tier: 'T1' | 'T2' | 'T3';
  executor: 'claude' | 'codex-cli';
  title?: string;
  branch?: string;
  lane_type?: string;
  work_class?: string;
  file_scope: string[];
  blocked_by: string[];
  isolated_install_verified?: boolean;
  has_acceptance_criteria?: boolean;
  labels?: string[];
  url?: string;
}

export type RecommendDecision = 'recommended' | 'blocked' | 'risky' | 'deferred';

export interface RecommendationResult {
  issue_id: string;
  decision: RecommendDecision;
  reason_codes: string[];
  reasons: string[];
  rank?: number;
  ranking_score?: number;
  ranking_reasons?: string[];
}

export interface DispatchLimits {
  max_claude: number;
  max_codex: number;
  active_claude: number;
  active_codex: number;
  claude_available: boolean;
  codex_available: boolean;
}

export interface DispatchPlanEntry {
  issue_id: string;
  executor: 'claude' | 'codex-cli';
  lane_type: string;
  work_class: string;
  file_scope: string[];
  slot_index: number;
  explanation: string;
  dispatch_command: string;
}

export interface LaneSaturationForecast {
  executors: {
    claude: {
      max: number;
      active: number;
      available_slots: number;
    };
    codex: {
      max: number;
      active: number;
      available_slots: number;
    };
  };
  active_singletons: string[];
  forbidden_combinations_active: string[][];
  safe_class_recommendations: string[];
}

export interface DispatchPlan {
  fill_now: DispatchPlanEntry[];
  lane_saturation_forecast: LaneSaturationForecast;
}

export interface EvaluateCandidateOptions {
  doneIssueIds?: Set<string>;
  singletonLaneTypes?: string[];
  forbiddenCombinations?: [string, string][];
}

export interface MaximizationReport {
  generated_at: string;
  dispatch_limits: DispatchLimits;
  dispatch_plan: DispatchPlan;
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
  SINGLETON_ACTIVE: 'Candidate lane type is singleton and already active.',
  FORBIDDEN_COMBINATION: 'Candidate lane type is forbidden alongside an active lane type.',
  ISOLATED_INSTALL_REQUIRED:
    'Package/API/worker/ingestor lanes stay singleton until isolated install is proven green in the lane cwd.',
  MISSING_FILE_SCOPE:
    'Candidate does not declare a file scope, so overlap and singleton path checks cannot be proven before lane start.',
  MISSING_ACCEPTANCE_CRITERIA:
    'Candidate does not include acceptance criteria, so it is not safe to dispatch automatically.',
};

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
  return slug || 'lane';
}

function deriveBranchName(candidate: CandidateLane): string {
  if (candidate.branch) {
    return candidate.branch;
  }
  const owner = candidate.executor === 'claude' ? 'claude' : 'codex';
  const issue = candidate.issue_id.toLowerCase();
  const title = slugify(candidate.title ?? candidate.issue_id);
  return `${owner}/${issue}-${title}`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function hasAcceptanceCriteria(text: string | null | undefined): boolean {
  return Boolean(text && /acceptance\s+criteria|(?:^|\n)\s*AC:/i.test(text));
}

function extractFileScopeFromText(text: string | null | undefined): string[] {
  if (!text) {
    return [];
  }

  const lines = text.split(/\r?\n/);
  const scopes: string[] = [];
  let inScopeBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^(?:#+\s*)?(allowed\s+file\s+scope|file\s+scope|files\s+changed|allowed\s+paths)\b/i.test(line)) {
      inScopeBlock = true;
      const inline = line.split(/:|-/).slice(1).join('-').trim();
      if (inline) {
        scopes.push(...inline.split(/[, ]+/));
      }
      continue;
    }

    if (inScopeBlock && line.length === 0) {
      break;
    }

    if (inScopeBlock && /^(?:#+\s*)?[A-Z][A-Za-z0-9 /-]+:?\s*$/.test(line) && !line.startsWith('-')) {
      break;
    }

    if (inScopeBlock) {
      const bullet = line.match(/^[-*]\s+`?([^`]+?)`?\s*$/);
      if (bullet) {
        scopes.push(bullet[1].trim());
        continue;
      }
      const code = line.match(/^`([^`]+)`$/);
      if (code) {
        scopes.push(code[1].trim());
      }
    }
  }

  return Array.from(
    new Set(
      scopes
        .flatMap((scope) => scope.split(/,\s*/))
        .map((scope) => normalizePath(scope.replace(/^`|`$/g, '').trim()))
        .filter((scope) => scope.length > 0 && scope !== '-' && scope !== '—'),
    ),
  );
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

function inferLaneType(fileScope: string[]): string {
  const searchable = fileScope.map(normalizePath).join(' ');
  if (/supabase\/migrations|schema|database\.types/.test(searchable)) return 'migration';
  if (/apps\/worker|apps\/api|distribution|outbox|runtime/.test(searchable)) return 'runtime';
  if (/model|scoring|calibration/.test(searchable)) return 'modeling';
  if (/canonical|taxonomy|reference-data/.test(searchable)) return 'data-canonical';
  if (/docs\/governance|policy|governance/.test(searchable)) return 'governance';
  if (/test|verification|proof/.test(searchable)) return 'verification';
  return 'hygiene';
}

function inferLaneTypeFromLabels(labels: string[] = [], title = ''): string | null {
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  const executorLabels = new Set(['lane:codex', 'lane:codex-cli', 'lane:codex-cloud', 'lane:claude']);
  const explicit = normalizedLabels.find((label) =>
    (label.startsWith('ops:lane:') || label.startsWith('lane:')) && !executorLabels.has(label)
  );
  if (explicit) {
    return explicit.replace(/^ops:/, '').slice('lane:'.length);
  }

  const searchable = `${normalizedLabels.join(' ')} ${title}`.toLowerCase();
  if (/migration|schema|supabase/.test(searchable)) return 'migration';
  if (/runtime|worker|api|delivery|outbox/.test(searchable)) return 'runtime';
  if (/model|scoring|calibration/.test(searchable)) return 'modeling';
  if (/canonical|reference data|taxonomy/.test(searchable)) return 'data-canonical';
  if (/governance|policy|alignment/.test(searchable)) return 'governance';
  if (/verification|proof|test/.test(searchable)) return 'verification';
  if (/hygiene|cleanup|ops|tooling|ci/.test(searchable)) return 'hygiene';
  return null;
}

function inferWorkClass(laneType: string, singletonLaneTypes: string[]): string {
  return singletonLaneTypes.includes(laneType) ? 'singleton' : 'safe';
}

function activeLaneTypes(activeLanes: LaneManifest[]): string[] {
  return Array.from(new Set(activeLanes.map((lane) => lane.lane_type).filter(Boolean))).sort();
}

function hasForbiddenCombination(
  laneType: string,
  activeTypes: string[],
  forbiddenCombinations: [string, string][],
): boolean {
  return forbiddenCombinations.some(([left, right]) =>
    (left === laneType && activeTypes.includes(right)) || (right === laneType && activeTypes.includes(left)),
  );
}

function activeForbiddenCombinations(
  activeTypes: string[],
  forbiddenCombinations: [string, string][],
): string[][] {
  return forbiddenCombinations.filter(([left, right]) => activeTypes.includes(left) && activeTypes.includes(right));
}

function buildResult(
  issueId: string,
  decision: RecommendDecision,
  reasonCode?: keyof typeof REASON_MESSAGES,
  ranking?: Pick<RecommendationResult, 'rank' | 'ranking_score' | 'ranking_reasons'>,
): RecommendationResult {
  if (!reasonCode) {
    return {
      issue_id: issueId,
      decision,
      reason_codes: [],
      reasons: [],
      ...ranking,
    };
  }

  return {
    issue_id: issueId,
    decision,
    reason_codes: [reasonCode],
    reasons: [REASON_MESSAGES[reasonCode]],
    ...ranking,
  };
}

function scoreCandidate(candidate: CandidateLane, index: number): CandidateLane & {
  rank: number;
  ranking_score: number;
  ranking_reasons: string[];
} {
  let rankingScore = 0;
  const rankingReasons: string[] = [];

  if (candidate.tier === 'T2') {
    rankingScore += 45;
    rankingReasons.push('tier:T2 dispatchable default');
  } else if (candidate.tier === 'T3') {
    rankingScore += 30;
    rankingReasons.push('tier:T3 lower urgency');
  } else {
    rankingScore += 20;
    rankingReasons.push('tier:T1 requires PM authorization');
  }

  if (candidate.file_scope.length > 0) {
    rankingScore += 20;
    rankingReasons.push('file scope declared');
  } else {
    rankingScore -= 40;
    rankingReasons.push('file scope missing');
  }

  if (candidate.has_acceptance_criteria === false) {
    rankingScore -= 20;
    rankingReasons.push('acceptance criteria missing');
  } else if (candidate.has_acceptance_criteria === true) {
    rankingScore += 10;
    rankingReasons.push('acceptance criteria present');
  }

  const laneType = candidate.lane_type ?? inferLaneType(candidate.file_scope);
  const workClass = candidate.work_class ?? inferWorkClass(laneType, []);
  if (workClass === 'safe') {
    rankingScore += 5;
    rankingReasons.push('safe work class');
  }

  return {
    ...candidate,
    rank: index + 1,
    ranking_score: rankingScore,
    ranking_reasons: rankingReasons,
  };
}

function rankCandidates(candidates: CandidateLane[]): Array<CandidateLane & {
  rank: number;
  ranking_score: number;
  ranking_reasons: string[];
}> {
  return candidates
    .map((candidate, index) => ({ candidate, index, scored: scoreCandidate(candidate, index) }))
    .sort((left, right) => {
      if (right.scored.ranking_score !== left.scored.ranking_score) {
        return right.scored.ranking_score - left.scored.ranking_score;
      }
      return left.index - right.index;
    })
    .map((entry, index) => ({
      ...entry.scored,
      rank: index + 1,
    }));
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
  return readLaneManifests(dir).filter((manifest) => ACTIVE_LOCK_STATUSES.has(manifest.status));
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

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function getFlagValue(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  return argv[index + 1] ?? null;
}

function parseTierLabel(labels: string[]): CandidateLane['tier'] | null {
  for (const label of labels) {
    const lower = label.toLowerCase();
    if (lower === 't1' || lower === 'tier:t1') return 'T1';
    if (lower === 't2' || lower === 'tier:t2') return 'T2';
    if (lower === 't3' || lower === 'tier:t3') return 'T3';
  }
  return null;
}

function parseExecutorLabel(tier: CandidateLane['tier'], labels: string[]): CandidateLane['executor'] {
  const lowerLabels = labels.map((label) => label.toLowerCase());
  if (lowerLabels.some((label) => label === 'lane:codex-cli' || label === 'lane:codex' || label === 'executor:codex-cli')) {
    return 'codex-cli';
  }
  if (lowerLabels.some((label) => label === 'lane:claude' || label === 'executor:claude')) {
    return 'claude';
  }
  if (tier === 'T2' && !lowerLabels.some((label) => label.includes('migration') || label.includes('contract'))) {
    return 'codex-cli';
  }
  return 'claude';
}

function parseBlockedByFromText(text: string | null | undefined): string[] {
  if (!text) {
    return [];
  }
  const blockedLine = text.match(/blocked\s+by\s*:?\s*([^\n]+)/i);
  if (!blockedLine) {
    return [];
  }
  return [...blockedLine[1].matchAll(/(?:UTV2|UNI)-\d+/g)].map((match) => match[0]);
}

export function parseQueueCandidates(queuePath: string): CandidateLane[] {
  if (!fs.existsSync(queuePath)) {
    return [];
  }

  const markdown = fs.readFileSync(queuePath, 'utf8');
  const headingPattern = /^### ((?:UTV2|UNI)-\d+) [—-] (.+)$/gm;
  const matches = [...markdown.matchAll(headingPattern)];
  const candidates: CandidateLane[] = [];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const issueId = match[1];
    const title = match[2].replace(/^T[123]\s+/, '').trim();
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? markdown.length;
    const block = markdown.slice(start, end);
    const status = block.match(/\| \*\*Status\*\* \|([^|]+)\|/)?.[1]?.replace(/\*/g, '').trim();
    if (status && !['READY', 'TODO', 'BACKLOG'].includes(status)) {
      continue;
    }
    const tier = block.match(/\| \*\*Tier\*\* \|([^|]+)\|/)?.[1]?.trim() as CandidateLane['tier'] | undefined;
    if (tier !== 'T1' && tier !== 'T2' && tier !== 'T3') {
      continue;
    }
    const lane = block.match(/\| \*\*Lane\*\* \|([^|]+)\|/)?.[1]?.replace(/[`|]/g, '').trim().toLowerCase();
    const branch = block.match(/\| \*\*Branch\*\* \|([^|]+)\|/)?.[1]?.replace(/[`|]/g, '').trim();
    const labels = [lane ?? ''].filter(Boolean);
    const fileScope = extractFileScopeFromText(block);
    candidates.push({
      issue_id: issueId,
      title,
      tier,
      executor: lane?.includes('codex') ? 'codex-cli' : 'claude',
      branch: branch && branch !== '—' ? branch : undefined,
      lane_type: inferLaneTypeFromLabels(labels, title) ?? undefined,
      file_scope: fileScope,
      blocked_by: parseBlockedByFromText(block),
      has_acceptance_criteria: hasAcceptanceCriteria(block),
      labels,
    });
  }

  return candidates;
}

async function fetchLinearCandidates(argv: string[]): Promise<CandidateLane[]> {
  const token = readConfiguredEnvValue('LINEAR_API_TOKEN') || readConfiguredEnvValue('LINEAR_API_KEY');
  if (!token) {
    throw new Error('LINEAR_API_TOKEN or LINEAR_API_KEY not set');
  }

  const teamKey = getFlagValue(argv, '--linear-team-key') ?? process.env.LINEAR_TEAM_KEY?.trim() ?? 'UTV2';
  const limitRaw = Number.parseInt(getFlagValue(argv, '--linear-limit') ?? '10', 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 50)) : 10;
  const linearOpts = { token, userAgent: 'unit-talk-ops-lane-maximizer' };
  const teamResult = await linearQuery<{
    teams: { nodes: Array<{ id: string; key: string }> };
  }>(
    `query ResolveTeam($key: String!) {
       teams(filter: { key: { eq: $key } }, first: 1) {
         nodes { id key }
       }
     }`,
    { key: teamKey },
    linearOpts,
  );

  if (!teamResult.ok || !teamResult.data?.teams.nodes[0]) {
    throw new Error(`Linear team resolve failed: ${teamResult.error ?? teamKey}`);
  }

  const teamId = teamResult.data.teams.nodes[0].id;
  const result = await linearQuery<{
    team: {
      issues: {
        nodes: Array<{
          identifier: string;
          title: string;
          url: string;
          description: string | null;
          branchName: string | null;
          labels: { nodes: Array<{ name: string }> };
          state: { name: string; type: string } | null;
          relations: {
            nodes: Array<{
              type: string;
              relatedIssue: { identifier: string } | null;
            }>;
          };
        }>;
      };
    } | null;
  }>(
    `query LaneCandidates($teamId: String!, $limit: Int!) {
       team(id: $teamId) {
         issues(
           first: $limit
           filter: { state: { type: { in: ["backlog", "unstarted"] } } }
           orderBy: updatedAt
         ) {
           nodes {
             identifier
             title
             url
             description
             branchName
             labels { nodes { name } }
             state { name type }
             relations {
               nodes {
                 type
                 relatedIssue { identifier }
               }
             }
           }
         }
       }
     }`,
    { teamId, limit },
    linearOpts,
  );

  if (!result.ok || !result.data?.team) {
    throw new Error(`Linear candidate query failed: ${result.error ?? 'unknown'}`);
  }

  return result.data.team.issues.nodes.flatMap((issue): CandidateLane[] => {
    const labels = issue.labels.nodes.map((label) => label.name);
    const tier = parseTierLabel(labels);
    if (!tier) {
      return [];
    }
    const blockedBy = issue.relations.nodes
      .filter((relation) => relation.type === 'blocks' || relation.type === 'blocked_by' || relation.type === 'related')
      .map((relation) => relation.relatedIssue?.identifier)
      .filter((identifier): identifier is string => Boolean(identifier));
    const fileScope = extractFileScopeFromText(issue.description);
    return [{
      issue_id: issue.identifier,
      title: issue.title,
      tier,
      executor: parseExecutorLabel(tier, labels),
      branch: issue.branchName ?? undefined,
      lane_type: inferLaneTypeFromLabels(labels, issue.title) ?? undefined,
      file_scope: fileScope,
      blocked_by: Array.from(new Set([...blockedBy, ...parseBlockedByFromText(issue.description)])),
      has_acceptance_criteria: hasAcceptanceCriteria(issue.description),
      labels,
      url: issue.url,
    }];
  });
}

function parseLimits(argv: string[]): { maxClaude: number; maxCodex: number } {
  const cfg = (() => { try { return loadConcurrencyConfig(); } catch { return null; } })();
  const defaultClaude = cfg?.executors.claude ?? 2;
  const defaultCodex = cfg?.executors.codex ?? 4;

  const getNumberFlag = (name: string, fallback: number): number => {
    const index = argv.indexOf(name);
    if (index === -1) {
      return fallback;
    }
    const raw = Number.parseInt(argv[index + 1] ?? '', 10);
    return Number.isFinite(raw) ? raw : fallback;
  };

  return {
    maxClaude: getNumberFlag('--max-claude', defaultClaude),
    maxCodex: getNumberFlag('--max-codex', defaultCodex),
  };
}

export function evaluateCandidates(
  candidates: CandidateLane[],
  activeLanes: LaneManifest[],
  limits: { maxClaude: number; maxCodex: number },
  options: EvaluateCandidateOptions = {},
): MaximizationReport {
  const cfg = (() => { try { return loadConcurrencyConfig(); } catch { return null; } })();
  const doneIssueIds = options.doneIssueIds ?? readDoneIssueIds();
  const singletonLaneTypes = options.singletonLaneTypes ?? cfg?.singleton_types ?? [
    'runtime',
    'migration',
    'modeling',
    'data-canonical',
  ];
  const forbiddenCombinations = options.forbiddenCombinations ?? cfg?.forbidden_combinations ?? [];
  const activeClaude = activeLanes.filter((lane) => resolveLaneExecutor(lane) === 'claude').length;
  const activeCodex = activeLanes.filter((lane) => {
    const executor = resolveLaneExecutor(lane);
    return executor === 'codex-cli' || executor === 'codex-cloud';
  }).length;
  const initialActiveTypes = activeLaneTypes(activeLanes);

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
    dispatch_plan: {
      fill_now: [],
      lane_saturation_forecast: {
        executors: {
          claude: {
            max: limits.maxClaude,
            active: activeClaude,
            available_slots: Math.max(0, limits.maxClaude - activeClaude),
          },
          codex: {
            max: limits.maxCodex,
            active: activeCodex,
            available_slots: Math.max(0, limits.maxCodex - activeCodex),
          },
        },
        active_singletons: initialActiveTypes.filter((laneType) => singletonLaneTypes.includes(laneType)),
        forbidden_combinations_active: activeForbiddenCombinations(initialActiveTypes, forbiddenCombinations),
        safe_class_recommendations: [],
      },
    },
    recommended: [],
    blocked: [],
    risky: [],
    deferred: [],
  };
  let plannedClaude = 0;
  let plannedCodex = 0;
  const plannedLaneTypes = [...initialActiveTypes];

  const remainingSlots = (executor: CandidateLane['executor']): number => {
    if (executor === 'claude') return Math.max(0, limits.maxClaude - activeClaude - plannedClaude);
    return Math.max(0, limits.maxCodex - activeCodex - plannedCodex);
  };

  const pushPlan = (candidate: CandidateLane, laneType: string, workClass: string): void => {
    const slotIndex = candidate.executor === 'claude'
      ? activeClaude + plannedClaude + 1
      : activeCodex + plannedCodex + 1;
    const branch = deriveBranchName(candidate);
    const fileArgs = candidate.file_scope
      .map(normalizePath)
      .flatMap((filePath) => ['--files', shellQuote(filePath)]);
    report.dispatch_plan.fill_now.push({
      issue_id: candidate.issue_id,
      executor: candidate.executor,
      lane_type: laneType,
      work_class: workClass,
      file_scope: candidate.file_scope.map(normalizePath),
      slot_index: slotIndex,
      explanation: `${candidate.executor} slot ${slotIndex} can run now; ${workClass} ${laneType} work has no active singleton, forbidden combination, or path overlap conflict.`,
      dispatch_command: [
        'pnpm',
        'ops:lane-start',
        candidate.issue_id,
        '--tier',
        candidate.tier,
        '--branch',
        shellQuote(branch),
        '--executor',
        candidate.executor,
        '--lane-type',
        laneType,
        ...fileArgs,
      ].join(' '),
    });
    if (candidate.executor === 'claude') plannedClaude += 1;
    else plannedCodex += 1;
    if (!plannedLaneTypes.includes(laneType)) plannedLaneTypes.push(laneType);
  };

  for (const candidate of rankCandidates(candidates)) {
    const ranking = {
      rank: candidate.rank,
      ranking_score: candidate.ranking_score,
      ranking_reasons: candidate.ranking_reasons,
    };
    const fileScope = candidate.file_scope.map(normalizePath);
    const laneType = candidate.lane_type ?? inferLaneType(fileScope);
    const workClass = candidate.work_class ?? inferWorkClass(laneType, singletonLaneTypes);
    const hasIncompleteDependency = candidate.blocked_by.some((issueId) => !doneIssueIds.has(issueId));
    if (candidate.has_acceptance_criteria === false) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'MISSING_ACCEPTANCE_CRITERIA', ranking));
      continue;
    }

    if (fileScope.length === 0) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'MISSING_FILE_SCOPE', ranking));
      continue;
    }

    if (hasIncompleteDependency) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'BLOCKED_DEP', ranking));
      continue;
    }

    if (fileScope.some(isMigrationPath)) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'MIGRATION_PATH', ranking));
      continue;
    }

    if (candidate.tier === 'T1') {
      report.deferred.push(buildResult(candidate.issue_id, 'deferred', 'T1_REQUIRES_PM', ranking));
      continue;
    }

    if (candidate.executor === 'claude' && remainingSlots(candidate.executor) <= 0) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'DISPATCH_LIMIT_CLAUDE', ranking));
      continue;
    }

    if (candidate.executor === 'codex-cli' && remainingSlots(candidate.executor) <= 0) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'DISPATCH_LIMIT_CODEX', ranking));
      continue;
    }

    if (singletonLaneTypes.includes(laneType) && plannedLaneTypes.includes(laneType)) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'SINGLETON_ACTIVE', ranking));
      continue;
    }

    if (hasForbiddenCombination(laneType, plannedLaneTypes, forbiddenCombinations)) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'FORBIDDEN_COMBINATION', ranking));
      continue;
    }

    if (
      packageTouchingLaneRequiresSingleton(fileScope, candidate.isolated_install_verified === true) &&
      activeLanes.length > 0
    ) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'ISOLATED_INSTALL_REQUIRED', ranking));
      continue;
    }

    const overlaps = fileScope.some((candidatePath) =>
      activeLanes.some((lane) => lane.file_scope_lock.some((lockedPath) => overlapsPath(candidatePath, lockedPath))),
    );
    if (overlaps) {
      report.blocked.push(buildResult(candidate.issue_id, 'blocked', 'OVERLAP', ranking));
      continue;
    }

    if (fileScope.some(isTierCPath)) {
      report.risky.push(buildResult(candidate.issue_id, 'risky', 'TIER_C_PATH', ranking));
      continue;
    }

    report.recommended.push(buildResult(candidate.issue_id, 'recommended', undefined, ranking));
    pushPlan(candidate, laneType, workClass);
  }

  const forecast = report.dispatch_plan.lane_saturation_forecast;
  forecast.executors.claude.available_slots = Math.max(0, limits.maxClaude - activeClaude - plannedClaude);
  forecast.executors.codex.available_slots = Math.max(0, limits.maxCodex - activeCodex - plannedCodex);
  const availableSafeSlots = forecast.executors.claude.available_slots + forecast.executors.codex.available_slots;
  forecast.safe_class_recommendations = availableSafeSlots > 0
    ? [
        `Queue up to ${availableSafeSlots} hygiene, verification, governance, or ops-tooling lanes with disjoint file scopes.`,
        'Avoid runtime, migration, modeling, and data-canonical work while matching singleton classes are active.',
      ]
    : ['All configured executor slots are saturated by active or planned lanes.'];

  return report;
}

async function runCli(): Promise<void> {
  let candidates: CandidateLane[] = [];
  let activeLanes: LaneManifest[] = [];
  const cfg = (() => { try { return loadConcurrencyConfig(); } catch { return null; } })();
  const defaultLimits = { maxClaude: cfg?.executors.claude ?? 2, maxCodex: cfg?.executors.codex ?? 4 };
  let limits = defaultLimits;
  const argv = process.argv.slice(2);

  try {
    if (hasFlag(argv, '--from-linear')) {
      candidates = await fetchLinearCandidates(argv);
    } else if (hasFlag(argv, '--from-queue')) {
      candidates = parseQueueCandidates(
        getFlagValue(argv, '--queue-file') ?? path.join(ROOT, 'docs', '06_status', 'ISSUE_QUEUE.md'),
      );
    } else {
      candidates = parseCandidatesArg(argv);
    }
    activeLanes = readActiveLanes();
    limits = parseLimits(argv);
  } catch (error) {
    candidates = [];
    activeLanes = [];
    limits = defaultLimits;
    process.stderr.write(
      `[lane-maximizer] ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }

  const report = evaluateCandidates(candidates, activeLanes, limits);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 0;
}

const argv1 = process.argv[1] ?? '';
if (argv1.endsWith('lane-maximizer.ts') || argv1.endsWith('lane-maximizer.js')) {
  void runCli();
}
