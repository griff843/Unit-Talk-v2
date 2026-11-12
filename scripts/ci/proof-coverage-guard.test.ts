import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createTempWorkspace, releaseTempWorkspace } from '../ops/temp-workspace.js';

const WORKFLOW_PATH = '.github/workflows/proof-coverage-guard.yml';

const NCAAF_MIGRATION = 'supabase/migrations/20261010170000_ncaaf_participant_catalog.sql';
const CANONICAL_TEST = 'packages/db/src/canonical-reference-schema.test.ts';
const OTHER_MIGRATION = 'supabase/migrations/20261010180000_unrelated_change.sql';

/** Returns the `run: |` body of the named workflow step, dedented. */
function stepRunBody(stepName: string): string {
  const lines = readFileSync(WORKFLOW_PATH, 'utf8').replace(/^\uFEFF/, '').split('\n');
  const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  assert.notEqual(start, -1, `workflow step not found: ${stepName}`);
  const runIdx = lines.findIndex((line, i) => i > start && line.trim() === 'run: |');
  assert.notEqual(runIdx, -1, `no run block for step: ${stepName}`);
  const runIndent = lines[runIdx]!.indexOf('run:');
  const body: string[] = [];
  for (let i = runIdx + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.trim() !== '' && line.search(/\S/) <= runIndent) break;
    body.push(line.slice(runIndent + 2));
  }
  return body.join('\n');
}

interface StepResult {
  status: number | null;
  stdout: string;
  outputs: string;
}

function runStep(stepName: string, changed: string[], sensitiveOutput = ''): StepResult {
  const dir = createTempWorkspace('proof-guard-');
  try {
    const changedPath = path.join(dir, 'changed.txt');
    const outputPath = path.join(dir, 'github-output');
    writeFileSync(changedPath, changed.join('\n') + '\n');
    writeFileSync(outputPath, '');
    const script = stepRunBody(stepName)
      .replaceAll('/tmp/changed.txt', changedPath)
      .replaceAll('${{ steps.sensitive.outputs.sensitive }}', sensitiveOutput);
    const result = spawnSync('bash', ['-e', '-c', script], {
      env: { ...process.env, GITHUB_OUTPUT: outputPath },
      encoding: 'utf8',
    });
    return {
      status: result.status,
      stdout: result.stdout + result.stderr,
      outputs: readFileSync(outputPath, 'utf8'),
    };
  } finally {
    releaseTempWorkspace(dir);
  }
}

/** Runs sensitive-detection, then the proof check when detection requires it. */
function guard(changed: string[]): { pass: boolean; required: boolean } {
  const sensitive = runStep('Check for sensitive runtime changes', changed);
  assert.equal(sensitive.status, 0, sensitive.stdout);
  const required = /^required=true$/m.test(sensitive.outputs);
  if (!required) {
    return { pass: true, required };
  }
  const listed = /sensitive<<SENSITIVE_EOF\n([\s\S]*?)SENSITIVE_EOF/.exec(sensitive.outputs)?.[1] ?? '';
  const proof = runStep('Check for corresponding live-DB proof changes', changed, listed);
  return { pass: proof.status === 0, required };
}

test('recognized NCAAF migration paired with the canonical-reference test passes', () => {
  const result = guard([NCAAF_MIGRATION, CANONICAL_TEST]);
  assert.equal(result.pass, true);
  assert.equal(result.required, false);
});

test('recognized NCAAF migration without the canonical-reference test still fails', () => {
  const result = guard([NCAAF_MIGRATION]);
  assert.equal(result.required, true);
  assert.equal(result.pass, false);
});

test('an unrelated migration with the canonical-reference test still fails', () => {
  const result = guard([OTHER_MIGRATION, CANONICAL_TEST]);
  assert.equal(result.required, true);
  assert.equal(result.pass, false);
});

test('the exemption is exact: a second migration alongside the NCAAF pairing still fails', () => {
  const result = guard([NCAAF_MIGRATION, OTHER_MIGRATION, CANONICAL_TEST]);
  assert.equal(result.required, true);
  assert.equal(result.pass, false);
});

test('a sensitive runtime file with the canonical-reference test still fails', () => {
  const result = guard(['packages/db/src/runtime-repositories.ts', CANONICAL_TEST]);
  assert.equal(result.required, true);
  assert.equal(result.pass, false);
});

test('existing accepted proof paths still pass', () => {
  for (const proof of [
    'apps/api/src/t1-proof-awaiting-approval.test.ts',
    'apps/api/src/some-test-db-helper.ts',
    'apps/worker/src/scripts/proof.ts',
    'packages/db/src/scripts/proof.ts',
  ]) {
    const result = guard([OTHER_MIGRATION, proof]);
    assert.equal(result.required, true, proof);
    assert.equal(result.pass, true, proof);
  }
});

test('the global proof pattern list admits no generic packages/db test glob', () => {
  const body = stepRunBody('Check for corresponding live-DB proof changes');
  const patterns = [...body.matchAll(/^\s+'([^']+)'$/gm)].map((m) => m[1]!);
  assert.deepEqual(patterns, [
    'apps/[^/]+/src/t1-proof-.*\\.test\\.ts$',
    'apps/api/src/.*test-db.*\\.ts$',
    'apps/[^/]+/src/scripts/.*\\.ts$',
    'packages/[^/]+/src/scripts/.*\\.ts$',
  ]);
  for (const generic of ['packages/db/src/other.test.ts', CANONICAL_TEST]) {
    const result = guard([OTHER_MIGRATION, generic]);
    assert.equal(result.pass, false, generic);
  }
});

test('a PR with no sensitive paths passes trivially', () => {
  const result = guard(['docs/readme.md']);
  assert.equal(result.pass, true);
  assert.equal(result.required, false);
});
