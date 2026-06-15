import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompareReport, diffCollection, filterSnapshot } from './compare-databases.js';

test('diffCollection reports missing and changed schema objects', () => {
  const diff = diffCollection(
    [
      { schema: 'public', table: 'picks', name: 'idx_a', definition: 'create index idx_a' },
      { schema: 'public', table: 'picks', name: 'idx_b', definition: 'create index idx_b' },
    ],
    [
      { schema: 'public', table: 'picks', name: 'idx_a', definition: 'create unique index idx_a' },
      { schema: 'public', table: 'picks', name: 'idx_c', definition: 'create index idx_c' },
    ],
    (item) => `${item.schema}.${item.table}.${item.name}`,
  );

  assert.deepStrictEqual(
    diff.missing_in_actual.map((item) => item.key),
    ['public.picks.idx_b'],
  );
  assert.deepStrictEqual(
    diff.missing_in_expected.map((item) => item.key),
    ['public.picks.idx_c'],
  );
  assert.deepStrictEqual(
    diff.changed.map((item) => item.key),
    ['public.picks.idx_a'],
  );
});

test('buildCompareReport summarizes drift across schema collections', () => {
  const report = buildCompareReport({
    expectedLabel: 'repo-migrations',
    actualLabel: 'supabase-live',
    schema: 'public',
    generatedAt: '2026-05-08T00:00:00.000Z',
    expected: {
      relations: [{ schema: 'public', name: 'picks', kind: 'table' }],
      columns: [
        {
          schema: 'public',
          table: 'picks',
          column: 'id',
          ordinalPosition: 1,
          dataType: 'uuid',
          formattedType: 'uuid',
          defaultExpression: null,
          isNullable: false,
          identityGeneration: null,
        },
      ],
      constraints: [],
      indexes: [],
      policies: [],
      triggers: [],
      extensions: [{ schema: 'public', name: 'pgcrypto', version: '1.3' }],
    },
    actual: {
      relations: [{ schema: 'public', name: 'picks', kind: 'table' }],
      columns: [
        {
          schema: 'public',
          table: 'picks',
          column: 'id',
          ordinalPosition: 1,
          dataType: 'uuid',
          formattedType: 'uuid',
          defaultExpression: 'gen_random_uuid()',
          isNullable: false,
          identityGeneration: null,
        },
      ],
      constraints: [],
      indexes: [],
      policies: [],
      triggers: [],
      extensions: [
        { schema: 'public', name: 'pgcrypto', version: '1.3' },
        { schema: 'extensions', name: 'pg_cron', version: '1.6' },
      ],
    },
  });

  assert.strictEqual(report.generated_at, '2026-05-08T00:00:00.000Z');
  assert.strictEqual(report.drift_detected, true);
  assert.strictEqual(report.drift_count, 2);
  assert.strictEqual(report.summary.columns.drift, 1);
  assert.strictEqual(report.summary.extensions.drift, 1);
  assert.deepStrictEqual(
    report.diff.extensions.missing_in_expected.map((item) => item.key),
    ['extensions.pg_cron'],
  );
  assert.deepStrictEqual(
    report.diff.columns.changed.map((item) => item.key),
    ['public.picks.id'],
  );
});

test('filterSnapshot drops dynamic partition children and their scoped objects', () => {
  const snapshot = {
    relations: [
      { schema: 'public', name: 'provider_offer_history', kind: 'partitioned_table' as const },
      { schema: 'public', name: 'provider_offer_history_compact', kind: 'table' as const },
      { schema: 'public', name: 'provider_offer_history_p20260614', kind: 'table' as const },
    ],
    columns: [
      {
        schema: 'public',
        table: 'provider_offer_history_p20260614',
        column: 'id',
        ordinalPosition: 1,
        dataType: 'uuid',
        formattedType: 'uuid',
        defaultExpression: null,
        isNullable: false,
        identityGeneration: null,
      },
      {
        schema: 'public',
        table: 'provider_offer_history_compact',
        column: 'id',
        ordinalPosition: 1,
        dataType: 'uuid',
        formattedType: 'uuid',
        defaultExpression: null,
        isNullable: false,
        identityGeneration: null,
      },
    ],
    constraints: [
      {
        schema: 'public',
        table: 'provider_offer_history_p20260614',
        name: 'x_pkey',
        type: 'p',
        definition: 'PRIMARY KEY (id)',
      },
    ],
    indexes: [
      {
        schema: 'public',
        table: 'provider_offer_history_p20260614',
        name: 'x_idx',
        definition: 'CREATE INDEX x_idx ON ...',
      },
    ],
    policies: [],
    triggers: [],
    extensions: [{ schema: 'extensions', name: 'pg_cron', version: '1.6' }],
  };

  const pattern = /^provider_offer_history_p\d+$/;
  const filtered = filterSnapshot(snapshot, pattern);

  // Parent partitioned table and the (non-partition) compact table survive.
  assert.deepStrictEqual(
    filtered.relations.map((r) => r.name).sort(),
    ['provider_offer_history', 'provider_offer_history_compact'],
  );
  // The dynamic child's columns/constraints/indexes are gone; compact's column remains.
  assert.deepStrictEqual(
    filtered.columns.map((c) => c.table),
    ['provider_offer_history_compact'],
  );
  assert.strictEqual(filtered.constraints.length, 0);
  assert.strictEqual(filtered.indexes.length, 0);
  // Extensions are schema-scoped and never filtered.
  assert.deepStrictEqual(filtered.extensions, snapshot.extensions);
});

test('filterSnapshot is a no-op when no pattern is supplied', () => {
  const snapshot = {
    relations: [{ schema: 'public', name: 'picks', kind: 'table' as const }],
    columns: [],
    constraints: [],
    indexes: [],
    policies: [],
    triggers: [],
    extensions: [],
  };
  assert.strictEqual(filterSnapshot(snapshot, null), snapshot);
});
