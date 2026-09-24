/**
 * WORK-2026092101 — the warehouse read path.
 *
 * The deliverable this file proves is a negative: a representative analytics
 * question is answered from archived Parquet **without a production database
 * credential**. So the test constructs the archive the way the conveyor does,
 * then answers the question with nothing in scope but an object-store URI.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { type DuckConnection, openDuckDb } from './duckdb.js';
import { exportWindowToParquet, type SourceSpec } from './export-partition.js';
import { dataObjectKey, type ArchiveTarget } from './object-layout.js';
import { LocalObjectStore } from './object-store.js';
import {
  REPRESENTATIVE_QUERY,
  SOURCE_PLACEHOLDER,
  buildSourceExpression,
  runWarehouseQuery,
} from './query.js';

async function seedFixture(connection: DuckConnection): Promise<void> {
  await connection.run(`
    CREATE TABLE offers AS
    SELECT
      ('00000000-0000-4000-8000-' || lpad(CAST(i AS VARCHAR), 12, '0'))::UUID AS id,
      TIMESTAMPTZ '2026-09-14 00:00:00+00' + INTERVAL (i) MINUTE          AS snapshot_at,
      CASE WHEN i % 2 = 0 THEN 'nfl' ELSE 'nba' END                        AS sport_key,
      'evt-' || CAST(i % 7 AS VARCHAR)                                     AS provider_event_id,
      'mkt-' || CAST(i % 3 AS VARCHAR)                                     AS provider_market_key,
      'book-' || CAST(i % 4 AS VARCHAR)                                    AS bookmaker_key
    FROM range(0, 2880) tbl(i)
  `);
}

function targetFor(sport: string, date: string): ArchiveTarget {
  return { kind: 'canonical', domain: 'markets', sport, season: '2026', date };
}

test('a query with no archive source is refused rather than run', async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-warehouse-query-'));
  try {
    const store = new LocalObjectStore(path.join(workDir, 'bucket'), 'archive');
    await assert.rejects(
      () => runWarehouseQuery({ store, prefix: 'canonical/markets', sql: 'SELECT 1' }),
      /must reference \{\{source\}\}/,
    );
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('the source expression unions across partitions under one prefix', () => {
  const expression = buildSourceExpression('file:///tmp/bucket', 'canonical/markets/nfl/2026');
  assert.ok(expression.startsWith('read_parquet('));
  assert.ok(expression.includes('canonical/markets/nfl/2026/**/*.parquet'));
  assert.ok(
    expression.includes('union_by_name = true'),
    'a schema that gained a column must not silently drop older partitions',
  );
});

test('the representative query answers a market question from the archive alone', async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-warehouse-query-'));
  const writer = await openDuckDb();
  try {
    await seedFixture(writer);
    const store = new LocalObjectStore(path.join(workDir, 'bucket'), 'archive');

    // Two days, two sports: four partitions, written exactly as the conveyor
    // writes them so the query is reading the real layout, not a flat folder.
    for (const [date, start, end] of [
      ['2026-09-14', '2026-09-14T00:00:00.000Z', '2026-09-15T00:00:00.000Z'],
      ['2026-09-15', '2026-09-15T00:00:00.000Z', '2026-09-16T00:00:00.000Z'],
    ] as const) {
      for (const sport of ['nfl', 'nba']) {
        const source: SourceSpec = {
          relation: 'offers',
          window: { column: 'snapshot_at', start, end },
          filterColumn: 'sport_key',
          filterValue: sport,
          orderBy: ['snapshot_at', 'id'],
        };
        const local = path.join(workDir, `${sport}-${date}.parquet`);
        await exportWindowToParquet({ connection: writer, source, destinationPath: local });
        await store.put(
          dataObjectKey(targetFor(sport, date)),
          fs.readFileSync(local),
          'application/vnd.apache.parquet',
        );
      }
    }

    // The reader is a separate connection that has never seen the fixture
    // table, and the environment carries no production credential at all.
    const reader = await openDuckDb();
    // The query runs with an environment that carries none of the production
    // keys, so succeeding at all shows it needs none of them.
    const env: NodeJS.ProcessEnv = {};

    try {
      const result = await runWarehouseQuery({
        store,
        prefix: 'canonical/markets',
        sql: REPRESENTATIVE_QUERY,
        connection: reader,
        env,
      });

      // `used_production_database` is typed as the literal `false`, so asserting
      // it proves nothing. What does: after the query, the reader has attached
      // no database besides DuckDB's own in-memory one.
      const attached = await reader.all(
        'SELECT database_name FROM duckdb_databases() WHERE NOT internal ORDER BY database_name',
      );
      assert.deepEqual(
        attached.map((row) => row.database_name),
        ['memory'],
        'the archive query must not attach any database',
      );
      assert.equal(result.row_count, 4, 'two days times two sports');

      const nflDayOne = result.rows.find(
        (row) => String(row.snapshot_date).startsWith('2026-09-14') && row.sport_key === 'nfl',
      );
      assert.ok(nflDayOne, 'the archive must be groupable by day and sport');
      assert.equal(Number(nflDayOne.offer_rows), 720);
      assert.equal(Number(nflDayOne.events), 7);
      assert.equal(Number(nflDayOne.markets), 3);
      // nfl is the even minutes, so `i % 4` only ever lands on 0 or 2 — two books,
      // not four. The fixture's own arithmetic, not a coverage gap in the archive.
      assert.equal(Number(nflDayOne.books), 2);

      const total = result.rows.reduce((sum, row) => sum + Number(row.offer_rows), 0);
      assert.equal(total, 2880, 'every archived row is reachable through one prefix');
    } finally {
      await reader.close();
    }
  } finally {
    await writer.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('the representative query makes no CLV, ROI or edge claim', () => {
  // Guardrail from HISTORICAL_MARKET_DATA_WAREHOUSE.md §11: the read path proves
  // the archive is queryable. Deriving a performance claim from it is separate
  // work under the scoring contracts, and must not arrive by accident here.
  const sql = REPRESENTATIVE_QUERY.toLowerCase();
  for (const forbidden of ['clv', 'roi', 'edge', 'units', 'profit']) {
    assert.equal(sql.includes(forbidden), false, `representative query must not mention ${forbidden}`);
  }
  assert.ok(REPRESENTATIVE_QUERY.includes(SOURCE_PLACEHOLDER));
});
