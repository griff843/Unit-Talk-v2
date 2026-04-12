import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  CI_DOCTOR_RESULT_SCHEMA_PATH,
  ROOT,
  REQUIRED_CI_CHECKS_SCHEMA_PATH,
  REQUIRED_SECRETS_SCHEMA_PATH,
  validateCiDoctorSchemaDependencies,
} from './shared.js';

test('ci-doctor schema dependencies exist', () => {
  assert.doesNotThrow(() => validateCiDoctorSchemaDependencies());
  assert.ok(fs.existsSync(CI_DOCTOR_RESULT_SCHEMA_PATH));
  assert.ok(fs.existsSync(REQUIRED_SECRETS_SCHEMA_PATH));
  assert.ok(fs.existsSync(REQUIRED_CI_CHECKS_SCHEMA_PATH));
});

test('preview-branch validation doc exists and is marked selective-use', () => {
  const docPath = path.join(ROOT, 'docs', 'ops', 'SUPABASE_PREVIEW_BRANCH_VALIDATION.md');
  assert.ok(fs.existsSync(docPath));
  const text = fs.readFileSync(docPath, 'utf8');
  assert.match(text, /selective-use|selective use/i);
});

test('ci-doctor emits structured JSON and keeps FAIL ahead of INFRA', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/ops/ci-doctor.ts', '--json'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );

  assert.strictEqual(result.error, undefined);
  assert.notStrictEqual(result.stdout.trim(), '');
  const payload = JSON.parse(result.stdout) as {
    verdict: string;
    exit_code: number;
    failures: string[];
    infra_errors: string[];
  };

  assert.ok(['PASS', 'FAIL', 'INFRA'].includes(payload.verdict));
  assert.ok([0, 1, 3].includes(payload.exit_code));
  if (payload.failures.length > 0) {
    assert.strictEqual(payload.verdict, 'FAIL');
    assert.strictEqual(result.status, 1);
  } else if (payload.infra_errors.length > 0) {
    assert.strictEqual(payload.verdict, 'INFRA');
    assert.strictEqual(result.status, 3);
  } else {
    assert.strictEqual(payload.verdict, 'PASS');
    assert.strictEqual(result.status, 0);
  }
  assert.strictEqual(path.isAbsolute(ROOT), true);
});
