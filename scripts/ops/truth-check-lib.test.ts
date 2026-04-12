import test from 'node:test';
import assert from 'node:assert/strict';

function resolveExitCode(
  manifestStatus: 'merged' | 'done',
  failingIds: string[],
): 0 | 1 | 4 {
  if (failingIds.includes('G5')) {
    return 4;
  }
  if (failingIds.length > 0) {
    return 1;
  }
  return 0;
}

test('truth-check verdict mapping preserves reopen semantics for G5', () => {
  assert.strictEqual(resolveExitCode('done', ['G5']), 4);
  assert.strictEqual(resolveExitCode('merged', ['G4']), 1);
  assert.strictEqual(resolveExitCode('merged', []), 0);
});

function scopeDiffCheck(
  filesChanged: string[],
  fileScopeLock: string[],
  expectedProofPaths: string[],
): { status: 'pass' | 'fail'; outOfScope: string[] } {
  if (filesChanged.length === 0 || fileScopeLock.length === 0) {
    return { status: 'pass', outOfScope: [] };
  }
  const allowedPaths = new Set([...fileScopeLock, ...expectedProofPaths]);
  const outOfScope = filesChanged.filter(
    (f) =>
      !allowedPaths.has(f) &&
      !f.includes('deleted-file') &&
      !f.startsWith('docs/06_status/proof/'),
  );
  return { status: outOfScope.length > 0 ? 'fail' : 'pass', outOfScope };
}

test('scope-diff check passes when files_changed within scope', () => {
  const result = scopeDiffCheck(
    ['scripts/ops/truth-check-lib.ts'],
    ['scripts/ops/truth-check-lib.ts', 'scripts/ops/shared.ts'],
    [],
  );
  assert.strictEqual(result.status, 'pass');
  assert.strictEqual(result.outOfScope.length, 0);
});

test('scope-diff check fails when files_changed outside scope', () => {
  const result = scopeDiffCheck(
    ['scripts/ops/truth-check-lib.ts', 'apps/api/src/index.ts'],
    ['scripts/ops/truth-check-lib.ts'],
    [],
  );
  assert.strictEqual(result.status, 'fail');
  assert.deepStrictEqual(result.outOfScope, ['apps/api/src/index.ts']);
});

test('scope-diff check allows proof paths outside scope', () => {
  const result = scopeDiffCheck(
    ['scripts/ops/shared.ts', 'docs/06_status/proof/UTV2-100/diff-summary.md'],
    ['scripts/ops/shared.ts'],
    ['docs/06_status/proof/UTV2-100/diff-summary.md'],
  );
  assert.strictEqual(result.status, 'pass');
});

test('scope-diff check allows deleted-file markers', () => {
  const result = scopeDiffCheck(
    ['scripts/ops/shared.ts', 'docs/06_status/lanes/deleted-file.json'],
    ['scripts/ops/shared.ts'],
    [],
  );
  assert.strictEqual(result.status, 'pass');
});

test('scope-diff check passes when files_changed is empty', () => {
  const result = scopeDiffCheck([], ['scripts/ops/shared.ts'], []);
  assert.strictEqual(result.status, 'pass');
});
