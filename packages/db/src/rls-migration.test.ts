import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canonicalTables } from './index.js';

const migration = readFileSync(
  new URL('../../../supabase/migrations/202604190001_utv2_rls_enable_canonical_tables.sql', import.meta.url),
  'utf8',
);

test('UTV2-RLS migration covers every canonical public table', () => {
  for (const tableName of canonicalTables) {
    assert.match(
      migration,
      new RegExp(`'${tableName}'`),
      `migration must include canonical table ${tableName}`,
    );
  }
});

test('UTV2-RLS migration enables RLS without adding client policies', () => {
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table/i);
  assert.doesNotMatch(migration, /create\s+policy/i);
});
