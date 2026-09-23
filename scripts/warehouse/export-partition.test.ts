/**
 * WORK-2026092101 — bounded historical export.
 *
 * Two things are proven here. First, that the SQL builders refuse anything they
 * cannot vouch for: an export is the one place a relation name, a column name
 * and a literal all meet, and "it validated upstream" is not a property this
 * module may assume. Second, that a real export through DuckDB produces real
 * zstd-compressed Parquet whose row count and checksum are measured from the
 * written file rather than reported by the writer about itself.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { type DuckConnection, openDuckDb, quote } from './duckdb.js';
import {
  DEFAULT_ROW_GROUP_SIZE,
  ExportError,
  assertSourceNotRowFiltered,
  buildRowSecurityProbeSql,
  type SourceSpec,
  buildCopySql,
  buildCountSql,
  buildSelectSql,
  buildWhereClause,
  exportWindowToParquet,
  qualifyAttached,
  validateSource,
} from './export-partition.js';
import { sha256File } from './object-store.js';

const SOURCE: SourceSpec = {
  relation: 'public.provider_offer_history',
  window: {
    column: 'snapshot_at',
    start: '2026-09-14T00:00:00.000Z',
    end: '2026-09-15T00:00:00.000Z',
  },
  filterColumn: 'sport_key',
  filterValue: 'nfl',
  orderBy: ['snapshot_at', 'id'],
};

test('the where clause is half-open and carries the filter', () => {
  const where = buildWhereClause(SOURCE);
  assert.ok(where.includes(`"snapshot_at" >= '2026-09-14T00:00:00.000Z'::TIMESTAMPTZ`));
  assert.ok(where.includes(`"snapshot_at" < '2026-09-15T00:00:00.000Z'::TIMESTAMPTZ`));
  assert.ok(where.includes(`"sport_key" = 'nfl'`));
  assert.equal(where.includes('<='), false, 'the upper bound must be exclusive');
});

test('there is no path to a select without a window', () => {
  assert.throws(
    () => buildSelectSql({ ...SOURCE, window: { ...SOURCE.window, end: SOURCE.window.start } }),
    ExportError,
  );
  assert.throws(
    () => buildSelectSql({ ...SOURCE, window: { ...SOURCE.window, start: 'not-a-date' } }),
    ExportError,
  );
});

test('an export without a deterministic ordering is refused', () => {
  assert.throws(() => validateSource({ ...SOURCE, orderBy: [] }), /orderBy is required/);
});

test('identifiers are validated, not escaped', () => {
  for (const relation of ['public.offers; DROP TABLE picks', 'Public.Offers', '../etc', 'a.b.c', '']) {
    assert.throws(() => validateSource({ ...SOURCE, relation }), ExportError, relation);
  }
  for (const column of ['snapshot_at; --', 'SnapshotAt', '1col']) {
    assert.throws(
      () => validateSource({ ...SOURCE, window: { ...SOURCE.window, column } }),
      ExportError,
      column,
    );
  }
});

test('a filter column without a value is refused rather than dropped', () => {
  assert.throws(
    () => validateSource({ ...SOURCE, filterColumn: 'sport_key', filterValue: null }),
    /filterColumn was supplied without a filterValue/,
  );
});

test('a literal containing a quote is escaped, not injected', () => {
  const where = buildWhereClause({ ...SOURCE, filterValue: "nf'l" });
  assert.ok(where.includes(`"sport_key" = 'nf''l'`));
});

test('the copy statement always asks for parquet and zstd', () => {
  const sql = buildCopySql('SELECT 1', '/tmp/out.parquet');
  assert.ok(sql.includes('FORMAT parquet'));
  assert.ok(sql.includes('COMPRESSION zstd'));
  assert.ok(sql.includes(`ROW_GROUP_SIZE ${DEFAULT_ROW_GROUP_SIZE}`));
  assert.throws(() => buildCopySql('SELECT 1', '/tmp/out.parquet', 0), ExportError);
});

test('count and select read the same relation and predicate', () => {
  assert.ok(buildCountSql(SOURCE).includes('count(*)'));
  assert.ok(buildCountSql(SOURCE).endsWith(buildWhereClause(SOURCE)));
  assert.ok(buildSelectSql(SOURCE).includes('ORDER BY "snapshot_at", "id"'));
});

test('an attached relation is qualified into the attachment', () => {
  assert.equal(qualifyAttached('src', 'public.provider_offer_history'), '"src"."public"."provider_offer_history"');
  assert.equal(qualifyAttached('src', 'picks'), '"src"."public"."picks"');
});

async function seedFixture(connection: DuckConnection): Promise<void> {
  await connection.run(`
    CREATE TABLE offers AS
    SELECT
      ('00000000-0000-4000-8000-' || lpad(CAST(i AS VARCHAR), 12, '0'))::UUID AS id,
      TIMESTAMPTZ '2026-09-14 00:00:00+00' + INTERVAL (i) MINUTE          AS snapshot_at,
      CASE WHEN i % 2 = 0 THEN 'nfl' ELSE 'nba' END                        AS sport_key,
      'evt-' || CAST(i % 7 AS VARCHAR)                                     AS provider_event_id,
      'mkt-' || CAST(i % 3 AS VARCHAR)                                     AS provider_market_key,
      'book-' || CAST(i % 4 AS VARCHAR)                                    AS bookmaker_key,
      CAST(i AS DECIMAL(18,3)) / 4                                         AS line
    FROM range(0, 2880) tbl(i)
  `);
}

const FIXTURE_SOURCE: SourceSpec = {
  relation: 'offers',
  window: {
    column: 'snapshot_at',
    start: '2026-09-14T00:00:00.000Z',
    end: '2026-09-15T00:00:00.000Z',
  },
  filterColumn: 'sport_key',
  filterValue: 'nfl',
  orderBy: ['snapshot_at', 'id'],
};

test('exports a real window to zstd parquet and measures it from the file', async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-warehouse-export-'));
  const connection = await openDuckDb();
  try {
    await seedFixture(connection);
    const destination = path.join(workDir, 'part-0000.parquet');

    const result = await exportWindowToParquet({
      connection,
      source: FIXTURE_SOURCE,
      destinationPath: destination,
    });

    // 2880 minutes from midnight spans exactly two days; the half-open window
    // takes the first 1440, of which the even-numbered minutes are nfl.
    assert.equal(result.sourceRowCount, 720);
    assert.equal(result.exportedRowCount, 720);
    assert.ok(result.byteSize > 0);
    assert.equal(result.checksumSha256, sha256File(destination).sha256);
    assert.equal(result.byteSize, sha256File(destination).size);
    assert.deepEqual(
      result.columns.map((c) => c.name),
      ['id', 'snapshot_at', 'sport_key', 'provider_event_id', 'provider_market_key', 'bookmaker_key', 'line'],
    );

    const compressions = await connection.all(
      `SELECT DISTINCT compression FROM parquet_metadata(${quote(destination)})`,
    );
    assert.deepEqual(
      compressions.map((row) => String(row.compression)),
      ['ZSTD'],
      'every column chunk must be zstd-compressed',
    );

    // Nothing outside the window leaked in.
    const bounds = await connection.all(
      `SELECT min(snapshot_at) AS lo, max(snapshot_at) AS hi, count(DISTINCT sport_key) AS sports
       FROM read_parquet(${quote(destination)})`,
    );
    assert.equal(Number(bounds[0].sports), 1);
    // Assert the shape before the range. A DuckDB timestamp that reached here as
    // an un-normalized `{micros}` object stringifies to "[object Object]", which
    // compares greater than any date literal — so the range assertions below
    // would pass against anything at all.
    for (const bound of ['lo', 'hi'] as const) {
      assert.match(
        String(bounds[0][bound]),
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        `${bound} must be a UTC ISO instant, not an opaque object`,
      );
    }
    assert.ok(String(bounds[0].lo) >= '2026-09-14');
    assert.ok(String(bounds[0].hi) < '2026-09-15');
  } finally {
    await connection.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('an empty window exports an empty, still-readable object', async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-warehouse-export-'));
  const connection = await openDuckDb();
  try {
    await seedFixture(connection);
    const destination = path.join(workDir, 'part-0000.parquet');
    const result = await exportWindowToParquet({
      connection,
      source: {
        ...FIXTURE_SOURCE,
        window: {
          column: 'snapshot_at',
          start: '2020-01-01T00:00:00.000Z',
          end: '2020-01-02T00:00:00.000Z',
        },
      },
      destinationPath: destination,
    });
    assert.equal(result.sourceRowCount, 0);
    assert.equal(result.exportedRowCount, 0);
    assert.ok(fs.existsSync(destination), 'an empty window still produces an object to verify');
  } finally {
    await connection.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('a window above the row bound is refused before anything is written', async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-warehouse-export-'));
  const connection = await openDuckDb();
  try {
    await seedFixture(connection);
    const destination = path.join(workDir, 'part-0000.parquet');
    await assert.rejects(
      () =>
        exportWindowToParquet({
          connection,
          source: FIXTURE_SOURCE,
          destinationPath: destination,
          maxWindowRows: 10,
        }),
      /window holds 720 rows, above the 10-row bound/,
    );
    assert.equal(fs.existsSync(destination), false, 'a refused export must write nothing');
  } finally {
    await connection.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('re-exporting the same window overwrites rather than appends', async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-warehouse-export-'));
  const connection = await openDuckDb();
  try {
    await seedFixture(connection);
    const destination = path.join(workDir, 'part-0000.parquet');
    const first = await exportWindowToParquet({
      connection,
      source: FIXTURE_SOURCE,
      destinationPath: destination,
    });
    const second = await exportWindowToParquet({
      connection,
      source: FIXTURE_SOURCE,
      destinationPath: destination,
    });
    assert.equal(second.exportedRowCount, first.exportedRowCount);
    assert.equal(second.checksumSha256, first.checksumSha256, 'the export is byte-reproducible');
  } finally {
    await connection.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

// ── Row-level security: the loss a count comparison cannot see ──────────────

function probeConnection(answer: unknown): DuckConnection & { statements: string[] } {
  const statements: string[] = [];
  return {
    statements,
    async run() {
      throw new Error('the probe must not issue run()');
    },
    async all(sql: string) {
      statements.push(sql);
      return answer === undefined ? [] : [{ row_security_active: answer }];
    },
    async close() {},
  };
}

test('the row-security probe runs server-side through postgres_query, with the relation escaped', () => {
  assert.equal(
    buildRowSecurityProbeSql('src', 'public.provider_offer_history'),
    `SELECT * FROM postgres_query('src', 'SELECT row_security_active(''"public"."provider_offer_history"''::regclass) AS row_security_active')`,
  );
});

test('the row-security probe refuses a relation it cannot vouch for', () => {
  assert.throws(
    () => buildRowSecurityProbeSql('src', "public.x'); DROP TABLE picks; --"),
    (error: unknown) => error instanceof ExportError && error.code === 'invalid_relation',
  );
});

test('a source role that bypasses row security is admitted', async () => {
  const connection = probeConnection(false);
  await assertSourceNotRowFiltered(connection, 'src', 'public.provider_offer_history');
  assert.equal(connection.statements.length, 1);
});

test('a source role that row security filters is refused before any count is taken', async () => {
  const connection = probeConnection(true);
  await assert.rejects(
    assertSourceNotRowFiltered(connection, 'src', 'public.provider_offer_history'),
    (error: unknown) => error instanceof ExportError && error.code === 'row_security_filtered',
  );
});

test('an unreadable row-security answer fails closed', async () => {
  for (const answer of [undefined, null, 't', 1]) {
    await assert.rejects(
      assertSourceNotRowFiltered(probeConnection(answer), 'src', 'public.provider_offer_history'),
      (error: unknown) => error instanceof ExportError && error.code === 'row_security_unknown',
      `probe answer ${JSON.stringify(answer)} must be refused`,
    );
  }
});
