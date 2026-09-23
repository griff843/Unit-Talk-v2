/**
 * WORK-2026092101 — archive manifest and the prune gate.
 *
 * The manifest is the only artifact a prune is allowed to consult, so the
 * assertions that matter are the ones proving it cannot be talked into saying
 * yes: a hand-edited boolean, a missing checksum, a count that disagrees with
 * itself. A gate that can be opened by editing the thing it reads is not a gate.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type ArchiveManifestV1,
  MANIFEST_SCHEMA_VERSION,
  buildManifest,
  computeDataSchemaVersion,
  computeManifestId,
  emptyVerification,
  isPruneEligible,
  parseManifest,
  serializeManifest,
  validateManifest,
} from './manifest.js';

const TARGET = {
  kind: 'canonical' as const,
  domain: 'markets' as const,
  sport: 'nfl',
  season: '2026',
  date: '2026-09-14',
};

function baseInput() {
  return {
    target: TARGET,
    bucket: 'unit-talk-archive',
    sourceRelation: 'public.provider_offer_history',
    sourceRowCount: 1_000,
    window: {
      column: 'snapshot_at',
      start: '2026-09-14T00:00:00.000Z',
      end: '2026-09-15T00:00:00.000Z',
    },
    exportedRowCount: 1_000,
    byteSize: 24_576,
    checksumSha256: 'a'.repeat(64),
    columns: [
      { name: 'id', type: 'UUID' },
      { name: 'snapshot_at', type: 'TIMESTAMP WITH TIME ZONE' },
    ],
    rowGroupSize: 122_880,
    exporterRepoSha: '28c0c79aff4d5a18e84328a3171ff5ffbb3d8c9b',
    exportedAt: '2026-09-15T03:00:00.000Z',
  };
}

/** A manifest whose every verification check genuinely passed. */
function verifiedManifest(): ArchiveManifestV1 {
  const manifest = buildManifest(baseInput());
  return {
    ...manifest,
    verification: {
      verified_at: '2026-09-15T03:01:00.000Z',
      object_exists: true,
      row_count_match: true,
      checksum_verified: true,
      parquet_readable: true,
      sample_readback_rows: 100,
      sample_readback_match: true,
      passed: true,
      failures: [],
    },
  };
}

test('a freshly built manifest is never born verified', () => {
  const manifest = buildManifest(baseInput());
  assert.equal(manifest.schema_version, MANIFEST_SCHEMA_VERSION);
  assert.deepEqual(manifest.verification, emptyVerification());
  assert.equal(manifest.verification.passed, false);
  assert.equal(isPruneEligible(manifest).eligible, false);
});

test('manifest construction is deterministic in its inputs', () => {
  const a = serializeManifest(buildManifest(baseInput()));
  const b = serializeManifest(buildManifest(baseInput()));
  assert.equal(a, b, 'two builds of the same window must be byte-identical');
  assert.equal(
    computeManifestId('canonical/markets/nfl/2026/2026-09-14/part-0000.parquet'),
    buildManifest(baseInput()).manifest_id,
  );
});

test('the data schema version changes when the column set changes', () => {
  const columnsA = [{ name: 'id', type: 'UUID' }];
  const columnsB = [{ name: 'id', type: 'VARCHAR' }];
  const columnsC = [{ name: 'id', type: 'UUID' }, { name: 'line', type: 'DECIMAL(18,3)' }];
  assert.notEqual(computeDataSchemaVersion(columnsA), computeDataSchemaVersion(columnsB));
  assert.notEqual(computeDataSchemaVersion(columnsA), computeDataSchemaVersion(columnsC));
  assert.equal(computeDataSchemaVersion(columnsA), computeDataSchemaVersion([...columnsA]));
});

test('a fully verified manifest is prune-eligible', () => {
  const decision = isPruneEligible(verifiedManifest());
  assert.deepEqual(decision.reasons, []);
  assert.equal(decision.eligible, true);
});

test('flipping passed by hand does not open the gate', () => {
  const tampered = verifiedManifest();
  tampered.verification.checksum_verified = false;
  tampered.verification.passed = true;
  const decision = isPruneEligible(tampered);
  assert.equal(decision.eligible, false);
  assert.ok(decision.reasons.includes('checksum_unverified'));
});

test('each individual verification check gates the prune on its own', () => {
  const cases: Array<[keyof ArchiveManifestV1['verification'], string]> = [
    ['object_exists', 'object_missing'],
    ['row_count_match', 'row_count_mismatch'],
    ['checksum_verified', 'checksum_unverified'],
    ['parquet_readable', 'parquet_unreadable'],
    ['sample_readback_match', 'sample_readback_mismatch'],
  ];
  for (const [field, reason] of cases) {
    const manifest = verifiedManifest();
    (manifest.verification as unknown as Record<string, unknown>)[field] = false;
    const decision = isPruneEligible(manifest);
    assert.equal(decision.eligible, false, `${field} false must block the prune`);
    assert.ok(decision.reasons.includes(reason), `expected reason ${reason}, got ${decision.reasons}`);
  }
});

test('counts that disagree block the prune even when every check claims to have passed', () => {
  const manifest = verifiedManifest();
  manifest.export.exported_row_count = 999;
  const decision = isPruneEligible(manifest);
  assert.equal(decision.eligible, false);
  assert.ok(decision.reasons.includes('counts_disagree'));
});

test('a non-empty partition with no sample read back is not prune-eligible', () => {
  const manifest = verifiedManifest();
  manifest.verification.sample_readback_rows = 0;
  const decision = isPruneEligible(manifest);
  assert.equal(decision.eligible, false);
  assert.ok(decision.reasons.includes('no_sample_readback_performed'));
});

test('a recorded failure blocks the prune even alongside passing flags', () => {
  const manifest = verifiedManifest();
  manifest.verification.failures = ['checksum_verified'];
  const decision = isPruneEligible(manifest);
  assert.equal(decision.eligible, false);
  assert.ok(decision.reasons.some((r) => r.startsWith('recorded_failure:')));
});

test('an unverified-but-never-checked manifest is not prune-eligible', () => {
  const manifest = verifiedManifest();
  manifest.verification.verified_at = null;
  assert.equal(isPruneEligible(manifest).eligible, false);
});

test('structural validation names what is wrong', () => {
  assert.deepEqual(
    validateManifest(null).map((v) => v.code),
    ['not_an_object'],
  );

  const manifest = verifiedManifest();
  manifest.object.checksum_sha256 = 'not-a-hash';
  assert.ok(validateManifest(manifest).some((v) => v.code === 'bad_checksum'));

  const empty = verifiedManifest();
  empty.object.byte_size = 0;
  assert.ok(validateManifest(empty).some((v) => v.code === 'bad_byte_size'));

  const backwards = verifiedManifest();
  backwards.source.window = { column: 'snapshot_at', start: 'z', end: 'a' };
  assert.ok(validateManifest(backwards).some((v) => v.code === 'empty_window'));

  const gzipped = verifiedManifest();
  (gzipped.export as unknown as Record<string, unknown>).compression = 'gzip';
  assert.ok(validateManifest(gzipped).some((v) => v.code === 'bad_compression'));
});

test('an invalid manifest is refused by the prune gate before any check is read', () => {
  const decision = isPruneEligible({ schema_version: 1 });
  assert.equal(decision.eligible, false);
  assert.ok(decision.reasons.every((r) => r.startsWith('invalid_manifest:')));
});

test('serialize and parse round-trip', () => {
  const manifest = verifiedManifest();
  assert.deepEqual(parseManifest(serializeManifest(manifest)), manifest);
  assert.throws(() => parseManifest('{"schema_version":1}'), /Invalid archive manifest/);
});
