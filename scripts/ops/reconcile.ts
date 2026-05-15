/**
 * ops:reconcile — scheduled stranded lane detection (EXECUTION_TRUTH_MODEL.md §7)
 *
 * Detects and mutates manifests for stale/stranded/orphaned lanes:
 *   stale:    heartbeat_at 4-24h old → logged in digest, no manifest write
 *   stranded: heartbeat_at >24h → status → blocked, truth_check_history appended
 *   orphaned: branch deleted on remote but manifest active → logged in digest
 *
 * Does not modify branches or Linear state. Idempotent — safe to re-run.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readAllManifests, type LaneManifest } from './shared.js';

// ── Thresholds (EXECUTION_TRUTH_MODEL.md §7) ─────────────────────────────────

const STALE_MS = 4 * 60 * 60 * 1000;    // 4 hours  → stale (report only)
const STRANDED_MS = 24 * 60 * 60 * 1000; // 24 hours → blocked (write manifest)

// ── Types ──────────────────────────────────────────────────────────────────────

type ReconcileVerdict = 'stale' | 'stranded' | 'orphaned' | 'clean';

interface ReconcileEntry {
  issue_id: string;
  verdict: ReconcileVerdict;
  detail: string;
  branch: string;
  heartbeat_age_h: number | null;
  action_taken: string;
}

interface ReconcileDigest {
  schema_version: 1;
  run_at: string;
  mode: 'local' | 'scheduled';
  manifest_count: number;
  active_count: number;
  mutations: number;
  entries: ReconcileEntry[];
}

// ── Branch existence check ────────────────────────────────────────────────────

function branchExistsOnRemote(branch: string): boolean | null {
  try {
    const result = spawnSync(
      'git',
      ['ls-remote', '--exit-code', '--heads', 'origin', branch],
      { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' },
    );
    if (result.error) return null;
    // exit code 0 = exists, 2 = not found
    return result.status === 0;
  } catch {
    return null;
  }
}

// ── Manifest write helpers ────────────────────────────────────────────────────

function manifestPath(issueId: string): string {
  return path.join(ROOT, 'docs', '06_status', 'lanes', `${issueId}.json`);
}

function writeManifestJson(manifest: LaneManifest): void {
  const filePath = manifestPath(manifest.issue_id);
  fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

// ── Reconcile a single manifest ───────────────────────────────────────────────

function reconcileManifest(manifest: LaneManifest): ReconcileEntry {
  const now = Date.now();
  const heartbeatMs = manifest.heartbeat_at ? Date.parse(manifest.heartbeat_at) : null;
  const ageMs = heartbeatMs != null ? now - heartbeatMs : null;
  const ageH = ageMs != null ? Math.round(ageMs / (60 * 60 * 1000) * 10) / 10 : null;

  // Check orphaned first (branch gone → higher priority than heartbeat)
  const branchExists = branchExistsOnRemote(manifest.branch);
  if (branchExists === false) {
    return {
      issue_id: manifest.issue_id,
      verdict: 'orphaned',
      detail: `branch "${manifest.branch}" deleted on remote but manifest still active`,
      branch: manifest.branch,
      heartbeat_age_h: ageH,
      action_taken: 'logged — manual close required (ops:lane:close)',
    };
  }

  // Heartbeat checks
  if (ageMs != null && ageMs > STRANDED_MS) {
    // Mutate: transition to blocked
    const updated: LaneManifest = {
      ...manifest,
      status: 'blocked',
      heartbeat_at: manifest.heartbeat_at,
      truth_check_history: [
        ...(manifest.truth_check_history ?? []),
        {
          checked_at: new Date().toISOString(),
          verdict: 'fail',
          merge_sha: null,
          failures: [`heartbeat_at ${ageH}h old — exceeded 24h stranded threshold`],
          runner: 'ops:reconcile',
        },
      ],
    };
    writeManifestJson(updated);
    return {
      issue_id: manifest.issue_id,
      verdict: 'stranded',
      detail: `heartbeat_at ${ageH}h old (threshold: 24h)`,
      branch: manifest.branch,
      heartbeat_age_h: ageH,
      action_taken: 'status → blocked, truth_check_history appended',
    };
  }

  if (ageMs != null && ageMs > STALE_MS) {
    return {
      issue_id: manifest.issue_id,
      verdict: 'stale',
      detail: `heartbeat_at ${ageH}h old (threshold: 4h)`,
      branch: manifest.branch,
      heartbeat_age_h: ageH,
      action_taken: 'logged — PM notified, no manifest write',
    };
  }

  return {
    issue_id: manifest.issue_id,
    verdict: 'clean',
    detail: ageH != null ? `heartbeat ${ageH}h ago` : 'no heartbeat field',
    branch: manifest.branch,
    heartbeat_age_h: ageH,
    action_taken: 'none',
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const runAt = new Date().toISOString();
  const mode: ReconcileDigest['mode'] =
    process.env.GITHUB_ACTIONS === 'true' ? 'scheduled' : 'local';
  const jsonMode = process.argv.includes('--json');

  const allManifests = readAllManifests();
  const activeManifests = allManifests.filter(
    (m) => m.status !== 'done' && m.status !== 'merged',
  );

  const entries: ReconcileEntry[] = [];
  let mutations = 0;

  for (const manifest of activeManifests) {
    const entry = reconcileManifest(manifest);
    entries.push(entry);
    if (entry.verdict === 'stranded') mutations++;
  }

  const digest: ReconcileDigest = {
    schema_version: 1,
    run_at: runAt,
    mode,
    manifest_count: allManifests.length,
    active_count: activeManifests.length,
    mutations,
    entries: entries.filter((e) => e.verdict !== 'clean'),
  };

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(digest, null, 2)}\n`);
  } else {
    console.log(`[ops:reconcile] run_at=${runAt} mode=${mode}`);
    console.log(`  manifests: ${allManifests.length} total, ${activeManifests.length} active`);
    console.log(`  mutations: ${mutations}`);

    const byVerdict = (v: ReconcileVerdict) => entries.filter((e) => e.verdict === v);
    for (const e of byVerdict('stranded')) {
      console.log(`  [STRANDED] ${e.issue_id}: ${e.detail} → ${e.action_taken}`);
    }
    for (const e of byVerdict('orphaned')) {
      console.log(`  [ORPHANED] ${e.issue_id}: ${e.detail} → ${e.action_taken}`);
    }
    for (const e of byVerdict('stale')) {
      console.log(`  [STALE]    ${e.issue_id}: ${e.detail}`);
    }

    console.log(
      `  verdict: ${mutations > 0 ? 'MUTATIONS_APPLIED' : entries.some((e) => e.verdict !== 'clean') ? 'ISSUES_DETECTED' : 'CLEAN'}`,
    );
  }
}

main();
