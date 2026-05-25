/**
 * UTV2-669: Daily ops health digest
 *
 * Aggregates read-only sources into a structured JSON report:
 *   1. Lane manifests → zombie stale-lane check (no GitHub/Linear API calls)
 *   2. ci-doctor subprocess → CI failures (status === 'fail' only; infra_error = skip)
 *   3. Linear GraphQL → active lanes + top-3 backlog
 *   4. Linear GraphQL → top-3 dispatchable issues with executor routing
 *
 * Outputs:
 *   - Structured JSON at .out/ops/digest/YYYY-MM-DD.json (when --write-result)
 *   - Discord alert via UNIT_TALK_OPS_ALERT_WEBHOOK_URL when stale_lanes or
 *     ci_failures are present
 *   - Exits 0 always — never blocks CI
 *
 * Read-only guarantee: no writeManifest, updateManifest, or any state mutation.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ROOT,
  emitJson,
  ensureDir,
  readConfiguredEnvValue,
  readAllManifests,
  type CiDoctorResult,
  type LaneManifest,
} from './shared.js';
import { linearQuery } from './linear-client.js';
import { loadConcurrencyConfig } from './concurrency-config.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface StaleLaneEntry {
  issue_id: string;
  branch: string;
  status: string;
  heartbeat_at: string;
  age_hours: number;
}

interface LinearIssueSummary {
  identifier: string;
  title: string;
  state_name: string;
  state_type: string;
  url: string;
}

interface LinearSummary {
  active_lanes: LinearIssueSummary[];
  backlog_top3: LinearIssueSummary[];
  skipped: boolean;
  error?: string;
}

interface DispatchCandidate {
  identifier: string;
  title: string;
  tier: 'T1' | 'T2' | 'T3';
  recommended_executor: 'claude' | 'codex';
  url: string;
  has_acceptance_criteria: boolean;
  labels: string[];
}

type ConflictRisk = 'none' | 'singleton_active' | 'capacity_full';

interface RankedDispatchCandidate extends DispatchCandidate {
  rank: number;
  ranking_score: number;
  ranking_reasons: string[];
  lane_type: string;
  work_class: string;
  conflict_risk: ConflictRisk;
  executor_capacity: {
    active: number;
    max: number;
    available: boolean;
  };
}

interface RankDispatchOptions {
  active_lanes: LaneManifest[];
  max_claude: number;
  max_codex: number;
  singleton_lane_types: string[];
}


interface P0EventsSummary {
  total_failures: number;
  top_reason: string | null;
  misconfig_warning: boolean;
  misconfig_detail: string;
  skipped: boolean;
  error?: string;
}

interface DigestReport {
  schema_version: 1 | 2;
  run_at: string;
  mode: 'local' | 'scheduled';
  stale_lanes: StaleLaneEntry[];
  ci_failures: string[];
  linear: LinearSummary;
  dispatch_candidates: RankedDispatchCandidate[];
  p0_events: P0EventsSummary;
  recommended_next: string[];
  infra_errors: string[];
  brief_text: string;
}

// ── Config ─────────────────────────────────────────────────────────────────

const ZOMBIE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours
const DIGEST_DIR = path.join(ROOT, '.out', 'ops', 'digest');

const linearToken = readConfiguredEnvValue('LINEAR_API_TOKEN') || readConfiguredEnvValue('LINEAR_API_KEY') || '';
const linearTeamKey = process.env.LINEAR_TEAM_KEY?.trim() ?? 'UTV2';
const webhookUrl = process.env.UNIT_TALK_OPS_ALERT_WEBHOOK_URL?.trim() ?? '';

const writeResult = process.argv.includes('--write-result');
const jsonMode = process.argv.includes('--json');

// ── Source 1: stale lanes from manifests ──────────────────────────────────

function fetchStaleLanes(): StaleLaneEntry[] {
  const manifests: LaneManifest[] = readAllManifests();
  const stale: StaleLaneEntry[] = [];

  for (const m of manifests) {
    if (m.status !== 'in_progress') continue;
    if (!m.heartbeat_at) continue;
    const ageMs = Date.now() - Date.parse(m.heartbeat_at);
    if (ageMs > ZOMBIE_THRESHOLD_MS) {
      stale.push({
        issue_id: m.issue_id,
        branch: m.branch,
        status: m.status,
        heartbeat_at: m.heartbeat_at,
        age_hours: Math.round(ageMs / (60 * 60 * 1000)),
      });
    }
  }

  return stale;
}

// ── Source 2: CI failures from ci-doctor subprocess ───────────────────────

function runSubprocess(cmd: string, args: string[]): { stdout: string; ok: boolean } {
  try {
    const result = spawnSync(cmd, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });
    return {
      stdout: (result.stdout as string | null) ?? '',
      ok: result.status === 0 || result.status === 3, // 3 = INFRA verdict (not a failure)
    };
  } catch {
    return { stdout: '', ok: false };
  }
}

/** Extract the first complete JSON object or array from output that may have banner/footer lines. */
function extractJson(raw: string): string | null {
  const objIdx = raw.indexOf('{');
  const arrIdx = raw.indexOf('[');
  let start = -1;
  if (objIdx === -1 && arrIdx === -1) return null;
  if (objIdx === -1) start = arrIdx;
  else if (arrIdx === -1) start = objIdx;
  else start = Math.min(objIdx, arrIdx);

  const closeChar = raw[start] === '{' ? '}' : ']';
  const end = raw.lastIndexOf(closeChar);
  if (end === -1 || end < start) return null;
  return raw.slice(start, end + 1);
}

function fetchCiFailures(infraErrors: string[]): string[] {
  try {
    const { stdout } = runSubprocess('pnpm', ['ops:ci-doctor', '--', '--json']);
    const jsonStr = extractJson(stdout);

    if (!jsonStr) {
      infraErrors.push('ci-doctor produced no JSON output');
      return [];
    }

    const parsed = JSON.parse(jsonStr) as Partial<CiDoctorResult>;
    if (!Array.isArray(parsed.checks)) {
      infraErrors.push('ci-doctor output missing checks array');
      return [];
    }

    return parsed.checks
      .filter((c) => c.status === 'fail')
      .map((c) => `${c.id}: ${c.detail}`);
  } catch (err) {
    infraErrors.push(
      `ci-doctor subprocess failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

// ── Linear shared helpers ─────────────────────────────────────────────────

const linearOpts = { token: linearToken, userAgent: 'unit-talk-ops-daily-digest' };

let _cachedTeamId: string | null | undefined;

/** Resolve team ID from LINEAR_TEAM_KEY. Returns null and pushes to infraErrors on failure. Cached after first call. */
async function resolveLinearTeamId(infraErrors: string[]): Promise<string | null> {
  if (_cachedTeamId !== undefined) return _cachedTeamId;
  if (!linearToken) {
    infraErrors.push('LINEAR_API_TOKEN or LINEAR_API_KEY not set — skipping Linear query');
    _cachedTeamId = null;
    return null;
  }

  const teamResult = await linearQuery<{
    teams: { nodes: Array<{ id: string; key: string }> };
  }>(
    `query ResolveTeam($key: String!) {
       teams(filter: { key: { eq: $key } }, first: 1) {
         nodes { id key }
       }
     }`,
    { key: linearTeamKey },
    linearOpts,
  );

  if (!teamResult.ok || !teamResult.data) {
    infraErrors.push(`Linear team resolve failed: ${teamResult.error ?? 'unknown'}`);
    _cachedTeamId = null;
    return null;
  }

  const team = teamResult.data.teams.nodes[0];
  if (!team) {
    infraErrors.push(`Linear team not found: ${linearTeamKey}`);
    _cachedTeamId = null;
    return null;
  }

  _cachedTeamId = team.id;
  return team.id;
}

// ── Source 3: Linear active lanes + top-3 backlog ─────────────────────────

async function fetchLinearSummary(infraErrors: string[]): Promise<LinearSummary> {
  const teamId = await resolveLinearTeamId(infraErrors);
  if (!teamId) {
    return { active_lanes: [], backlog_top3: [], skipped: true, error: infraErrors[infraErrors.length - 1] };
  }

  // Step 1: active lanes (state.type = started)
  const activeResult = await linearQuery<{
    team: {
      issues: {
        nodes: Array<{
          identifier: string;
          title: string;
          url: string;
          state: { name: string; type: string } | null;
        }>;
      };
    } | null;
  }>(
    `query ActiveIssues($teamId: String!) {
       team(id: $teamId) {
         issues(
           first: 20
           filter: { state: { type: { eq: "started" } } }
           orderBy: updatedAt
         ) {
           nodes {
             identifier title url
             state { name type }
           }
         }
       }
     }`,
    { teamId },
    linearOpts,
  );

  const activeNodes = activeResult.data?.team?.issues.nodes ?? [];
  const active_lanes: LinearIssueSummary[] = activeNodes.map((n) => ({
    identifier: n.identifier,
    title: n.title,
    state_name: n.state?.name ?? 'Unknown',
    state_type: n.state?.type ?? 'unknown',
    url: n.url,
  }));

  if (!activeResult.ok) {
    infraErrors.push(`Linear active-issues query failed: ${activeResult.error ?? 'unknown'}`);
  }

  // Step 2: top-3 backlog (state.type in [backlog, unstarted])
  const backlogResult = await linearQuery<{
    team: {
      issues: {
        nodes: Array<{
          identifier: string;
          title: string;
          url: string;
          state: { name: string; type: string } | null;
        }>;
      };
    } | null;
  }>(
    `query BacklogIssues($teamId: String!) {
       team(id: $teamId) {
         issues(
           first: 3
           filter: { state: { type: { eq: "unstarted" } } }
           orderBy: updatedAt
         ) {
           nodes {
             identifier title url
             state { name type }
           }
         }
       }
     }`,
    { teamId },
    linearOpts,
  );

  const backlogNodes = backlogResult.data?.team?.issues.nodes ?? [];
  const backlog_top3: LinearIssueSummary[] = backlogNodes.map((n) => ({
    identifier: n.identifier,
    title: n.title,
    state_name: n.state?.name ?? 'Unknown',
    state_type: n.state?.type ?? 'unknown',
    url: n.url,
  }));

  if (!backlogResult.ok) {
    infraErrors.push(`Linear backlog query failed: ${backlogResult.error ?? 'unknown'}`);
  }

  return { active_lanes, backlog_top3, skipped: false };
}

// ── Source 4: dispatch candidates from Linear ─────────────────────────────

function parseTierLabel(labels: string[]): 'T1' | 'T2' | 'T3' | null {
  for (const l of labels) {
    const lower = l.toLowerCase();
    if (lower === 't1' || lower === 'tier:t1') return 'T1';
    if (lower === 't2' || lower === 'tier:t2') return 'T2';
    if (lower === 't3' || lower === 'tier:t3') return 'T3';
  }
  return null;
}

function routeExecutor(tier: 'T1' | 'T2' | 'T3', labels: string[]): 'claude' | 'codex' {
  if (tier === 'T1') return 'claude';
  if (tier === 'T3') return 'claude';
  // T2: claude if migration or contract label present
  const lowerLabels = labels.map((l) => l.toLowerCase());
  if (lowerLabels.some((l) => l.includes('migration') || l.includes('contract') || l === 'kind:migration' || l === 'kind:contract')) return 'claude';
  return 'codex';
}

function inferLaneType(labels: string[], title: string): string {
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  const explicit = normalizedLabels.find((label) => label.startsWith('lane:'));
  if (explicit) return explicit.slice('lane:'.length);
  const searchable = `${normalizedLabels.join(' ')} ${title}`.toLowerCase();
  if (/migration|schema|supabase/.test(searchable)) return 'migration';
  if (/runtime|worker|api|delivery|outbox/.test(searchable)) return 'runtime';
  if (/model|scoring|calibration/.test(searchable)) return 'modeling';
  if (/canonical|reference data|taxonomy/.test(searchable)) return 'data-canonical';
  if (/governance|policy|doc|alignment/.test(searchable)) return 'governance';
  if (/hygiene|cleanup|ops|tooling|ci/.test(searchable)) return 'hygiene';
  if (/verification|proof|test/.test(searchable)) return 'verification';
  return 'unknown';
}

function inferWorkClass(labels: string[], laneType: string): string {
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  const explicit = normalizedLabels.find((label) => label.startsWith('work:'));
  if (explicit) return explicit.slice('work:'.length);
  if (['runtime', 'migration', 'modeling', 'data-canonical'].includes(laneType)) return 'singleton';
  return 'safe';
}

function classifyExecutor(manifest: LaneManifest): 'claude' | 'codex' | 'unknown' {
  const value = `${manifest.executor ?? ''} ${manifest.created_by ?? ''} ${manifest.branch ?? ''}`.toLowerCase();
  if (value.includes('claude')) return 'claude';
  if (value.includes('codex')) return 'codex';
  return 'unknown';
}

function scoreCandidate(
  candidate: DispatchCandidate,
  options: RankDispatchOptions,
): Omit<RankedDispatchCandidate, keyof DispatchCandidate | 'rank'> {
  const laneType = inferLaneType(candidate.labels, candidate.title);
  const workClass = inferWorkClass(candidate.labels, laneType);
  const activeForExecutor = options.active_lanes.filter(
    (manifest) => classifyExecutor(manifest) === candidate.recommended_executor,
  ).length;
  const maxForExecutor = candidate.recommended_executor === 'claude'
    ? options.max_claude
    : options.max_codex;
  const executorAvailable = activeForExecutor < maxForExecutor;
  const singletonActive = options.singleton_lane_types.includes(laneType)
    && options.active_lanes.some((manifest) => manifest.lane_type === laneType);
  const conflictRisk: ConflictRisk = singletonActive
    ? 'singleton_active'
    : executorAvailable
      ? 'none'
      : 'capacity_full';

  let score = 0;
  const reasons: string[] = [];
  if (candidate.tier === 'T1') {
    score += 20;
    reasons.push('tier:T1 requires careful dispatch');
  } else if (candidate.tier === 'T2') {
    score += 45;
    reasons.push('tier:T2 dispatchable default');
  } else {
    score += 30;
    reasons.push('tier:T3 lower urgency');
  }
  if (candidate.has_acceptance_criteria) {
    score += 20;
    reasons.push('acceptance criteria present');
  } else {
    score -= 15;
    reasons.push('acceptance criteria missing');
  }
  if (executorAvailable) {
    score += 10;
    reasons.push(`${candidate.recommended_executor} capacity available`);
  } else {
    score -= 25;
    reasons.push(`${candidate.recommended_executor} capacity full`);
  }
  if (singletonActive) {
    score -= 50;
    reasons.push(`active singleton lane_type:${laneType}`);
  }
  if (workClass === 'safe') {
    score += 5;
    reasons.push('safe work class');
  }

  return {
    ranking_score: score,
    ranking_reasons: reasons,
    lane_type: laneType,
    work_class: workClass,
    conflict_risk: conflictRisk,
    executor_capacity: {
      active: activeForExecutor,
      max: maxForExecutor,
      available: executorAvailable,
    },
  };
}

export function rankDispatchCandidates(
  candidates: DispatchCandidate[],
  options: RankDispatchOptions,
): RankedDispatchCandidate[] {
  return candidates
    .map((candidate, index) => ({
      ...candidate,
      ...scoreCandidate(candidate, options),
      rank: index + 1,
      originalIndex: index,
    }))
    .sort((left, right) => {
      if (right.ranking_score !== left.ranking_score) return right.ranking_score - left.ranking_score;
      return left.originalIndex - right.originalIndex;
    })
    .map(({ originalIndex: _originalIndex, ...candidate }, index) => ({
      ...candidate,
      rank: index + 1,
    }));
}

function hasAcceptanceCriteria(description: string | null | undefined): boolean {
  if (!description) return false;
  return /acceptance\s+criteria|AC:/i.test(description);
}

async function fetchDispatchCandidates(infraErrors: string[]): Promise<DispatchCandidate[]> {
  const teamId = await resolveLinearTeamId(infraErrors);
  if (!teamId) return [];

  try {
    const result = await linearQuery<{
      team: {
        issues: {
          nodes: Array<{
            identifier: string;
            title: string;
            url: string;
            description: string | null;
            labels: { nodes: Array<{ name: string }> };
            state: { name: string; type: string } | null;
          }>;
        };
      } | null;
    }>(
      `query DispatchCandidates($teamId: String!) {
         team(id: $teamId) {
           issues(
             first: 10
             filter: { state: { type: { in: ["unstarted"] } } }
             orderBy: updatedAt
           ) {
             nodes {
               identifier
               title
               url
               description
               labels { nodes { name } }
               state { name type }
             }
           }
         }
       }`,
      { teamId },
      linearOpts,
    );

    if (!result.ok || !result.data?.team) {
      infraErrors.push(`Linear dispatch query failed: ${result.error ?? 'unknown'}`);
      return [];
    }

    const nodes = result.data.team.issues.nodes;

    const candidates: DispatchCandidate[] = [];
    for (const n of nodes) {
      const labelNames = n.labels.nodes.map((l) => l.name);
      const tier = parseTierLabel(labelNames);
      if (!tier) continue;

      candidates.push({
        identifier: n.identifier,
        title: n.title,
        tier,
        recommended_executor: routeExecutor(tier, labelNames),
        url: n.url,
        has_acceptance_criteria: hasAcceptanceCriteria(n.description),
        labels: labelNames,
      });

      if (candidates.length >= 10) break;
    }

    const concurrency = loadConcurrencyConfig();
    return rankDispatchCandidates(candidates, {
      active_lanes: readAllManifests().filter((manifest) =>
        ['started', 'in_progress', 'blocked', 'in_review'].includes(manifest.status),
      ),
      max_claude: concurrency.executors.claude,
      max_codex: concurrency.executors.codex,
      singleton_lane_types: concurrency.singleton_types,
    }).slice(0, 5);
  } catch (err) {
    infraErrors.push(
      `Dispatch candidates fetch error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

// ── Source 5: P0 events (last 7 days) ────────────────────────────────────

function fetchP0EventsSummary(infraErrors: string[]): P0EventsSummary {
  try {
    const { stdout, ok } = runSubprocess('pnpm', ['ops:p0-events', '--', '--json']);
    if (!ok && !stdout) {
      return { total_failures: 0, top_reason: null, misconfig_warning: false, misconfig_detail: '', skipped: true, error: 'subprocess failed' };
    }
    const jsonStr = extractJson(stdout);
    if (!jsonStr) {
      return { total_failures: 0, top_reason: null, misconfig_warning: false, misconfig_detail: '', skipped: true, error: 'no JSON output' };
    }
    const parsed = JSON.parse(jsonStr) as {
      total_failures?: number;
      histogram?: Array<{ block_reason: string; count: number }>;
      misconfig_check?: { p0_protocol_required: boolean; detail: string };
    };
    const topReason = parsed.histogram?.[0]?.block_reason ?? null;
    const misconfigCheck = parsed.misconfig_check;
    const misconfigSkipped = misconfigCheck?.detail?.toLowerCase().includes('skipped') ?? false;
    return {
      total_failures: parsed.total_failures ?? 0,
      top_reason: topReason,
      misconfig_warning: !misconfigSkipped && !(misconfigCheck?.p0_protocol_required ?? true),
      misconfig_detail: misconfigCheck?.detail ?? '',
      skipped: false,
    };
  } catch (err) {
    infraErrors.push(
      `p0-events subprocess failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { total_failures: 0, top_reason: null, misconfig_warning: false, misconfig_detail: '', skipped: true, error: String(err) };
  }
}

// ── Derived recommendations ────────────────────────────────────────────────

function deriveRecommendedNext(
  stale_lanes: StaleLaneEntry[],
  ci_failures: string[],
  dispatch_candidates: RankedDispatchCandidate[],
  p0_events: P0EventsSummary,
): string[] {
  const recs: string[] = [];
  if (ci_failures.length > 0) {
    recs.push(`Fix ${ci_failures.length} CI failure(s): ${ci_failures.map((f) => f.split(':')[0]).join(', ')}`);
  }
  if (stale_lanes.length > 0) {
    recs.push(`Close or reopen ${stale_lanes.length} zombie lane(s): ${stale_lanes.map((l) => l.issue_id).join(', ')}`);
  }
  if (p0_events.misconfig_warning) {
    recs.push(`ACTION REQUIRED: "P0 Protocol" check missing from branch protection — ${p0_events.misconfig_detail}`);
  }
  if (p0_events.total_failures > 0) {
    const top = p0_events.top_reason ? ` (top: ${p0_events.top_reason})` : '';
    recs.push(`P0 gate fired ${p0_events.total_failures}x in last 7d${top}`);
  }
  if (dispatch_candidates.length > 0) {
    const d = dispatch_candidates[0];
    recs.push(`Next dispatch: ${d.identifier} [${d.tier} → ${d.recommended_executor} score=${d.ranking_score}]`);
  }
  return recs;
}

function buildBriefText(input: {
  stale_lanes: StaleLaneEntry[];
  ci_failures: string[];
  linear: LinearSummary;
  dispatch_candidates: RankedDispatchCandidate[];
  p0_events: P0EventsSummary;
  recommended_next: string[];
  infra_errors: string[];
}): string {
  const lines: string[] = [];
  lines.push('Recommendation');
  if (input.recommended_next.length > 0) {
    for (const recommendation of input.recommended_next) {
      lines.push(`- ${recommendation}`);
    }
  } else {
    lines.push('- no immediate dispatch action surfaced by digest inputs');
  }
  lines.push('');
  lines.push('Overview');
  lines.push(`- stale_lanes=${input.stale_lanes.length}`);
  lines.push(`- ci_failures=${input.ci_failures.length}`);
  lines.push(`- p0_failures_7d=${input.p0_events.total_failures}`);
  lines.push(`- infra_errors=${input.infra_errors.length}`);
  lines.push('');
  lines.push('Queue');
  lines.push(`- active_linear=${input.linear.active_lanes.length}${input.linear.skipped ? ' (skipped)' : ''}`);
  lines.push(`- backlog_top3=${input.linear.backlog_top3.length}${input.linear.skipped ? ' (skipped)' : ''}`);
  lines.push(`- dispatch_candidates=${input.dispatch_candidates.length}`);
  for (const candidate of input.dispatch_candidates.slice(0, 3)) {
    lines.push(
      `- #${candidate.rank} ${candidate.identifier} ${candidate.tier}/${candidate.recommended_executor} score=${candidate.ranking_score} risk=${candidate.conflict_risk}`,
    );
  }
  return lines.join('\n');
}

// ── Discord alert ──────────────────────────────────────────────────────────

async function postOpsAlert(message: string): Promise<void> {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: message }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // best-effort
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const runAt = new Date().toISOString();
  const mode: DigestReport['mode'] =
    process.env.GITHUB_ACTIONS === 'true' ? 'scheduled' : 'local';

  const infraErrors: string[] = [];

  const stale_lanes = fetchStaleLanes();
  const ci_failures = fetchCiFailures(infraErrors);
  const linear = await fetchLinearSummary(infraErrors);
  const dispatch_candidates = await fetchDispatchCandidates(infraErrors);
  const p0_events = fetchP0EventsSummary(infraErrors);
  const recommended_next = deriveRecommendedNext(stale_lanes, ci_failures, dispatch_candidates, p0_events);
  const brief_text = buildBriefText({
    stale_lanes,
    ci_failures,
    linear,
    dispatch_candidates,
    p0_events,
    recommended_next,
    infra_errors: infraErrors,
  });

  const report: DigestReport = {
    schema_version: 2,
    run_at: runAt,
    mode,
    stale_lanes,
    ci_failures,
    linear,
    dispatch_candidates,
    p0_events,
    recommended_next,
    infra_errors: infraErrors,
    brief_text,
  };

  if (writeResult) {
    ensureDir(DIGEST_DIR);
    const datePart = runAt.slice(0, 10); // YYYY-MM-DD
    const outPath = path.join(DIGEST_DIR, `${datePart}.json`);
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (jsonMode) {
    emitJson(report);
  } else {
    console.log(`[daily-digest] run_at=${runAt} mode=${mode}`);
    console.log(`  stale_lanes:    ${stale_lanes.length}`);
    console.log(`  ci_failures:    ${ci_failures.length}`);
    console.log(`  active_lanes:   ${linear.active_lanes.length}${linear.skipped ? ' (skipped)' : ''}`);
    console.log(`  backlog_top3:   ${linear.backlog_top3.length}${linear.skipped ? ' (skipped)' : ''}`);
    console.log(`  p0_failures_7d: ${p0_events.total_failures}${p0_events.skipped ? ' (skipped)' : ''}`);
    if (p0_events.misconfig_warning) {
      console.warn(`  p0_misconfig: ${p0_events.misconfig_detail}`);
    }
    console.log(`  dispatch_candidates: ${dispatch_candidates.length}`);
    for (let i = 0; i < dispatch_candidates.length; i++) {
      const d = dispatch_candidates[i];
      console.log(`    ${i + 1}. ${d.identifier} [${d.tier} → ${d.recommended_executor} score=${d.ranking_score} risk=${d.conflict_risk}] "${d.title}"`);
    }
    if (infraErrors.length > 0) {
      console.log(`  infra_errors:   ${infraErrors.length}`);
      for (const e of infraErrors) {
        console.log(`    ${e}`);
      }
    }
    if (recommended_next.length > 0) {
      console.log('  recommended:');
      for (const r of recommended_next) {
        console.log(`    - ${r}`);
      }
    }
    const needsAlert = stale_lanes.length > 0 || ci_failures.length > 0;
    console.log(`  verdict: ${needsAlert ? 'ALERT' : 'CLEAN'}`);
  }

  // Discord alert — only on stale_lanes or ci_failures
  const needsAlert = stale_lanes.length > 0 || ci_failures.length > 0;
  if (needsAlert) {
    const lines: string[] = [
      `**[daily-digest] Action required** — ${runAt}`,
      '',
    ];
    if (ci_failures.length > 0) {
      lines.push(`**CI Failures (${ci_failures.length}):**`);
      for (const f of ci_failures) {
        lines.push(`- \`${f}\``);
      }
      lines.push('');
    }
    if (stale_lanes.length > 0) {
      lines.push(`**Zombie lanes (${stale_lanes.length}):**`);
      for (const l of stale_lanes) {
        lines.push(`- \`${l.issue_id}\` — ${l.age_hours}h since heartbeat`);
      }
      lines.push('');
    }
    if (recommended_next.length > 0) {
      lines.push('**Recommended:**');
      for (const r of recommended_next) {
        lines.push(`- ${r}`);
      }
    }
    await postOpsAlert(lines.join('\n'));
  }

  process.exitCode = 0;
}

const isDirectRun = process.argv[1] != null
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectRun) {
  void main().catch((error: unknown) => {
    console.error(
      '[daily-digest] fatal:',
      error instanceof Error ? error.message : String(error),
    );
    // Still exit 0 — digest must not block CI
    process.exitCode = 0;
  });
}
