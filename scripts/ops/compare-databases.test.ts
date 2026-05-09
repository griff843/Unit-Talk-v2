import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompareReport, diffCollection } from './compare-databases.js';

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
