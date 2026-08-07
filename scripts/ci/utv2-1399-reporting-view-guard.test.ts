/**
 * UTV2-1399 — static guards for the fixture-excluding reporting views.
 *
 * These tests encode, mechanically, the properties the lane promised so they
 * cannot be quietly regressed later:
 *
 *   1. The migration is VIEWS-ONLY and mutates nothing. No DELETE, UPDATE,
 *      TRUNCATE, ALTER TABLE, or DROP COLUMN against a base table.
 *   2. It is reversible: everything lives in schema `reporting`, and the down
 *      script drops that schema.
 *   3. The classifier never keys on `source` alone for the sources that are
 *      BOTH legitimate and fixture producers — the single most dangerous
 *      failure mode, measured to wrongly exclude 6,462 of 7,580 real picks.
 *   4. The classifier is a CASE returning a reason, not an OR-chain, so the
 *      411-row three-valued-logic trap cannot reappear.
 *
 * Per CLAUDE.md invariant 11: if a rule can be enforced mechanically, it must
 * not live only in prose.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const MIGRATION = 'supabase/migrations/20260731000000_utv2_1399_fixture_excluding_reporting_views.sql';
const ROLLBACK =
  'db/migrations-rollback/20260731000000_utv2_1399_fixture_excluding_reporting_views.down.sql';

const migrationSql = readFileSync(MIGRATION, 'utf8');
const rollbackSql = readFileSync(ROLLBACK, 'utf8');

/** Strip `--` line comments so prose describing forbidden SQL is not matched. */
function executableSql(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const migrationCode = executableSql(migrationSql);
const rollbackCode = executableSql(rollbackSql);

test('UTV2-1399 migration performs no row mutation of any kind', () => {
  // The PM has explicitly NOT authorized deleting or altering any fixture row.
  // Deletion requires a separate, independently reviewed exact-ID packet.
  const forbidden: Array<[string, RegExp]> = [
    ['DELETE', /\bDELETE\s+FROM\b/i],
    ['UPDATE', /\bUPDATE\s+(?:public|reporting)?\.?\w+\s+SET\b/i],
    ['TRUNCATE', /\bTRUNCATE\b/i],
    ['INSERT', /\bINSERT\s+INTO\b/i],
    ['ALTER TABLE', /\bALTER\s+TABLE\b/i],
    ['DROP TABLE', /\bDROP\s+TABLE\b/i],
    ['DROP COLUMN', /\bDROP\s+COLUMN\b/i],
    ['GRANT', /\bGRANT\b/i], // privileges are UTV2-1633's scope, not this lane's
  ];

  for (const [label, pattern] of forbidden) {
    assert.equal(
      pattern.test(migrationCode),
      false,
      `${MIGRATION} must not contain ${label}. This migration is views-only; ` +
        `no base table may be altered and no row deleted or mutated.`,
    );
  }
});

test('UTV2-1399 migration creates only views and one function, all in schema reporting', () => {
  assert.match(migrationCode, /CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS\s+reporting\b/i);

  const createdObjects = [...migrationCode.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(VIEW|FUNCTION)\s+([\w.]+)/gi)];
  assert.ok(createdObjects.length >= 6, 'expected the classifier function plus five views');

  for (const [, kind, name] of createdObjects) {
    assert.ok(
      name!.startsWith('reporting.'),
      `${kind} ${name} must live in schema "reporting" so the whole surface is ` +
        `removable with a single DROP SCHEMA. An object in public.* would also ` +
        `add Live Schema Parity findings.`,
    );
  }

  // Nothing may be created as a materialized view: a matview would be a real
  // stored copy of production data and would silently go stale.
  assert.equal(
    /CREATE\s+MATERIALIZED\s+VIEW/i.test(migrationCode),
    false,
    'reporting surface must be plain views, never materialized copies',
  );
});

test('UTV2-1399 rollback drops the reporting schema and nothing else', () => {
  assert.match(rollbackCode, /DROP\s+SCHEMA\s+IF\s+EXISTS\s+reporting\s+CASCADE/i);

  // The rollback must not be marked irreversible — this migration genuinely is
  // reversible, so it must NOT appear in the exemption registry.
  assert.equal(
    /--\s*IRREVERSIBLE:/i.test(rollbackSql),
    false,
    'this migration is fully reversible; it must not claim an IRREVERSIBLE exemption',
  );

  const registry = JSON.parse(
    readFileSync('db/migrations-rollback/irreversible-exemption-registry.json', 'utf8'),
  ) as { exemptions: Array<{ migration: string }> };
  assert.equal(
    registry.exemptions.some((e) => e.migration.includes('utv2_1399')),
    false,
    'UTV2-1399 must not hold an irreversibility exemption',
  );

  for (const pattern of [/\bDELETE\s+FROM\b/i, /\bTRUNCATE\b/i, /\bDROP\s+TABLE\b/i]) {
    assert.equal(
      pattern.test(rollbackCode),
      false,
      'rollback must drop only the reporting schema; base tables are never touched',
    );
  }
});

test('UTV2-1399 classifier never keys on a dual-use source', () => {
  // These source names are BOTH legitimate production sources AND fixture
  // sources. Classifying on them would destroy real data. Measured: a naive
  // source-based predicate wrongly excludes 6,462 of 7,580 real picks.
  const dualUseSources = ['smart-form', 'system-pick-scanner', 'model-driven', 'alert-agent'];

  for (const source of dualUseSources) {
    assert.equal(
      migrationCode.includes(`'${source}'`),
      false,
      `Classifier must not reference source '${source}'. It is a legitimate ` +
        `production source name as well as a fixture one; only 't1-proof' and ` +
        `'canary-proof' are purely synthetic.`,
    );
  }

  // 'api' is also dual-use. Assert it is not used as a source-equality marker.
  assert.equal(
    /p_source\s+IN\s*\([^)]*'api'/i.test(migrationCode),
    false,
    "source 'api' is dual-use and must never be a fixture marker",
  );

  // The only permitted source-based marker.
  assert.match(migrationCode, /p_source\s+IN\s*\(\s*'t1-proof'\s*,\s*'canary-proof'\s*\)/i);
});

test('UTV2-1399 classifier avoids the three-valued-logic trap', () => {
  // A bare OR-chain over metadata->>'eventName' evaluates to SQL NULL (not
  // false) for rows with no such key — measured at 411 of 107,858 rows — so
  // `WHERE NOT (predicate)` drops them from BOTH sides. A CASE returning a
  // reason, filtered with IS NULL / IS NOT NULL, is total by construction.
  assert.match(
    migrationCode,
    /RETURNS\s+text/i,
    'classifier must return a reason code, not a boolean',
  );
  assert.match(migrationCode, /pick_fixture_reason\([^)]*\)\s+IS\s+NULL/i);
  assert.match(migrationCode, /pick_fixture_reason\([^)]*\)\s+IS\s+NOT\s+NULL/i);

  // A STRICT function would return NULL ("legitimate") for any NULL argument,
  // silently readmitting fixtures.
  assert.equal(
    /RETURNS\s+NULL\s+ON\s+NULL\s+INPUT|\bSTRICT\b/i.test(migrationCode),
    false,
    'classifier must not be STRICT — a NULL argument would silently mark the row legitimate',
  );

  // Fail-closed partition assertion must be present.
  assert.match(
    migrationCode,
    /RAISE\s+EXCEPTION[\s\S]{0,200}partition check failed/i,
    'migration must abort if retained + excluded !== raw',
  );
});

test('UTV2-1399 classifier matches UTV2 tags with space and underscore, not only hyphen', () => {
  // The original classifier required a hyphen immediately after "UTV2" and so
  // missed the whole "UTV2 Proof Player <hex>" family emitted by the CLV proof
  // harness. The character class [ _-] closes that gap.
  assert.match(migrationCode, /\^UTV2\[ _-\]/i);
  assert.match(migrationCode, /\^utv2\[ _-\]/i);

  // Mid-string per-run tags, e.g. "... [utv2-588-1776835452283]".
  assert.match(migrationCode, /\\\[utv2-\[0-9\]\+/i);
  assert.match(migrationCode, /\\\(utv2-\[0-9\]\+/i);
});
