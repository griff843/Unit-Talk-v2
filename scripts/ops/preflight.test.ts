import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  PREFLIGHT_RESULT_SCHEMA_PATH,
  PREFLIGHT_TOKEN_SCHEMA_PATH,
  preflightResultPathForBranch,
  preflightTokenPathForBranch,
  validatePreflightSchemaDependencies,
} from './shared.js';

test('preflight schema dependencies exist', () => {
  assert.doesNotThrow(() => validatePreflightSchemaDependencies());
  assert.ok(fs.existsSync(PREFLIGHT_RESULT_SCHEMA_PATH));
  assert.ok(fs.existsSync(PREFLIGHT_TOKEN_SCHEMA_PATH));
});

test('preflight token and result paths share the canonical branch path', () => {
  const branch = 'codex/utv2-999-preflight';
  assert.strictEqual(
    preflightTokenPathForBranch(branch).endsWith(path.join('.out', 'ops', 'preflight', 'codex', 'utv2-999-preflight.json')),
    true,
  );
  assert.strictEqual(
    preflightResultPathForBranch(branch).endsWith(path.join('.out', 'ops', 'preflight', 'codex', 'utv2-999-preflight.result.json')),
    true,
  );
});

test('preflight fast path allows T2 safe-class baseline reuse', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  assert.match(source, /fastBaselineAllowed/, 'preflight should centralize fast baseline eligibility');
  assert.match(source, /tier === 'T2'/, 'fast baseline eligibility must explicitly include T2');
  assert.match(source, /governance/, 'T2 governance lanes should be fast-baseline eligible');
  assert.match(source, /tooling/, 'T2 tooling lanes should be fast-baseline eligible');
});

test('preflight treats lane registry dirt as control-plane safe', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  assert.match(source, /isLaneRegistryPath/, 'preflight should classify lane registry paths');
  assert.match(source, /\.ops\\\/sync\\\/UTV2-\\d\+\\\.yml/, 'sync files should be allowed lane registry dirt');
  assert.match(source, /docs\\\/06_status\\\/lanes\\\/UTV2-\\d\+\\\.json/, 'lane manifests should be allowed lane registry dirt');
});

test('preflight reads GitHub token from repo env files', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  assert.match(source, /readConfiguredEnvValue\('GITHUB_TOKEN'\)/, 'PE3 should honor repo env files, not just process.env');
});
