/**
 * The Command Center runs SQL under an account-scoped Supabase management
 * token — a credential that can drop a table and is not constrained by RLS.
 * These tests pin the two properties that keep that survivable: no caller can
 * supply SQL, and no statement that could write can be registered.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqlPolicyError, assertSingleReadOnlyStatement, defineReadOnlyQueries } from './management-sql';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function rejects(sql: string): string {
  let caught: unknown;
  try {
    assertSingleReadOnlyStatement('probe', sql);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof SqlPolicyError, `expected a SqlPolicyError for: ${sql}`);
  return (caught as SqlPolicyError).message;
}

test('a plain SELECT is accepted', () => {
  assertSingleReadOnlyStatement('ok', 'select count(*) from picks');
});

test('a trailing semicolon is the conventional terminator, not a second statement', () => {
  assertSingleReadOnlyStatement('ok', 'select 1;');
  assertSingleReadOnlyStatement('ok', 'select 1;   \n  ');
});

test('a CTE is accepted', () => {
  assertSingleReadOnlyStatement('ok', "with t as (select 1 as n) select n from t");
});

test('every writing statement is rejected on its own', () => {
  for (const sql of [
    'insert into picks (id) values (1)',
    'update picks set status = 1',
    'delete from picks',
    'truncate table picks',
    'drop table picks',
    'alter table picks add column x int',
    'create table t (id int)',
    'grant select on picks to anon',
    'revoke select on picks from anon',
    'copy picks to stdout',
    'do $$ begin end $$',
    'vacuum full',
    'refresh materialized view mv',
  ]) {
    rejects(sql);
  }
});

test('a write smuggled in behind a SELECT is rejected', () => {
  const message = rejects('select 1; drop table picks');
  assert.match(message, /more than one statement/);
});

test('a data-modifying CTE is rejected even though it opens with WITH', () => {
  // Postgres genuinely executes this and deletes rows. The opening keyword is
  // therefore not sufficient on its own, which is the reason for the keyword
  // scan that runs after it.
  const message = rejects("with gone as (delete from picks returning id) select count(*) from gone");
  assert.match(message, /DELETE/);
});

test('SELECT ... INTO is rejected', () => {
  const message = rejects('select id into copy_of_picks from picks');
  assert.match(message, /CREATE|INTO/);
});

test('a keyword hidden inside a comment cannot slip past the scan', () => {
  // The stripper removes comments, so a write cannot be disguised as one and
  // then re-enabled — but equally the scan must still see real code that
  // follows a comment on the same line.
  assertSingleReadOnlyStatement('ok', 'select 1 -- drop table picks\n');
  rejects('select 1 /* x */ ; delete from picks');
});

test('a keyword inside a dollar-quoted body cannot hide from the scan', () => {
  // `$$ ... $$` is how a function body would carry a mutation. The body is
  // removed, so the statement is judged on what is outside it — and a bare
  // `do $$ ... $$` is rejected by its opening keyword regardless.
  rejects('do $$ begin delete from picks; end $$');
});

test('a column named updated_at is not mistaken for an UPDATE', () => {
  // The real growth query counts rows by `updated_at` and `inserted_at`. A
  // substring match would reject the app's own read-only statements.
  assertSingleReadOnlyStatement(
    'ok',
    "select count(*) from provider_cycle_status where updated_at >= now() - interval '1 day'",
  );
  assertSingleReadOnlyStatement('ok', 'select inserted_at from backups');
  assertSingleReadOnlyStatement('ok', 'select setting::int from pg_settings');
  assertSingleReadOnlyStatement('ok', 'select count(*) from pg_locks where not granted');
});

test('a keyword appearing only inside a string literal is not a write', () => {
  assertSingleReadOnlyStatement('ok', "select 'drop table picks' as label");
});

test('functions that reach the filesystem or the network are rejected', () => {
  rejects("select pg_read_file('/etc/passwd')");
  rejects("select * from dblink('host=evil', 'select 1') as t(x int)");
  rejects('select pg_sleep(600)');
});

test('pg_ls_waldir stays available — it is a WAL metric, not a filesystem read', () => {
  assertSingleReadOnlyStatement('ok', 'select coalesce(sum(size), 0)::bigint from pg_ls_waldir()');
});

test('an empty or unrecognised statement is refused rather than passed through', () => {
  rejects('');
  rejects('   \n  ');
  rejects('-- just a comment');
  rejects('pick something');
});

test('defineReadOnlyQueries validates every entry and freezes the result', () => {
  const queries = defineReadOnlyQueries({ a: 'select 1', b: 'select 2' });
  assert.equal(queries.a, 'select 1');
  assert.ok(Object.isFrozen(queries), 'the registry must be frozen');
  try {
    (queries as Record<string, string>)['a'] = 'delete from picks';
  } catch {
    // A strict-mode assignment to a frozen object throws; a sloppy-mode one is
    // silently dropped. Either is fine — what matters is the value below.
  }
  assert.equal(queries.a, 'select 1', 'a registered statement must not be replaceable');

  assert.throws(
    () => defineReadOnlyQueries({ good: 'select 1', bad: 'delete from picks' }),
    (error: unknown) => error instanceof SqlPolicyError && /"bad"/.test((error as Error).message),
  );
});

test('the three statements storage-health actually ships satisfy the policy', async () => {
  // The registry is validated at import time, so importing the module IS the
  // assertion: a real query edited into a write fails here rather than at a
  // request against production.
  await import('./storage-health');
});

test('storage-health cannot send SQL that did not come from its registry', () => {
  // A source-level pin. The runtime tests above prove the policy rejects a
  // write; this proves the policy is actually the only way in — a helper that
  // takes a SQL string would reintroduce the hole without failing any of them.
  const source = fs.readFileSync(path.join(HERE, 'storage-health.ts'), 'utf8');

  assert.ok(
    source.includes('defineReadOnlyQueries('),
    'storage-health must declare its statements through the validated registry',
  );
  assert.equal(
    /function\s+run\w*Query\s*(<[^>]*>)?\s*\(\s*\w+\s*:\s*string/.test(source),
    false,
    'no query helper in storage-health may accept a SQL string',
  );

  const queryPost = source.slice(source.indexOf("'/database/query'") - 400);
  assert.ok(
    /read_only:\s*true/.test(source),
    'the management query request should also ask the remote to enforce read-only',
  );
  assert.equal(
    queryPost.includes('${query}'),
    false,
    'the request body must not interpolate a caller-supplied statement',
  );
});
