/**
 * WORK-2026092101 — warehouse object layout.
 *
 * The assertions that matter here are the refusals and the round trip. A layout
 * that accepts an unvalidated token writes an object somewhere nobody will look
 * for it again, and a layout you can write but not parse is one you cannot
 * audit after the fact — both failures are silent and both are permanent once a
 * season of partitions exists.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_DOMAINS,
  LAYOUT_VERSION,
  ObjectLayoutError,
  dataObjectKey,
  dataPrefix,
  domainSlug,
  manifestObjectKey,
  parseDataObjectKey,
  readGlob,
  requireIsoDate,
  validateTarget,
} from './object-layout.js';

test('builds the documented key for each target kind', () => {
  assert.equal(
    dataObjectKey({ kind: 'raw', provider: 'sgo', sport: 'nfl', season: '2026', date: '2026-09-14' }),
    'raw/sgo/nfl/2026/2026-09-14/part-0000.parquet',
  );
  assert.equal(
    dataObjectKey({
      kind: 'canonical',
      domain: 'markets',
      sport: 'ncaaf',
      season: '2026',
      date: '2026-09-14',
    }),
    'canonical/markets/ncaaf/2026/2026-09-14/part-0000.parquet',
  );
  assert.equal(
    dataObjectKey({ kind: 'features', featureVersion: 'v3', sport: 'nba' }, 'part-0007'),
    'features/v3/nba/part-0007.parquet',
  );
  assert.equal(
    dataObjectKey({ kind: 'training', datasetVersion: 'ds-2026-09' }),
    'training/ds-2026-09/part-0000.parquet',
  );
  assert.equal(dataPrefix({ kind: 'models', modelVersion: 'm-14' }), 'models/m-14');
});

test('every canonical domain is addressable and slugged as itself', () => {
  for (const domain of CANONICAL_DOMAINS) {
    const target = {
      kind: 'canonical' as const,
      domain,
      sport: 'nfl',
      season: '2026',
      date: '2026-01-02',
    };
    assert.equal(domainSlug(target), domain);
    assert.ok(dataObjectKey(target).startsWith(`canonical/${domain}/`));
  }
});

test('raw targets are slugged per provider so two providers never share a manifest folder', () => {
  const sgo = { kind: 'raw' as const, provider: 'sgo', sport: 'nfl', season: '2026', date: '2026-01-02' };
  const other = { ...sgo, provider: 'oddsapi' };
  assert.equal(domainSlug(sgo), 'raw_sgo');
  assert.equal(domainSlug(other), 'raw_oddsapi');
  assert.notEqual(
    manifestObjectKey(sgo, 'mabc123'),
    manifestObjectKey(other, 'mabc123'),
  );
});

test('refuses path traversal, absolute and uppercase tokens', () => {
  for (const sport of ['../../etc', '/nfl', 'NFL', 'nf l', '', 'nfl/..']) {
    assert.throws(
      () =>
        dataObjectKey({
          kind: 'canonical',
          domain: 'markets',
          sport,
          season: '2026',
          date: '2026-01-02',
        }),
      ObjectLayoutError,
      `sport ${JSON.stringify(sport)} must be refused`,
    );
  }
});

test('refuses a date that is well-formed but is not a calendar day', () => {
  assert.equal(requireIsoDate('2026-02-28'), '2026-02-28');
  for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '20260101', '2026-1-1']) {
    assert.throws(() => requireIsoDate(bad), ObjectLayoutError, `${bad} must be refused`);
  }
});

test('refuses an unknown canonical domain rather than inventing a folder for it', () => {
  assert.throws(
    () =>
      validateTarget({
        kind: 'canonical',
        // @ts-expect-error -- deliberately outside the union
        domain: 'markest',
        sport: 'nfl',
        season: '2026',
        date: '2026-01-02',
      }),
    ObjectLayoutError,
  );
});

test('data keys round-trip through the parser', () => {
  const targets = [
    { kind: 'raw' as const, provider: 'sgo', sport: 'nhl', season: '2025-26', date: '2026-01-02' },
    {
      kind: 'canonical' as const,
      domain: 'closing_lines' as const,
      sport: 'mlb',
      season: '2026',
      date: '2026-07-04',
    },
    { kind: 'features' as const, featureVersion: 'v1', sport: 'nba' },
    { kind: 'training' as const, datasetVersion: 'ds-1' },
  ];
  for (const target of targets) {
    const key = dataObjectKey(target, 'part-0003');
    const parsed = parseDataObjectKey(key);
    assert.ok(parsed, `${key} must parse`);
    assert.equal(parsed.part, 'part-0003');
    assert.deepEqual(parsed.target, validateTarget(target));
    assert.equal(dataObjectKey(parsed.target, parsed.part), key);
  }
});

test('the parser rejects keys it cannot vouch for instead of guessing', () => {
  for (const key of [
    'canonical/markets/nfl/2026/2026-02-30/part-0000.parquet',
    'canonical/typo/nfl/2026/2026-01-02/part-0000.parquet',
    'canonical/markets/nfl/2026/part-0000.parquet',
    'raw/sgo/nfl/2026/2026-01-02/part-0000.json',
    'manifests/markets/2026-01-02/mabc.json',
    '',
  ]) {
    assert.equal(parseDataObjectKey(key), null, `${key} must not parse`);
  }
});

test('manifest keys live under manifests/ and carry the window date', () => {
  const key = manifestObjectKey(
    { kind: 'canonical', domain: 'results', sport: 'nfl', season: '2026', date: '2026-09-14' },
    'mdeadbeef',
  );
  assert.equal(key, 'manifests/results/2026-09-14/mdeadbeef.json');
});

test('undated targets still get a manifest key', () => {
  assert.equal(
    manifestObjectKey({ kind: 'training', datasetVersion: 'ds-1' }, 'mabc'),
    'manifests/training/undated/mabc.json',
  );
});

test('readGlob spans every part file under a prefix', () => {
  assert.equal(
    readGlob('s3://bucket', 'canonical/markets/nfl/2026'),
    's3://bucket/canonical/markets/nfl/2026/**/*.parquet',
  );
  assert.equal(readGlob('s3://bucket/', '/canonical/markets/'), 's3://bucket/canonical/markets/**/*.parquet');
  assert.equal(readGlob('s3://bucket', ''), 's3://bucket/**/*.parquet');
});

test('layout version is pinned', () => {
  assert.equal(LAYOUT_VERSION, 1);
});
