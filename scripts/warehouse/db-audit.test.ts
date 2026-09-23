/**
 * WORK-2026092101 — the read-only production sizing audit.
 *
 * This audit is meant to be pointed at production while production is the thing
 * being recovered, so the assertions that matter are about what it *cannot* do:
 * it pins the session read-only before its first read, it issues no statement
 * that writes, and it never assembles SQL from unvalidated input.
 *
 * The second half asserts that the candidate assessment refuses to conclude.
 * Catalog state cannot establish that nothing reads a relation, and an
 * assessment that concluded "safe to prune" from `pg_class` alone would be the
 * most dangerous artifact in this lane.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTOVACUUM_STATE_SQL,
  DATABASE_SIZE_SQL,
  FOREIGN_KEYS_REFERENCING_SQL,
  PARTITION_SIZES_SQL,
  READ_ONLY_PREAMBLE,
  RELATION_SIZES_SQL,
  type SqlRunner,
  assessArchiveCandidate,
  runDbAudit,
  timeWindowSql,
} from './db-audit.js';

/**
 * Matched with a lookbehind so a *column* named `last_analyze` is not read as the
 * verb `ANALYZE`. A substring check flags the audit's own `s.last_autoanalyze`
 * and would have to be loosened to pass — which is how a control ends up
 * matching nothing.
 */
const WRITE_KEYWORDS = [
  'insert', 'update', 'delete', 'drop', 'truncate', 'alter', 'create',
  'grant', 'revoke', 'vacuum', 'analyze', 'refresh', 'copy',
];

function usesWriteKeyword(sql: string, keyword: string): boolean {
  return new RegExp(String.raw`(?<![\w.])${keyword}\s`, 'i').test(sql);
}

/** Records every statement, answers from a fixture. */
function recorder(fixtures: Record<string, Array<Record<string, unknown>>> = {}) {
  const statements: string[] = [];
  const query: SqlRunner = async (sql) => {
    statements.push(sql);
    if (sql === READ_ONLY_PREAMBLE) return [];
    if (sql === DATABASE_SIZE_SQL) return fixtures.database ?? [{ database: 'postgres', total_bytes: 1 }];
    if (sql === RELATION_SIZES_SQL) return fixtures.relations ?? [];
    if (sql === PARTITION_SIZES_SQL) return fixtures.partitions ?? [];
    if (sql === AUTOVACUUM_STATE_SQL) return fixtures.autovacuum ?? [];
    if (sql === FOREIGN_KEYS_REFERENCING_SQL) return fixtures.foreign_keys ?? [];
    return fixtures.window ?? [];
  };
  return { statements, query };
}

test('the session is pinned read-only before anything is read', async () => {
  const { statements, query } = recorder();
  await runDbAudit({ query });
  assert.equal(statements[0], READ_ONLY_PREAMBLE, 'the first statement must close the write path');
});

test('no statement the audit issues can write', async () => {
  const { statements, query } = recorder();
  await runDbAudit({
    query,
    rules: [
      { schema: 'public', relation: 'provider_offer_history', timeColumn: 'snapshot_at', hotRetentionDays: 45 },
    ],
  });

  assert.ok(statements.length > 1);
  for (const sql of statements.slice(1)) {
    const normalized = `${sql.replace(/\s+/g, ' ').trim()} `;
    assert.ok(normalized.toLowerCase().startsWith('select'), `not a SELECT: ${sql.slice(0, 60)}`);
    for (const keyword of WRITE_KEYWORDS) {
      assert.equal(
        usesWriteKeyword(normalized, keyword),
        false,
        `${keyword} is used as a verb in: ${sql.slice(0, 80)}`,
      );
    }
  }
});

test('the report says plainly that it mutated nothing', async () => {
  const { query } = recorder();
  const report = await runDbAudit({ query, now: () => new Date('2026-09-21T00:00:00.000Z') });
  assert.equal(report.read_only, true);
  assert.equal(report.mutated, false);
  assert.equal(report.generated_at, '2026-09-21T00:00:00.000Z');
});

test('an identifier that is not an identifier is refused, not escaped', () => {
  assert.equal(
    timeWindowSql('public', 'provider_offer_history', 'snapshot_at'),
    `SELECT min("snapshot_at") AS oldest, max("snapshot_at") AS newest, count(*) AS exact_rows
          FROM "public"."provider_offer_history"`,
  );
  for (const bad of ['a"b', 'a;b', 'Public', 'a b', '1a', '', 'a--b', 'a)b']) {
    assert.throws(() => timeWindowSql('public', bad, 'snapshot_at'), /unsafe relation identifier/);
    assert.throws(() => timeWindowSql(bad, 'rel', 'snapshot_at'), /unsafe schema identifier/);
    assert.throws(() => timeWindowSql('public', 'rel', bad), /unsafe column identifier/);
  }
});

test('a restored database reports its reset statistics rather than zero bloat', async () => {
  // Every relation reading 0 live / 0 dead is what a restore looks like, and it
  // is indistinguishable from a perfectly vacuumed database if you only read
  // the numbers. Saying so is the difference between a measurement and a guess.
  const { query } = recorder({
    autovacuum: [
      { schema: 'public', relation: 'picks', live_tuples: 0, dead_tuples: 0 },
      { schema: 'public', relation: 'system_runs', live_tuples: 0, dead_tuples: 0 },
    ],
  });
  const report = await runDbAudit({ query });
  assert.ok(
    report.notes.some((note) => note.includes('Statistics were reset')),
    'a reset statistics view must be named, not read as health',
  );
});

test('with no declared hot window the audit makes no retention claim', async () => {
  const { query } = recorder();
  const report = await runDbAudit({ query });
  assert.deepEqual(report.retention, []);
});

test('a hot-retention violation is measured from the oldest row', async () => {
  const { query } = recorder({
    window: [{ oldest: '2026-01-01T00:00:00.000Z', newest: '2026-09-20T00:00:00.000Z', exact_rows: 1000 }],
  });
  const report = await runDbAudit({
    query,
    now: () => new Date('2026-09-21T00:00:00.000Z'),
    rules: [
      { schema: 'public', relation: 'provider_offer_history', timeColumn: 'snapshot_at', hotRetentionDays: 45 },
    ],
  });
  assert.equal(report.retention.length, 1);
  assert.equal(report.retention[0].violates, true);
  assert.equal(report.retention[0].age_days, 263);
  assert.equal(report.retention[0].exact_rows, 1000);
});

test('a relation that cannot be measured is reported as unmeasured, not as compliant', async () => {
  const query: SqlRunner = async (sql) => {
    if (sql === READ_ONLY_PREAMBLE) return [];
    if (sql.includes('min(')) throw new Error('permission denied for table');
    return [];
  };
  const report = await runDbAudit({
    query,
    rules: [{ schema: 'public', relation: 'locked_down', timeColumn: 'created_at', hotRetentionDays: 45 }],
  });
  assert.equal(report.retention[0].violates, false);
  assert.ok(report.retention[0].note.includes('could not be measured'));
  assert.equal(report.retention[0].oldest, null, 'an unreadable window is null, never a date');
});

test('a relation that is absent is not assessable', async () => {
  const { query } = recorder({ relations: [] });
  const assessment = await assessArchiveCandidate({
    query,
    schema: 'public',
    relation: 'provider_offers_legacy_quarantine',
    timeColumn: 'snapshot_at',
  });
  assert.equal(assessment.exists, false);
  assert.equal(assessment.recommendation, 'not_assessable');
  assert.equal(assessment.total_bytes, null, 'a relation that is not there has no size to quote');
});

test('an assessment never concludes that a relation is safe to prune', async () => {
  // The relation here is large, old, and has no inbound foreign key — the most
  // favourable shape a candidate can have. It still does not get promoted.
  const { query } = recorder({
    relations: [
      {
        schema: 'public',
        relation: 'provider_offers_legacy_quarantine',
        total_bytes: 6_849_000_000,
        estimated_rows: 8_190_000,
      },
    ],
    foreign_keys: [],
    window: [{ oldest: '2025-01-01T00:00:00.000Z', newest: '2026-07-07T00:00:00.000Z' }],
  });

  const assessment = await assessArchiveCandidate({
    query,
    schema: 'public',
    relation: 'provider_offers_legacy_quarantine',
    timeColumn: 'snapshot_at',
  });

  assert.equal(assessment.exists, true);
  assert.equal(assessment.total_bytes, 6_849_000_000);
  assert.deepEqual(assessment.inbound_foreign_keys, []);
  assert.equal(assessment.recommendation, 'assess_further', 'there is no "candidate" verdict to reach');
  assert.ok(
    assessment.blocking_unknowns.some((unknown) => unknown.includes('runtime readers')),
    'catalog state cannot establish that nothing reads a relation',
  );
  assert.ok(assessment.blocking_unknowns.some((unknown) => unknown.includes('replay paths')));
});

test('an inbound foreign key is reported as blocking', async () => {
  const { query } = recorder({
    relations: [{ schema: 'public', relation: 'picks', total_bytes: 1, estimated_rows: 1 }],
    foreign_keys: [
      {
        constraint_name: 'settlement_records_pick_id_fkey',
        referencing_schema: 'public',
        referencing_relation: 'settlement_records',
        referenced_schema: 'public',
        referenced_relation: 'picks',
      },
    ],
    window: [{ oldest: null, newest: null }],
  });
  const assessment = await assessArchiveCandidate({
    query,
    schema: 'public',
    relation: 'picks',
    timeColumn: 'created_at',
  });
  assert.deepEqual(assessment.inbound_foreign_keys, [
    'public.settlement_records (settlement_records_pick_id_fkey)',
  ]);
  assert.ok(assessment.blocking_unknowns.some((u) => u.includes('inbound foreign key')));
});

test('an assessment with no time column says the window is unknown', async () => {
  const { query } = recorder({
    relations: [{ schema: 'public', relation: 'raw_payloads', total_bytes: 1, estimated_rows: 1 }],
  });
  const assessment = await assessArchiveCandidate({
    query,
    schema: 'public',
    relation: 'raw_payloads',
  });
  assert.equal(assessment.oldest, null);
  assert.ok(assessment.blocking_unknowns.some((u) => u.includes('no time column supplied')));
});
