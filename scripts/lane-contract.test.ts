import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  isLaneExecutorType,
  isLaneType,
  loadLaneManifest,
  validateLaneAuthority,
  type LaneManifestContract,
} from './lane-contract.js';

const baseManifest: LaneManifestContract = {
  schema_version: 1,
  lane_id: 'hygiene',
  lane_type: 'hygiene',
  allowed_path_globs: ['.lane/**', 'scripts/**', 'package.json'],
  forbidden_path_globs: ['supabase/migrations/**', 'packages/**/database.types.ts'],
  required_proof_artifacts: ['diff-summary.md', 'verification.md'],
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
    required_proof_artifacts: ['diff-summary.md', 'verification.md', 'db-smoke.log'],
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
    required_proof_artifacts: ['diff-summary.md', 'verification.md', 'db-smoke.log'],
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

// ── UTV2-1541: real governance.yml allowlist gaps ──────────────────────────────
// Regression coverage against the ACTUAL .lane/lanes/governance.yml on disk, not
// a synthetic manifest -- these two paths caused real Lane Authority failures on
// PR #1218 (UTV2-1536, AGENTS.md) and PR #1219 (UTV2-1537,
// docs/06_status/INCIDENTS/**, rejected because matchesAny()'s micromatch call has
// no `nocase` option and the allowlist only had the lowercase `incidents/**` form).

test('governance lane accepts AGENTS.md', () => {
  const manifest = loadLaneManifest('governance');
  const result = validateLaneAuthority({
    manifest,
    changedFiles: ['AGENTS.md'],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test('governance lane accepts docs/06_status/INCIDENTS/** (case-correct)', () => {
  const manifest = loadLaneManifest('governance');
  const result = validateLaneAuthority({
    manifest,
    changedFiles: ['docs/06_status/INCIDENTS/INC-2026-07-14-example.md'],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test('governance lane still accepts the legacy lowercase docs/06_status/incidents/** form', () => {
  const manifest = loadLaneManifest('governance');
  const result = validateLaneAuthority({
    manifest,
    changedFiles: ['docs/06_status/incidents/some-legacy-note.md'],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test('governance lane still rejects an unrelated path after the AGENTS.md/INCIDENTS additions', () => {
  const manifest = loadLaneManifest('governance');
  const result = validateLaneAuthority({
    manifest,
    changedFiles: ['apps/worker/src/something.ts'],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.violations.map((violation) => violation.code),
    ['outside_allowed_paths'],
  );
});

test('governance lane still rejects a mixed-case near-miss on the incidents path (matching stays case-sensitive)', () => {
  const manifest = loadLaneManifest('governance');
  const result = validateLaneAuthority({
    manifest,
    changedFiles: ['docs/06_status/Incidents/wrong-case.md'],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.violations.map((violation) => violation.code),
    ['outside_allowed_paths'],
  );
});

test('UTV2-1715: delivery-ui admits apps/web without widening into other lanes', () => {
  // apps/web is the public member-facing site and lives on `main`, but it
  // appeared in no lane type's allowlist, so every lane touching it failed
  // Lane Authority with `outside_allowed_paths` and no lane type could
  // legally carry the change.
  const deliveryUi = loadLaneManifest('delivery-ui');

  const admitted = validateLaneAuthority({
    manifest: deliveryUi,
    changedFiles: ['apps/web/src/app/page.tsx', 'apps/web/src/styles/globals.css'],
  });
  assert.equal(admitted.ok, true);
  assert.deepEqual(admitted.violations, []);

  // The correction adds one delivery surface. It must not become a general
  // write channel into runtime, package, migration, or workflow authority.
  for (const isolated of [
    'apps/api/src/board-pick-writer.ts',
    'packages/domain/src/index.ts',
    'supabase/migrations/20260101000000_example.sql',
    '.github/workflows/ci.yml',
  ]) {
    const refused = validateLaneAuthority({
      manifest: deliveryUi,
      changedFiles: [isolated],
    });
    assert.equal(refused.ok, false, `delivery-ui must not admit ${isolated}`);
  }

  // No other lane type gains apps/web as a side effect.
  for (const laneType of ['runtime', 'modeling', 'hygiene', 'verification', 'governance'] as const) {
    const other = validateLaneAuthority({
      manifest: loadLaneManifest(laneType),
      changedFiles: ['apps/web/src/app/page.tsx'],
    });
    assert.equal(other.ok, false, `${laneType} must not admit apps/web`);
  }
});
