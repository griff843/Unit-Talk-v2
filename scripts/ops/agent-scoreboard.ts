import fs from 'node:fs';
import path from 'node:path';
import { ROOT, emitJson, parseArgs } from './shared.js';

type LaneStatus = string;

type TruthEntry = {
  verdict?: string;
  exit_code?: number;
};

export type AgentLaneInput = {
  issue_id: string;
  lane_type?: string;
  created_by?: string;
  status: LaneStatus;
  started_at?: string | null;
  closed_at?: string | null;
  heartbeat_at?: string | null;
  truth_check_history?: TruthEntry[];
};

export type AgentScore = {
  agent: string;
  total_lanes: number;
  active_lanes: number;
  done_lanes: number;
  stale_lanes: number;
  missing_closed_at: number;
  truth_failures: number;
  stale_rate: number;
  missing_closed_at_rate: number;
  truth_failure_rate: number;
  median_cycle_hours: number | null;
};

export type AgentScoreboard = {
  generated_at: string;
  lane_count: number;
  active_lane_count: number;
  stale_lane_count: number;
  missing_closed_at_count: number;
  truth_failure_count: number;
  agents: AgentScore[];
};

const DONE_STATUSES = new Set(['done', 'merged', 'closed', 'cancelled', 'abandoned']);
const SUCCESS_STATUSES = new Set(['done', 'merged', 'closed']);
const STALE_MS = 24 * 60 * 60 * 1000;

function agentName(lane: AgentLaneInput): string {
  return lane.created_by?.trim() || lane.lane_type?.trim() || 'unknown';
}

function isActive(lane: AgentLaneInput): boolean {
  return !DONE_STATUSES.has(lane.status);
}

function parseTime(input: string | null | undefined): number | null {
  if (!input) return null;
  const value = new Date(input).getTime();
  return Number.isFinite(value) ? value : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[midpoint]!;
  return (sorted[midpoint - 1]! + sorted[midpoint]!) / 2;
}

function hasTruthFailure(lane: AgentLaneInput): boolean {
  return (lane.truth_check_history ?? []).some((entry) => {
    const verdict = entry.verdict?.toLowerCase();
    return verdict === 'fail' || (entry.exit_code != null && entry.exit_code !== 0);
  });
}

export function buildAgentScoreboard(
  lanes: AgentLaneInput[],
  now = new Date(),
): AgentScoreboard {
  const nowMs = now.getTime();
  const groups = new Map<string, AgentLaneInput[]>();
  for (const lane of lanes) {
    const key = agentName(lane);
    groups.set(key, [...(groups.get(key) ?? []), lane]);
  }

  const agents: AgentScore[] = [];
  let activeLaneCount = 0;
  let staleLaneCount = 0;
  let missingClosedAtCount = 0;
  let truthFailureCount = 0;

  for (const [agent, agentLanes] of [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const cycleHours: number[] = [];
    let activeLanes = 0;
    let doneLanes = 0;
    let staleLanes = 0;
    let missingClosedAt = 0;
    let truthFailures = 0;

    for (const lane of agentLanes) {
      const active = isActive(lane);
      if (active) {
        activeLanes += 1;
        activeLaneCount += 1;
        const heartbeat = parseTime(lane.heartbeat_at);
        if (heartbeat == null || nowMs - heartbeat > STALE_MS) {
          staleLanes += 1;
          staleLaneCount += 1;
        }
      }

      if (SUCCESS_STATUSES.has(lane.status)) {
        doneLanes += 1;
        if (!lane.closed_at) {
          missingClosedAt += 1;
          missingClosedAtCount += 1;
        }
      }

      if (hasTruthFailure(lane)) {
        truthFailures += 1;
        truthFailureCount += 1;
      }

      const started = parseTime(lane.started_at);
      const closed = parseTime(lane.closed_at);
      if (started != null && closed != null && closed >= started) {
        cycleHours.push((closed - started) / 3_600_000);
      }
    }

    agents.push({
      agent,
      total_lanes: agentLanes.length,
      active_lanes: activeLanes,
      done_lanes: doneLanes,
      stale_lanes: staleLanes,
      missing_closed_at: missingClosedAt,
      truth_failures: truthFailures,
      stale_rate: activeLanes === 0 ? 0 : staleLanes / activeLanes,
      missing_closed_at_rate: doneLanes === 0 ? 0 : missingClosedAt / doneLanes,
      truth_failure_rate: agentLanes.length === 0 ? 0 : truthFailures / agentLanes.length,
      median_cycle_hours: median(cycleHours),
    });
  }

  return {
    generated_at: now.toISOString(),
    lane_count: lanes.length,
    active_lane_count: activeLaneCount,
    stale_lane_count: staleLaneCount,
    missing_closed_at_count: missingClosedAtCount,
    truth_failure_count: truthFailureCount,
    agents,
  };
}

function readLanes(dir = path.join(ROOT, 'docs', '06_status', 'lanes')): AgentLaneInput[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => {
      const raw = fs.readFileSync(path.join(dir, entry), 'utf8');
      return JSON.parse(raw) as AgentLaneInput;
    });
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printHuman(report: AgentScoreboard): void {
  console.log(`Agent Scoreboard - ${report.generated_at}`);
  console.log('='.repeat(72));
  console.log(
    `lanes=${report.lane_count} active=${report.active_lane_count} stale=${report.stale_lane_count} missing_closed_at=${report.missing_closed_at_count} truth_failures=${report.truth_failure_count}`,
  );
  console.log('');
  for (const agent of report.agents) {
    const cycle =
      agent.median_cycle_hours == null ? 'n/a' : `${agent.median_cycle_hours.toFixed(1)}h`;
    console.log(
      `${agent.agent.padEnd(14)} total=${String(agent.total_lanes).padStart(3)} active=${String(agent.active_lanes).padStart(2)} stale=${formatPct(agent.stale_rate).padStart(6)} missing_closed_at=${formatPct(agent.missing_closed_at_rate).padStart(6)} truth_fail=${formatPct(agent.truth_failure_rate).padStart(6)} median_cycle=${cycle}`,
    );
  }
}

function main(): void {
  const { bools } = parseArgs(process.argv.slice(2));
  const report = buildAgentScoreboard(readLanes());
  if (bools.has('json')) {
    emitJson(report);
    return;
  }
  printHuman(report);
}

if (process.argv[1]?.endsWith('agent-scoreboard.ts')) {
  main();
}
