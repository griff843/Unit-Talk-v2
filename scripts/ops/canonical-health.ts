/**
 * scripts/ops/canonical-health.ts — UTV2-983
 * Canonical runtime truth command: one output, all signals.
 *
 * Aggregates:
 *   - ops:health (lane registry, branches, worktrees — local/git, no DB)
 *   - runtime:health (API/worker/scheduler/queue/provider/delivery — DB-backed)
 *   - pipeline:health (outbox, SLO, worker verdict — DB-backed)
 *
 * Usage:
 *   pnpm ops:runtime-health
 *   pnpm ops:runtime-health -- --json
 *
 * Exit codes:
 *   0 — all sections HEALTHY or DEGRADED
 *   1 — at least one section FAILED/BLOCKED or errored
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, parseArgs } from './shared.js';

// ── Types ─────────────────────────────────────────────────────────────────────

type OverallState = 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'UNKNOWN';

export interface HealthSection {
  source: string;
  state: OverallState;
  summary: string;
  detail?: unknown;
  error?: string;
}

export interface CanonicalHealthReport {
  schema_version: 1;
  reported_at: string;
  overall: OverallState;
  sections: HealthSection[];
  failed_sources: string[];
}

// ── Sub-process runner ────────────────────────────────────────────────────────

const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');

function runScript(
  scriptPath: string,
  args: string[] = [],
): { exitCode: number; stdout: string; stderr: string; error: string | null } {
  const result = spawnSync(TSX, [path.join(ROOT, scriptPath), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    env: process.env,
  });

  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message ?? null,
  };
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Section: ops:health (local/git) ──────────────────────────────────────────

function collectOpsHealth(): HealthSection {
  const result = runScript('scripts/ops-health.ts', ['--json']);

  if (result.error) {
    return { source: 'ops:health', state: 'UNKNOWN', summary: 'spawn error', error: result.error };
  }

  const data = tryParseJson(result.stdout) as { verdict?: string; items?: { severity: string; message: string }[] } | null;

  if (!data) {
    return {
      source: 'ops:health',
      state: 'UNKNOWN',
      summary: 'parse error',
      error: result.stderr || 'no JSON output',
    };
  }

  const state: OverallState =
    data.verdict === 'BLOCKED' ? 'FAILED' :
    data.verdict === 'DEGRADED' ? 'DEGRADED' :
    data.verdict === 'HEALTHY' ? 'HEALTHY' : 'UNKNOWN';

  const blockers = (data.items ?? []).filter((i) => i.severity === 'blocker');
  const warns = (data.items ?? []).filter((i) => i.severity === 'warn');

  return {
    source: 'ops:health',
    state,
    summary: blockers.length > 0
      ? `${blockers.length} blocker(s): ${blockers.map((i) => i.message).join('; ')}`
      : warns.length > 0
      ? `${warns.length} warning(s) — see detail`
      : 'lane registry and branches clean',
    detail: data,
  };
}

// ── Section: runtime:health (DB-backed) ──────────────────────────────────────

function collectRuntimeHealth(): HealthSection {
  const result = runScript('scripts/runtime-health.ts', ['--json']);

  if (result.error) {
    return { source: 'runtime:health', state: 'UNKNOWN', summary: 'spawn error', error: result.error };
  }

  const data = tryParseJson(result.stdout) as {
    overall_state?: string;
    state?: string;
    failed?: string[];
    degraded?: string[];
    subsystems?: { name: string; state: string }[];
  } | null;

  if (!data) {
    return {
      source: 'runtime:health',
      state: 'UNKNOWN',
      summary: 'parse error',
      error: result.stderr || 'no JSON output',
    };
  }

  const rawState = data.overall_state ?? data.state ?? 'UNKNOWN';
  const state: OverallState =
    rawState === 'FAILED' ? 'FAILED' :
    rawState === 'DEGRADED' ? 'DEGRADED' :
    rawState === 'HEALTHY' ? 'HEALTHY' : 'UNKNOWN';

  const failed = data.failed ?? [];
  const degraded = data.degraded ?? [];

  return {
    source: 'runtime:health',
    state,
    summary: failed.length > 0
      ? `FAILED: ${failed.slice(0, 3).join('; ')}`
      : degraded.length > 0
      ? `DEGRADED: ${degraded.slice(0, 3).join('; ')}`
      : 'all subsystems healthy',
    detail: data,
  };
}

// ── Section: pipeline:health (DB-backed) ─────────────────────────────────────

function collectPipelineHealth(): HealthSection {
  const tmpFile = path.join(os.tmpdir(), `utv2-983-pipeline-${Date.now()}.json`);

  try {
    const result = runScript('scripts/pipeline-health.ts', ['--output-json', tmpFile]);

    if (result.error) {
      return { source: 'pipeline:health', state: 'UNKNOWN', summary: 'spawn error', error: result.error };
    }

    if (!fs.existsSync(tmpFile)) {
      return {
        source: 'pipeline:health',
        state: 'UNKNOWN',
        summary: 'no output file produced',
        error: result.stderr || undefined,
      };
    }

    const data = tryParseJson(fs.readFileSync(tmpFile, 'utf8')) as {
      criticals?: string[];
      warnings?: string[];
      queue_health_status?: string;
      outbox_dead_letter_count?: number;
      outbox_governance_brake_count?: number;
    } | null;

    if (!data) {
      return { source: 'pipeline:health', state: 'UNKNOWN', summary: 'parse error' };
    }

    const criticals = data.criticals ?? [];
    const warnings = data.warnings ?? [];
    const deadLetter = data.outbox_dead_letter_count ?? 0;
    const governanceBrake = data.outbox_governance_brake_count ?? 0;

    // governance brake rows (P7A, proof-pick-blocked) are expected designed behaviour.
    // They appear in warnings[] from pipeline-health but must not trigger FAILED here.
    // Only true dead-letter failures (outbox_dead_letter_count) escalate to FAILED.
    const state: OverallState =
      criticals.length > 0 || deadLetter > 0 ? 'FAILED' :
      warnings.length > 0 ? 'DEGRADED' :
      result.exitCode === 0 ? 'HEALTHY' : 'DEGRADED';

    const summaryParts: string[] = [];
    if (criticals.length > 0) summaryParts.push(`CRITICAL: ${criticals.slice(0, 3).join('; ')}`);
    else if (deadLetter > 0) summaryParts.push(`${deadLetter} true dead-letter failure(s)`);
    if (governanceBrake > 0) summaryParts.push(`${governanceBrake} governance brake row(s) (P7A, expected)`);
    if (summaryParts.length === 0 && warnings.length > 0) summaryParts.push(`${warnings.length} warning(s) — see detail`);

    return {
      source: 'pipeline:health',
      state,
      summary: summaryParts.length > 0 ? summaryParts.join(' | ') : 'outbox and pipeline healthy',
      detail: data,
    };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

// ── Aggregate ─────────────────────────────────────────────────────────────────

function aggregate(sections: HealthSection[]): OverallState {
  if (sections.some((s) => s.state === 'FAILED')) return 'FAILED';
  if (sections.some((s) => s.state === 'UNKNOWN')) return 'DEGRADED';
  if (sections.some((s) => s.state === 'DEGRADED')) return 'DEGRADED';
  return 'HEALTHY';
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function main(argv = process.argv.slice(2)): void {
  const parsed = parseArgs(argv);
  const jsonMode = parsed.bools.has('json');
  const reportedAt = new Date().toISOString();

  const sections: HealthSection[] = [
    collectOpsHealth(),
    collectRuntimeHealth(),
    collectPipelineHealth(),
  ];

  const overall = aggregate(sections);
  const failedSources = sections
    .filter((s) => s.state === 'FAILED' || s.state === 'UNKNOWN')
    .map((s) => s.source);

  const report: CanonicalHealthReport = {
    schema_version: 1,
    reported_at: reportedAt,
    overall,
    sections,
    failed_sources: failedSources,
  };

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const stateIcon = (s: OverallState) =>
      s === 'HEALTHY' ? '✓' : s === 'DEGRADED' ? '⚠' : s === 'FAILED' ? '✗' : '?';

    console.log(`\nCANONICAL RUNTIME HEALTH — ${reportedAt}`);
    console.log('═'.repeat(62));
    for (const sec of sections) {
      const icon = stateIcon(sec.state);
      console.log(`  ${icon} ${sec.source.padEnd(20)} ${sec.state.padEnd(9)}  ${sec.summary}`);
    }
    console.log('═'.repeat(62));
    console.log(`  OVERALL: ${overall}`);
    if (failedSources.length > 0) {
      console.log(`  Failed sources: ${failedSources.join(', ')}`);
    }
    console.log();
  }

  process.exit(overall === 'FAILED' ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
