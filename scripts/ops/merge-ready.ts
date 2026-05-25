#!/usr/bin/env tsx

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emitJson, getFlags, parseArgs, ROOT } from './shared.js';

export interface MergeReadyGate {
  id: string;
  command: string;
  args: string[];
  required: boolean;
  description: string;
}

export interface MergeReadyOptions {
  dryRun: boolean;
  json: boolean;
  gates: string[];
}

export interface MergeReadyGateResult {
  id: string;
  command: string[];
  status: 'pass' | 'fail' | 'dry_run';
  exit_code: number | null;
  stdout: string;
  stderr: string;
}

export interface MergeReadyReport {
  ok: boolean;
  dry_run: boolean;
  generated_at: string;
  gates: MergeReadyGateResult[];
  summary: {
    total: number;
    pass: number;
    fail: number;
    dry_run: number;
  };
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string },
) => Pick<SpawnSyncReturns<string>, 'status' | 'stdout' | 'stderr'>;

export const MERGE_READY_GATES: readonly MergeReadyGate[] = [
  {
    id: 'ops-sync-check',
    command: 'pnpm',
    args: ['ops:sync-check'],
    required: true,
    description: 'ops source/config drift check',
  },
  {
    id: 'system-alignment-check',
    command: 'pnpm',
    args: ['ops:system-alignment-check'],
    required: true,
    description: 'repo/runtime alignment check',
  },
  {
    id: 'automation-coverage-check',
    command: 'pnpm',
    args: ['ops:automation-coverage-check'],
    required: true,
    description: 'ops automation coverage check',
  },
  {
    id: 'env-check',
    command: 'pnpm',
    args: ['env:check'],
    required: true,
    description: 'environment variable contract check',
  },
  {
    id: 'lint',
    command: 'pnpm',
    args: ['lint'],
    required: true,
    description: 'ESLint',
  },
  {
    id: 'type-check',
    command: 'pnpm',
    args: ['type-check'],
    required: true,
    description: 'TypeScript project references check',
  },
  {
    id: 'build',
    command: 'pnpm',
    args: ['build'],
    required: true,
    description: 'monorepo build',
  },
  {
    id: 'test',
    command: 'pnpm',
    args: ['test'],
    required: true,
    description: 'full node:test suite',
  },
  {
    id: 'smart-form-verify',
    command: 'pnpm',
    args: ['--filter', '@unit-talk/smart-form', 'verify'],
    required: true,
    description: 'smart-form package verification',
  },
  {
    id: 'verify-commands',
    command: 'pnpm',
    args: ['verify:commands'],
    required: true,
    description: 'command manifest and migration guards',
  },
];

const GATE_IDS = new Set(MERGE_READY_GATES.map((gate) => gate.id));

export function parseMergeReadyArgs(argv: string[]): MergeReadyOptions {
  const { flags, bools } = parseArgs(argv.filter((arg) => arg !== '--'));
  const run = bools.has('run') || flags.has('run');
  const dryRun = bools.has('dry-run') || flags.has('dry-run') || !run;
  const gates = getFlags(flags, 'gate');
  const json = bools.has('json') || flags.has('json');

  const unknown = gates.filter((gate) => !GATE_IDS.has(gate));
  if (unknown.length > 0) {
    throw new Error(`Unknown merge-ready gate(s): ${unknown.join(', ')}. Valid gates: ${[...GATE_IDS].join(', ')}`);
  }

  return { dryRun, json, gates };
}

export function selectMergeReadyGates(ids: string[]): MergeReadyGate[] {
  if (ids.length === 0) {
    return [...MERGE_READY_GATES];
  }

  const requested = new Set(ids);
  return MERGE_READY_GATES.filter((gate) => requested.has(gate.id));
}

export function runMergeReady(
  options: Pick<MergeReadyOptions, 'dryRun' | 'gates'>,
  runner: CommandRunner = (command, args, runOptions) =>
    spawnSync(command, args, {
      cwd: runOptions.cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      shell: process.platform === 'win32',
    }),
): MergeReadyReport {
  const gates = selectMergeReadyGates(options.gates);
  const results: MergeReadyGateResult[] = [];

  for (const gate of gates) {
    const command = [gate.command, ...gate.args];
    if (options.dryRun) {
      results.push({
        id: gate.id,
        command,
        status: 'dry_run',
        exit_code: null,
        stdout: '',
        stderr: '',
      });
      continue;
    }

    const result = runner(gate.command, gate.args, { cwd: ROOT });
    const exitCode = result.status ?? 1;
    results.push({
      id: gate.id,
      command,
      status: exitCode === 0 ? 'pass' : 'fail',
      exit_code: exitCode,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    });

    if (exitCode !== 0 && gate.required) {
      break;
    }
  }

  const fail = results.filter((result) => result.status === 'fail').length;
  const pass = results.filter((result) => result.status === 'pass').length;
  const dryRun = results.filter((result) => result.status === 'dry_run').length;

  return {
    ok: fail === 0,
    dry_run: options.dryRun,
    generated_at: new Date().toISOString(),
    gates: results,
    summary: {
      total: results.length,
      pass,
      fail,
      dry_run: dryRun,
    },
  };
}

function printHuman(report: MergeReadyReport): void {
  console.log(`ops:merge-ready ${report.dry_run ? '(dry-run)' : '(run)'}`);
  for (const gate of report.gates) {
    const label = gate.status === 'dry_run' ? 'DRY' : gate.status === 'pass' ? 'PASS' : 'FAIL';
    console.log(`  ${label.padEnd(4)} ${gate.id}: ${gate.command.join(' ')}`);
    if (gate.status === 'fail' && gate.stderr.trim()) {
      console.log(gate.stderr.trim());
    }
  }
  console.log(
    `\nSummary: total=${report.summary.total} pass=${report.summary.pass} fail=${report.summary.fail} dry_run=${report.summary.dry_run}`,
  );
}

function main(): void {
  const options = parseMergeReadyArgs(process.argv.slice(2));
  const report = runMergeReady(options);
  if (options.json) {
    emitJson(report);
  } else {
    printHuman(report);
  }
  process.exitCode = report.ok ? 0 : 1;
}

const isDirectRun = process.argv[1] != null
  && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(`[merge-ready] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
