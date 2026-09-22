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

/*
 * Adversarial coverage for the function-call control (UTV2-1802 review).
 *
 * The statement-keyword scan above catches a write that *looks* like a write.
 * What follows is the class it cannot catch: a statement that opens with
 * SELECT, contains no forbidden keyword, and writes anyway because the work is
 * done by the function it calls. Each case below passes every other check in
 * the policy, so each one is a genuine test of the allowlist rather than of
 * something that would have been refused anyway.
 */

test('a write-capable function inside a SELECT is rejected — this is the setval class', () => {
  // `select setval('s', 1)` begins with SELECT, and `setval` is not the whole
  // word `set`, so the keyword scan passes it. It advances a sequence.
  const message = rejects("select setval('picks_id_seq', 1)");
  assert.match(message, /setval/);
  assert.match(message, /allowlist/);

  rejects("select nextval('picks_id_seq')");
  rejects("select setval('picks_id_seq', (select max(id) from picks))");
});

test('session and configuration writers dressed as functions are rejected', () => {
  // `set_config` is the reason `set` is deliberately absent from the
  // non-call keyword list: the word must reach the allowlist to be refused.
  rejects("select set_config('role', 'postgres', false)");
  rejects('select pg_reload_conf()');
});

test('lock and backend-control functions are rejected', () => {
  // None of these writes a row; all of them change server state, and a
  // "read-only" credential that can terminate backends is not read-only.
  rejects('select pg_advisory_lock(1)');
  rejects('select pg_advisory_xact_lock(1)');
  rejects('select pg_terminate_backend(pid) from pg_stat_activity');
  rejects('select pg_cancel_backend(1)');
});

test('an unknown function is rejected even though nobody listed it as dangerous', () => {
  // The point of an allowlist: a function invented after this file was written
  // is refused by default. A denylist would have admitted it.
  const message = rejects('select some_function_nobody_has_heard_of(1)');
  assert.match(message, /some_function_nobody_has_heard_of/);
  rejects('select pg_replication_slot_advance(1)');
});

test('a call qualified into a non-catalog schema is rejected', () => {
  // A `SECURITY DEFINER` function in the application schema is exactly the
  // shape a prefix could otherwise launder.
  const message = rejects('select public.promote_pick(1)');
  assert.match(message, /pg_catalog/);
  rejects('select app.dangerous(1)');
  // The qualification itself is not a bypass in the other direction either:
  // pg_catalog-qualified still has to be on the list.
  rejects('select pg_catalog.pg_terminate_backend(1)');
});

test('a data-modifying CTE calling a writer is rejected', () => {
  // Belt and braces: the keyword scan already refuses the DELETE, and the
  // allowlist independently refuses the call.
  rejects("with gone as (delete from picks returning id) select setval('s', 1)");
  rejects("with moved as (select setval('s', 1) as v) select v from moved");
});

test('every function the shipped statements call is allowlisted, and the parser is not fooled by what merely looks like a call', () => {
  // The three registry statements are validated at import time, so a
  // false positive here would be a boot failure rather than a test failure —
  // which is why the individual shapes are asserted directly as well.

  // `values (` is a keyword, not a call.
  assertSingleReadOnlyStatement('ok', "select * from (values ('a','b')) as t(x, y)");
  // An alias column list, with and without AS.
  assertSingleReadOnlyStatement('ok', 'select x from (select 1) as t(x)');
  assertSingleReadOnlyStatement('ok', 'select x from (select 1) t(x)');
  // `extract(epoch from ...)` — `epoch` is followed by FROM, not by `(`.
  assertSingleReadOnlyStatement(
    'ok',
    'select coalesce(max(extract(epoch from now() - xact_start)), 0)::int from pg_stat_activity',
  );
  // A cast has no parentheses at all.
  assertSingleReadOnlyStatement('ok', 'select setting::int from pg_settings');
  assertSingleReadOnlyStatement('ok', 'select wal_bytes::numeric from pg_stat_wal');
  // The size and catalog readers the storage gauge is built on.
  assertSingleReadOnlyStatement(
    'ok',
    "select coalesce(pg_total_relation_size(to_regclass(format('public.%I', 'picks'))), 0)::bigint",
  );
  assertSingleReadOnlyStatement('ok', "select current_setting('archive_mode', true)");
  assertSingleReadOnlyStatement('ok', 'select coalesce(sum(size), 0)::bigint from pg_ls_waldir()');
  // A subquery in the select list is a parenthesised expression, not a call.
  assertSingleReadOnlyStatement('ok', 'select (select count(*)::int from pg_locks where not granted) as n');
});

test('a function name hidden in a string literal is not a call, and one after a comment still is', () => {
  // The stripper runs first, so the allowlist sees code only. Both directions
  // are asserted, because a stripper that is too eager would silently stop
  // seeing real calls.
  assertSingleReadOnlyStatement('ok', "select 'setval(1)' as label");
  rejects('select 1 -- harmless\n , setval(2)');
});
