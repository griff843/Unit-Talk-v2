/**
 * UTV2-1041 — Burn-in report generator
 *
 * Aggregates all burn-in snapshots collected over 72 hours and produces a
 * final pass/fail verdict. The report JSON becomes the T1 proof artifact.
 *
 * Usage:
 *   tsx scripts/ops/burn-in-report.ts \
 *     --snapshots-dir artifacts/snapshots \
 *     --output artifacts/burn-in-report.json \
 *     --deployment-sha <sha> \
 *     [--fail-on-fail]
 *
 * Exits 0 unless verdict is FAIL and --fail-on-fail is passed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BurnInSnapshot } from './burn-in-snapshot.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Verdict = 'PASS' | 'FAIL' | 'INCOMPLETE';

interface CriteriaSummary {
  apiAlwaysReachable: boolean;
  dbAlwaysReachable: boolean;
  noDeadLetters: boolean;
  ingestorAlwaysFresh: boolean;
  noOutboxDeadLetters: boolean;
}

interface SnapshotSummary {
  index: number;
  at: string;
  passing: boolean;
  failures: string[];
}

export interface BurnInReport {
  deploymentSha: string;
  burnInStarted: string;
  burnInCompleted: string;
  durationHours: number;
  snapshotCount: number;
  requiredSnapshots: number;
  verdict: Verdict;
  failedSnapshots: number;
  criticalFailures: string[];
  clockReset: boolean;
  criteria: CriteriaSummary;
  snapshots: SnapshotSummary[];
}

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  snapshotsDir: string;
  output: string;
  deploymentSha: string;
  failOnFail: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let snapshotsDir = 'artifacts/snapshots';
  let output = 'artifacts/burn-in-report.json';
  let deploymentSha = 'bd952fd7211d92eab782da273f11fa386dc22ca0';
  let failOnFail = false;

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--snapshots-dir' && argv[i + 1] !== undefined) {
      snapshotsDir = argv[i + 1]!;
      i++;
    } else if (argv[i] === '--output' && argv[i + 1] !== undefined) {
      output = argv[i + 1]!;
      i++;
    } else if (argv[i] === '--deployment-sha' && argv[i + 1] !== undefined) {
      deploymentSha = argv[i + 1]!;
      i++;
    } else if (argv[i] === '--fail-on-fail') {
      failOnFail = true;
    }
  }

  return { snapshotsDir, output, deploymentSha, failOnFail };
}

// ---------------------------------------------------------------------------
// Snapshot loading
// ---------------------------------------------------------------------------

function loadSnapshots(snapshotsDir: string): BurnInSnapshot[] {
  if (!fs.existsSync(snapshotsDir)) {
    console.warn(`[burn-in-report] Snapshots directory not found: ${snapshotsDir}`);
    return [];
  }

  const entries = fs.readdirSync(snapshotsDir);
  const snapFiles = entries
    .filter((f) => /^snap-\d+\.json$/.test(f))
    .sort((a, b) => {
      // Sort numerically by the index embedded in the filename.
      const aIndex = Number.parseInt(a.replace('snap-', '').replace('.json', ''), 10);
      const bIndex = Number.parseInt(b.replace('snap-', '').replace('.json', ''), 10);
      return aIndex - bIndex;
    });

  const snapshots: BurnInSnapshot[] = [];

  for (const file of snapFiles) {
    const fullPath = path.join(snapshotsDir, file);
    try {
      const raw = fs.readFileSync(fullPath, 'utf8');
      const parsed = JSON.parse(raw) as BurnInSnapshot;
      snapshots.push(parsed);
    } catch (err: unknown) {
      console.error(`[burn-in-report] Failed to parse snapshot file ${file}: ${String(err)}`);
    }
  }

  return snapshots;
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

const REQUIRED_SNAPSHOTS = 12; // 72h / 6h = 12
const REQUIRED_DURATION_HOURS = 72;

function generateReport(snapshots: BurnInSnapshot[], deploymentSha: string): BurnInReport {
  if (snapshots.length === 0) {
    return {
      deploymentSha,
      burnInStarted: '',
      burnInCompleted: '',
      durationHours: 0,
      snapshotCount: 0,
      requiredSnapshots: REQUIRED_SNAPSHOTS,
      verdict: 'INCOMPLETE',
      failedSnapshots: 0,
      criticalFailures: [],
      clockReset: false,
      criteria: {
        apiAlwaysReachable: false,
        dbAlwaysReachable: false,
        noDeadLetters: false,
        ingestorAlwaysFresh: false,
        noOutboxDeadLetters: false,
      },
      snapshots: [],
    };
  }

  // Temporal bounds
  const timestamps = snapshots.map((s) => new Date(s.snapshotAt).getTime());
  const earliestMs = Math.min(...timestamps);
  const latestMs = Math.max(...timestamps);
  const durationHours = (latestMs - earliestMs) / (1000 * 60 * 60);

  const burnInStarted = new Date(earliestMs).toISOString();
  const burnInCompleted = new Date(latestMs).toISOString();

  // Failure analysis
  const failedSnapshotList = snapshots.filter((s) => !s.passing);
  const failedSnapshots = failedSnapshotList.length;

  // Collect all unique failing criteria across all snapshots
  const allFailures = new Set<string>();
  for (const snap of snapshots) {
    for (const f of snap.failures) {
      allFailures.add(f);
    }
  }
  const criticalFailures = Array.from(allFailures).sort();

  // Per-criterion aggregation
  const criteria: CriteriaSummary = {
    apiAlwaysReachable: snapshots.every((s) => s.api.reachable),
    dbAlwaysReachable: snapshots.every(
      (s) => s.api.reachable && s.api.dbReachable === true,
    ),
    noDeadLetters: snapshots.every(
      (s) =>
        s.api.queueHealth === null ||
        s.api.queueHealth.deadLetterCount === 0,
    ),
    ingestorAlwaysFresh: snapshots.every((s) => s.ingestor.fresh),
    noOutboxDeadLetters: snapshots.every(
      (s) => s.outbox === null || s.outbox.dead_letter === 0,
    ),
  };

  // Clock reset: any failed snapshot means the 72h clock reset (conceptually).
  const clockReset = failedSnapshots > 0;

  // Verdict
  let verdict: Verdict;
  if (snapshots.length < REQUIRED_SNAPSHOTS) {
    verdict = 'INCOMPLETE';
  } else if (failedSnapshots > 0) {
    verdict = 'FAIL';
  } else if (durationHours < REQUIRED_DURATION_HOURS) {
    verdict = 'INCOMPLETE';
  } else {
    verdict = 'PASS';
  }

  const snapshotSummaries: SnapshotSummary[] = snapshots.map((s) => ({
    index: s.snapshotIndex,
    at: s.snapshotAt,
    passing: s.passing,
    failures: s.failures,
  }));

  return {
    deploymentSha,
    burnInStarted,
    burnInCompleted,
    durationHours: Math.round(durationHours * 100) / 100,
    snapshotCount: snapshots.length,
    requiredSnapshots: REQUIRED_SNAPSHOTS,
    verdict,
    failedSnapshots,
    criticalFailures,
    clockReset,
    criteria,
    snapshots: snapshotSummaries,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const { snapshotsDir, output, deploymentSha, failOnFail } = parseArgs(process.argv);

  console.log(`[burn-in-report] Loading snapshots from ${snapshotsDir}`);
  const snapshots = loadSnapshots(snapshotsDir);
  console.log(`[burn-in-report] Loaded ${snapshots.length} snapshot(s)`);

  const report = generateReport(snapshots, deploymentSha);

  const outputDir = path.dirname(output);
  if (outputDir && !fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(output, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[burn-in-report] Report written to ${output}`);

  // Print summary
  console.log('');
  console.log('=== BURN-IN REPORT SUMMARY ===');
  console.log(`Verdict:          ${report.verdict}`);
  console.log(`Deployment SHA:   ${report.deploymentSha}`);
  console.log(`Duration:         ${report.durationHours}h`);
  console.log(`Snapshots:        ${report.snapshotCount}/${report.requiredSnapshots}`);
  console.log(`Failed snapshots: ${report.failedSnapshots}`);
  console.log(`Clock reset:      ${report.clockReset}`);
  if (report.criticalFailures.length > 0) {
    console.log(`Critical failures: ${report.criticalFailures.join(', ')}`);
  }
  console.log('');
  console.log('Criteria:');
  for (const [key, value] of Object.entries(report.criteria)) {
    console.log(`  ${key}: ${value ? 'PASS' : 'FAIL'}`);
  }
  console.log('==============================');

  if (failOnFail && report.verdict === 'FAIL') {
    console.error('[burn-in-report] Verdict is FAIL and --fail-on-fail is set. Exiting 1.');
    process.exit(1);
  }

  process.exit(0);
}

main();
