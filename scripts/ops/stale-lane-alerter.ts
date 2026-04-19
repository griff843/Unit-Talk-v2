/**
 * UTV2-670: Read-only stale lane alerter
 *
 * Compares lane manifests against GitHub PR/branch state and Linear issue state.
 * Emits a structured drift report and posts a Discord alert on drift.
 * Never mutates manifests or closes lanes.
 *
 * Exit 0 always — drift is reported, not fatal.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  emitJson,
  ensureDir,
  readAllManifests,
  type LaneManifest,
} from './shared.js';

// ── Types ──────────────────────────────────────────────────────────────────

type DriftKind =
  | 'pr_merged_lane_open'
  | 'branch_deleted_lane_open'
  | 'linear_done_lane_open'
  | 'done_missing_closed_at'
  | 'zombie_lane';

interface DriftEntry {
  issue_id: string;
  kind: DriftKind;
  detail: string;
  manifest_status: string;
  pr_url: string | null;
  branch: string;
}

interface StaleLaneReport {
  schema_version: 1;
  run_at: string;
  mode: 'local' | 'scheduled';
  repo: string;
  manifest_count: number;
  drift_count: number;
  drift: DriftEntry[];
  infra_errors: string[];
}

// ── Config ─────────────────────────────────────────────────────────────────

const ZOMBIE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours
const LANE_DRIFT_DIR = path.join(ROOT, '.out', 'ops', 'lane-drift');

const githubToken = process.env.GITHUB_TOKEN?.trim() ?? '';
const repoSlug =
  process.env.GITHUB_REPOSITORY?.trim() ?? deriveRepoSlug();
const linearToken = process.env.LINEAR_API_TOKEN?.trim() ?? '';
const webhookUrl = process.env.UNIT_TALK_OPS_ALERT_WEBHOOK_URL?.trim() ?? '';
const writeResult = process.argv.includes('--write-result');
const jsonMode = process.argv.includes('--json');

// ── GitHub helpers ─────────────────────────────────────────────────────────

async function githubGet<T>(endpoint: string): Promise<{ ok: boolean; data?: T; status: number }> {
  if (!githubToken) {
    return { ok: false, status: 0 };
  }
  try {
    const response = await fetch(`https://api.github.com/repos/${repoSlug}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'unit-talk-ops-stale-lane-alerter',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { ok: false, status: response.status };
    }
    return { ok: true, data: (await response.json()) as T, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function isPrMerged(prUrl: string): Promise<boolean | null> {
  const match = prUrl.match(/\/pull\/(\d+)$/);
  if (!match) return null;
  const result = await githubGet<{ state: string; merged: boolean }>(
    `/pulls/${match[1]}`,
  );
  if (!result.ok || !result.data) return null;
  return result.data.merged === true;
}

async function branchExistsOnRemote(branch: string): Promise<boolean | null> {
  const result = await githubGet<unknown>(`/branches/${encodeURIComponent(branch)}`);
  if (result.status === 404) return false;
  if (!result.ok) return null;
  return true;
}

// ── Linear helper ──────────────────────────────────────────────────────────

async function getLinearIssueState(issueId: string): Promise<string | null> {
  if (!linearToken) return null;
  try {
    const identifier = issueId.toUpperCase();
    const body = JSON.stringify({
      query: `query { issue(id: "${identifier}") { state { type } } }`,
    });
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        Authorization: linearToken,
        'Content-Type': 'application/json',
        'User-Agent': 'unit-talk-ops-stale-lane-alerter',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      data?: { issue?: { state?: { type?: string } } };
    };
    return json.data?.issue?.state?.type ?? null;
  } catch {
    return null;
  }
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

// ── Git helper ─────────────────────────────────────────────────────────────

function deriveRepoSlug(): string {
  try {
    const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    const origin = ((result.stdout as string | null) ?? '').trim();
    const match = origin.match(/github\.com[:/](.+?)(?:\.git)?$/i);
    return match?.[1] ?? 'unknown/unknown';
  } catch {
    return 'unknown/unknown';
  }
}

// ── Drift checks ───────────────────────────────────────────────────────────

async function checkManifest(
  manifest: LaneManifest,
  infraErrors: string[],
): Promise<DriftEntry[]> {
  const entries: DriftEntry[] = [];
  const isDone = manifest.status === 'done';
  const isActive = !isDone;

  // 1. Done but missing closed_at
  if (isDone && !manifest.closed_at) {
    entries.push({
      issue_id: manifest.issue_id,
      kind: 'done_missing_closed_at',
      detail: 'status is done but closed_at is null',
      manifest_status: manifest.status,
      pr_url: manifest.pr_url,
      branch: manifest.branch,
    });
  }

  if (!isActive) return entries;

  // 2. PR merged but lane not closed
  if (manifest.pr_url) {
    const merged = await isPrMerged(manifest.pr_url);
    if (merged === null) {
      if (githubToken) {
        infraErrors.push(
          `${manifest.issue_id}: could not determine PR merge state for ${manifest.pr_url}`,
        );
      }
    } else if (merged) {
      entries.push({
        issue_id: manifest.issue_id,
        kind: 'pr_merged_lane_open',
        detail: `PR is merged but lane status is "${manifest.status}"`,
        manifest_status: manifest.status,
        pr_url: manifest.pr_url,
        branch: manifest.branch,
      });
    }
  }

  // 3. Branch deleted on remote but lane not closed
  const branchOnRemote = await branchExistsOnRemote(manifest.branch);
  if (branchOnRemote === null) {
    if (githubToken) {
      infraErrors.push(
        `${manifest.issue_id}: could not determine remote branch state for ${manifest.branch}`,
      );
    }
  } else if (!branchOnRemote) {
    entries.push({
      issue_id: manifest.issue_id,
      kind: 'branch_deleted_lane_open',
      detail: `branch "${manifest.branch}" no longer exists on remote but lane is still open`,
      manifest_status: manifest.status,
      pr_url: manifest.pr_url,
      branch: manifest.branch,
    });
  }

  // 4. Linear issue Done/Cancelled but lane open
  const linearState = await getLinearIssueState(manifest.issue_id);
  if (linearState !== null && (linearState === 'completed' || linearState === 'cancelled')) {
    entries.push({
      issue_id: manifest.issue_id,
      kind: 'linear_done_lane_open',
      detail: `Linear issue state is "${linearState}" but lane status is "${manifest.status}"`,
      manifest_status: manifest.status,
      pr_url: manifest.pr_url,
      branch: manifest.branch,
    });
  }

  // 5. Zombie: in_progress with heartbeat older than 48h
  if (manifest.status === 'in_progress' && manifest.heartbeat_at) {
    const ageMs = Date.now() - Date.parse(manifest.heartbeat_at);
    if (ageMs > ZOMBIE_THRESHOLD_MS) {
      const ageHours = Math.round(ageMs / (60 * 60 * 1000));
      entries.push({
        issue_id: manifest.issue_id,
        kind: 'zombie_lane',
        detail: `heartbeat_at is ${ageHours}h old (threshold: 48h) — lane may be abandoned`,
        manifest_status: manifest.status,
        pr_url: manifest.pr_url,
        branch: manifest.branch,
      });
    }
  }

  return entries;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const runAt = new Date().toISOString();
  const mode: StaleLaneReport['mode'] =
    process.env.GITHUB_ACTIONS === 'true' ? 'scheduled' : 'local';

  const manifests = readAllManifests();
  const infraErrors: string[] = [];
  const allDrift: DriftEntry[] = [];

  for (const manifest of manifests) {
    const drift = await checkManifest(manifest, infraErrors);
    allDrift.push(...drift);
  }

  const report: StaleLaneReport = {
    schema_version: 1,
    run_at: runAt,
    mode,
    repo: repoSlug,
    manifest_count: manifests.length,
    drift_count: allDrift.length,
    drift: allDrift,
    infra_errors: infraErrors,
  };

  if (writeResult) {
    ensureDir(LANE_DRIFT_DIR);
    const filename = runAt.replace(/[:]/g, '-').slice(0, 19) + '.json';
    const outPath = path.join(LANE_DRIFT_DIR, filename);
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (jsonMode) {
    emitJson(report);
  } else {
    console.log(`[stale-lane-alerter] run_at=${runAt} mode=${mode}`);
    console.log(`  manifests: ${manifests.length}`);
    console.log(`  drift:     ${allDrift.length}`);
    if (allDrift.length > 0) {
      for (const entry of allDrift) {
        console.log(`  [${entry.kind}] ${entry.issue_id}: ${entry.detail}`);
      }
    }
    if (infraErrors.length > 0) {
      console.log(`  infra_errors: ${infraErrors.length}`);
      for (const err of infraErrors) {
        console.log(`    ${err}`);
      }
    }
    console.log(`  verdict: ${allDrift.length > 0 ? 'DRIFT_DETECTED' : 'CLEAN'}`);
  }

  if (allDrift.length > 0) {
    const lines = [
      `**[stale-lane-alerter] ${allDrift.length} drift item(s) detected** — ${runAt}`,
      '',
      ...allDrift.map(
        (d) =>
          `- \`${d.issue_id}\` [${d.kind}]: ${d.detail}`,
      ),
    ];
    if (infraErrors.length > 0) {
      lines.push('', `_${infraErrors.length} check(s) skipped (no GitHub/Linear token)_`);
    }
    await postOpsAlert(lines.join('\n'));
  }

  // Always exit 0 — drift is an alert, not a failure
  process.exitCode = 0;
}

void main().catch((error: unknown) => {
  console.error(
    '[stale-lane-alerter] fatal:',
    error instanceof Error ? error.message : String(error),
  );
  // Still exit 0 — alerter must not block CI
  process.exitCode = 0;
});
