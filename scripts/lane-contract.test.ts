import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  isLaneExecutorType,
  isLaneType,
  validateLaneAuthority,
  type LaneManifestContract,
} from './lane-contract.js';

const baseManifest: LaneManifestContract = {
  schema_version: 1,
  lane_id: 'hygiene',
  lane_type: 'hygiene',
  allowed_path_globs: ['.lane/**', 'scripts/**', 'package.json'],
  forbidden_path_globs: ['supabase/migrations/**', 'packages/**/database.types.ts'],
  required_proof_artifacts: ['diff-summary.md', 'verification.log'],
  ci_requirements: ['pnpm verify'],
  merge_policy: 'green verify',
  concurrency_notes: 'no overlap',
};

test('lane taxonomy separates domain lane types from executor lane types', () => {
  assert.equal(isLaneType('runtime'), true);
  assert.equal(isLaneExecutorType('runtime'), false);
  assert.equal(isLaneType('codex-cli'), false);
  assert.equal(isLaneExecutorType('codex-cli'), true);
});

test('lane authority fails on files outside allowed paths', () => {
  const result = validateLaneAuthority({
    manifest: baseManifest,
    changedFiles: ['apps/api/src/server.ts'],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.violations.map((violation) => violation.code),
    ['outside_allowed_paths'],
  );
});

test('lane authority fails closed on migration-sensitive files outside migration lane', () => {
  const result = validateLaneAuthority({
    manifest: baseManifest,
    changedFiles: ['supabase/migrations/202605150001_test.sql'],
  });

  assert.equal(result.ok, false);
  assert.ok(result.violations.some((violation) => violation.code === 'forbidden_path'));
  assert.ok(result.violations.some((violation) => violation.code === 'migration_lane_required'));
});

test('migration lane requires active migration lock for schema changes', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-contract-'));
  const migrationManifest: LaneManifestContract = {
    ...baseManifest,
    lane_id: 'migration',
    lane_type: 'migration',
    allowed_path_globs: ['supabase/migrations/**', 'packages/**/database.types.ts'],
    forbidden_path_globs: [],
    required_proof_artifacts: ['diff-summary.md', 'verification.log', 'db-smoke.log'],
    requires_migration_lock: true,
  };

  const result = validateLaneAuthority({
    manifest: migrationManifest,
    changedFiles: ['packages/db/src/database.types.ts'],
    repoRoot,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.violations.map((violation) => violation.code),
    ['migration_lock_required'],
  );
});

test('migration lane passes when active lock exists', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-contract-'));
  const lockPath = path.join(repoRoot, '.lane', 'migration-lock.yml');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, 'schema_version: 1\nissue_id: UTV2-960\n', 'utf8');
  const migrationManifest: LaneManifestContract = {
    ...baseManifest,
    lane_id: 'migration',
    lane_type: 'migration',
    allowed_path_globs: ['supabase/migrations/**', 'packages/**/database.types.ts'],
    forbidden_path_globs: [],
    required_proof_artifacts: ['diff-summary.md', 'verification.log', 'db-smoke.log'],
    requires_migration_lock: true,
  };

  const result = validateLaneAuthority({
    manifest: migrationManifest,
    changedFiles: ['supabase/migrations/202605150001_test.sql'],
    repoRoot,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});
