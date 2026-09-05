import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  GovernanceBoardSnapshot,
  LaneState,
  LaneSummary,
  PmVerdictStatus,
  TruthCheckStatus,
} from './governance-contract';

type ManifestTruthCheck = { verdict?: unknown };

type LaneManifest = {
  issue_id?: unknown;
  tier?: unknown;
  status?: unknown;
  branch?: unknown;
  pr_url?: unknown;
  commit_sha?: unknown;
  blocked_by?: unknown;
  heartbeat_at?: unknown;
  truth_check_history?: unknown;
  p0_protocol?: { human_approval?: { recorded?: unknown } };
};

const ACTIVE_STATES = new Set<LaneState>(['started', 'in_progress', 'in_review', 'reopened']);

export interface GovernanceSnapshotOptions {
  manifestDirectory?: string;
  observedAt?: string;
}

/**
 * The unauthenticated manifest reader, deliberately isolated in its own module.
 *
 * It used to be an ordinary named export of `governance-board.ts`, and the ban
 * that kept it out of application code was a substring search for its
 * identifier. Two evasions passed that ban with a green suite: an allow-listed
 * owner re-exporting it under an alias, and `import * as gb` plus a computed
 * key. Both are searches for a *name*, and a name is not a boundary.
 *
 * Isolating it makes the boundary the module specifier instead. An alias
 * re-export must import this file to create the alias, and a computed key has
 * nothing to reach because `governance-board.ts` no longer exports it at all.
 * `privileged-boundary-guard.test.ts` resolves import specifiers structurally,
 * so either evasion now names this module and is caught.
 *
 * Application code must use `getGovernanceBoardSnapshot` so request
 * authentication cannot be forgotten.
 */
export async function readGovernanceBoardSnapshotUnauthenticated(
  options: GovernanceSnapshotOptions = {},
): Promise<GovernanceBoardSnapshot> {
  const observedAt = options.observedAt ?? new Date().toISOString();
  const manifestDirectory = options.manifestDirectory ?? resolveManifestDirectory();

  let entries: string[];
  try {
    entries = await readdir(manifestDirectory);
  } catch {
    return emptySnapshot(observedAt, ['Lane manifest directory is unavailable.']);
  }

  const results = await Promise.all(
    entries
      .filter((entry) => entry.endsWith('.json'))
      .map(async (entry) => {
        try {
          return JSON.parse(await readFile(path.join(manifestDirectory, entry), 'utf8')) as LaneManifest;
        } catch {
          return null;
        }
      }),
  );

  const lanes = results
    .filter((manifest): manifest is LaneManifest => manifest !== null)
    .map(toLaneSummary)
    .filter((lane): lane is LaneSummary => lane !== null)
    .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));

  return {
    observedAt,
    sourceStatus: 'degraded',
    missingSources: [
      'Linear title, owner, and workflow state are not available from lane manifests.',
      'PM verdicts are only shown when recorded in a lane manifest.',
    ],
    activeLanes: lanes.filter((lane) => ACTIVE_STATES.has(lane.laneState)),
    blockedLanes: lanes.filter((lane) => lane.laneState === 'blocked'),
    awaitingPmVerdict: lanes.filter((lane) => lane.pmVerdict === 'pending'),
  };
}

function toLaneSummary(manifest: LaneManifest): LaneSummary | null {
  const issueId = stringOrNull(manifest.issue_id);
  const laneState = laneStateOrNull(manifest.status);
  if (!issueId || !laneState) return null;

  return {
    issueId,
    title: null,
    tier: laneTierOrNull(manifest.tier),
    laneState,
    owner: null,
    branch: stringOrNull(manifest.branch),
    prUrl: stringOrNull(manifest.pr_url),
    mergeSha: stringOrNull(manifest.commit_sha),
    truthCheck: truthCheckStatus(manifest.truth_check_history),
    pmVerdict: pmVerdictStatus(manifest.p0_protocol),
    blockerReason: blockerReason(manifest.blocked_by),
    nextAction: null,
    updatedAt: stringOrNull(manifest.heartbeat_at),
  };
}

function resolveManifestDirectory(): string {
  let directory = process.cwd();
  while (path.dirname(directory) !== directory) {
    const candidate = path.join(directory, 'docs', '06_status', 'lanes');
    if (existsSync(candidate)) return candidate;
    directory = path.dirname(directory);
  }
  return path.join(process.cwd(), 'docs', '06_status', 'lanes');
}

function emptySnapshot(observedAt: string, missingSources: string[]): GovernanceBoardSnapshot {
  return { observedAt, sourceStatus: 'unavailable', missingSources, activeLanes: [], blockedLanes: [], awaitingPmVerdict: [] };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function laneTierOrNull(value: unknown): LaneSummary['tier'] {
  return value === 'T1' || value === 'T2' || value === 'T3' ? value : null;
}

function laneStateOrNull(value: unknown): LaneState | null {
  return value === 'started' || value === 'in_progress' || value === 'blocked' || value === 'in_review' || value === 'merged' || value === 'done' || value === 'reopened'
    ? value
    : null;
}

function truthCheckStatus(value: unknown): TruthCheckStatus {
  if (!Array.isArray(value) || value.length === 0) return 'not_run';
  const verdict = (value.at(-1) as ManifestTruthCheck | undefined)?.verdict;
  return verdict === 'pass' ? 'pass' : 'fail';
}

function pmVerdictStatus(protocol: LaneManifest['p0_protocol']): PmVerdictStatus {
  if (!protocol?.human_approval) return 'not_available';
  return protocol.human_approval.recorded === true ? 'approved' : 'pending';
}

function blockerReason(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === 'string')) return null;
  return value.join('; ');
}
