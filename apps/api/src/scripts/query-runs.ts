#!/usr/bin/env tsx

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { QueryRunner, RunStore } from '@unit-talk/verification';
import type { UnifiedRunRecord } from '@unit-talk/verification';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '../../../..');
const outDir = resolve(repoRoot, 'out');

function opt(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find(value => value.startsWith(prefix) || value === `--${name}`);
  if (!arg) {
    return undefined;
  }

  if (arg.includes('=')) {
    return arg.split('=').slice(1).join('=');
  }

  return 'true';
}

function padEnd(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width, ' ');
}

function formatVerdict(verdict: string): string {
  if (verdict === 'PASS') {
    return 'PASS';
  }
  if (verdict === 'FAIL') {
    return 'FAIL';
  }
  return 'ERROR';
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1_000).toFixed(1)}s`;
}

function printRunTable(runs: UnifiedRunRecord[]): void {
  if (runs.length === 0) {
    console.log('(no runs found)');
    return;
  }

  const header = [
    padEnd('Run ID', 38),
    padEnd('Scenario', 24),
    padEnd('Mode', 8),
    padEnd('Verdict', 8),
    padEnd('Duration', 10),
    'Completed At'
  ].join(' ');

  console.log(header);
  console.log('-'.repeat(header.length));

  for (const run of runs) {
    console.log(
      [
        padEnd(run.runId, 38),
        padEnd(run.scenarioId, 24),
        padEnd(run.mode, 8),
        padEnd(formatVerdict(run.verdict), 8),
        padEnd(formatDuration(run.durationMs), 10),
        run.completedAt
      ].join(' ')
    );
  }
}

function printSummary(runner: QueryRunner): void {
  const summary = runner.summary();
  if (summary.byScenario.length === 0) {
    console.log('(no run history)');
    return;
  }

  console.log(`Run Summary - ${summary.totalRuns} total runs`);
  console.log(`Generated: ${summary.generatedAt}`);
  console.log('');

  const header = [
    padEnd('Scenario', 24),
    padEnd('Total', 7),
    padEnd('Passed', 8),
    padEnd('Failed', 8),
    padEnd('Errors', 8),
    'Pass Rate'
  ].join(' ');

  console.log(header);
  console.log('-'.repeat(header.length));

  for (const row of summary.byScenario) {
    console.log(
      [
        padEnd(row.scenarioId, 24),
        padEnd(String(row.total), 7),
        padEnd(String(row.passed), 8),
        padEnd(String(row.failed), 8),
        padEnd(String(row.errorCount), 8),
        `${(row.passRate * 100).toFixed(0)}%`
      ].join(' ')
    );
  }
}

const store = new RunStore(outDir);
const runner = new QueryRunner(store);
const limit = Number.parseInt(opt('limit') ?? '10', 10);
const scenarioId = opt('scenario');

if (opt('summary') !== undefined || process.argv.includes('--summary')) {
  printSummary(runner);
} else if (opt('failures') !== undefined || process.argv.includes('--failures')) {
  console.log('Failed runs:');
  printRunTable(runner.failures(limit));
} else if (scenarioId) {
  console.log(`Runs for scenario: ${scenarioId}`);
  printRunTable(runner.byScenario(scenarioId, limit));
} else {
  console.log(`Recent runs (last ${limit}):`);
  printRunTable(runner.recent(limit));
}
