import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MERGE_READY_GATES,
  parseMergeReadyArgs,
  runMergeReady,
  selectMergeReadyGates,
} from './merge-ready.js';

test('MERGE_READY_GATES preserves pnpm verify gate order', () => {
  assert.deepStrictEqual(
    MERGE_READY_GATES.map((gate) => gate.id),
    [
      'ops-sync-check',
      'system-alignment-check',
      'automation-coverage-check',
      'env-check',
      'lint',
      'type-check',
      'build',
      'test',
      'smart-form-verify',
      'verify-commands',
    ],
  );
});

test('parseMergeReadyArgs defaults to dry-run for safe local summaries', () => {
  const options = parseMergeReadyArgs(['--', '--json', '--gate', 'lint']);

  assert.equal(options.dryRun, true);
  assert.equal(options.json, true);
  assert.deepStrictEqual(options.gates, ['lint']);
});

test('parseMergeReadyArgs requires --run before executing gates', () => {
  const options = parseMergeReadyArgs(['--run', '--gate=lint']);

  assert.equal(options.dryRun, false);
  assert.deepStrictEqual(options.gates, ['lint']);
});

test('selectMergeReadyGates keeps requested gates in canonical order', () => {
  const gates = selectMergeReadyGates(['test', 'lint', 'build']);

  assert.deepStrictEqual(gates.map((gate) => gate.id), ['lint', 'build', 'test']);
});

test('runMergeReady dry-run summarizes commands without invoking runner', () => {
  let invoked = false;
  const report = runMergeReady(
    { dryRun: true, gates: ['lint'] },
    () => {
      invoked = true;
      return { status: 0, stdout: '', stderr: '' };
    },
  );

  assert.equal(invoked, false);
  assert.equal(report.ok, true);
  assert.equal(report.summary.dry_run, 1);
  assert.deepStrictEqual(report.gates[0]?.command, ['pnpm', 'lint']);
});

test('runMergeReady stops after first required gate failure', () => {
  const calls: string[] = [];
  const report = runMergeReady(
    { dryRun: false, gates: ['lint', 'build'] },
    (_command, args) => {
      calls.push(args[0] ?? '');
      return calls.length === 1
        ? { status: 1, stdout: '', stderr: 'lint failed' }
        : { status: 0, stdout: '', stderr: '' };
    },
  );

  assert.equal(report.ok, false);
  assert.deepStrictEqual(calls, ['lint']);
  assert.equal(report.summary.fail, 1);
  assert.equal(report.gates[0]?.stderr, 'lint failed');
});
