/**
 * UTV2-1814 — declaration parsing for the fail-closed precondition drill.
 *
 * The drill itself needs a live scratch Postgres and is exercised by
 * `migration-reversibility-gate.yml`, including two adversarial fixtures that
 * prove it reports FAIL for a declared-but-unenforced guard. What that job
 * cannot cheaply cover is the parsing layer, and the parsing layer is where a
 * routine declaration silently becomes two nonsense relation names.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseDeclaredRelations,
  parseDeclaredTargets,
  splitDeclarationList,
  REQUIRED_SQLSTATE,
  REQUIRED_ROUTINE_SQLSTATE,
} from './migration-precondition-drill.ts';

test('a routine signature is one target, not one per argument', () => {
  // The whole reason splitDeclarationList exists. A naive split(',') yields
  // 'public.f(jsonb' and 'jsonb)', and the drill then fails a correct guard
  // while naming a cause that does not exist.
  assert.deepEqual(splitDeclarationList('public.f(jsonb, jsonb)'), ['public.f(jsonb, jsonb)']);
});

test('commas at depth zero still separate targets', () => {
  assert.deepEqual(splitDeclarationList('public.a, public.f(jsonb, jsonb), public.b'), [
    'public.a',
    'public.f(jsonb, jsonb)',
    'public.b',
  ]);
});

test('an argument list is what makes a target a routine', () => {
  assert.deepEqual(
    parseDeclaredTargets('-- FAIL-CLOSED-PRECONDITION: public.tbl, public.f(jsonb, jsonb)\n'),
    [
      { kind: 'relation', ident: 'public.tbl' },
      { kind: 'routine', ident: 'public.f(jsonb, jsonb)' },
    ],
  );
});

test('a zero-argument routine is still a routine', () => {
  assert.deepEqual(parseDeclaredTargets('-- FAIL-CLOSED-PRECONDITION: public.f()\n'), [
    { kind: 'routine', ident: 'public.f()' },
  ]);
});

test('parseDeclaredRelations excludes routines rather than stringifying them', () => {
  // A caller that only understands relations must not be handed a routine to
  // seed as `CREATE TABLE public.f(jsonb, jsonb) (id uuid PRIMARY KEY)`.
  assert.deepEqual(
    parseDeclaredRelations('-- FAIL-CLOSED-PRECONDITION: public.tbl, public.f(jsonb)\n'),
    ['public.tbl'],
  );
});

test('an undeclared migration yields no targets', () => {
  assert.deepEqual(parseDeclaredTargets('CREATE TABLE public.x (id uuid);\n'), []);
});

test('prose mentioning the marker mid-line does not declare it', () => {
  // The marker regex is anchored to the start of a comment line. This is the
  // fail-open bug the gate's own regression fixture guards at the shell level;
  // asserting it here keeps the two from drifting apart.
  assert.deepEqual(parseDeclaredTargets('-- see the -- FAIL-CLOSED-PRECONDITION: public.x note\n'), []);
});

test('the two required SQLSTATEs are the duplicate-object codes, and differ', () => {
  assert.equal(REQUIRED_SQLSTATE, '42P07');
  assert.equal(REQUIRED_ROUTINE_SQLSTATE, '42723');
  assert.notEqual(REQUIRED_SQLSTATE, REQUIRED_ROUTINE_SQLSTATE);
});
