import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTOR_HEADER,
  UNAUTHENTICATED_ACTOR_CODE,
  UnauthenticatedActorError,
  assertAuthenticatedActor,
} from './require-actor';

/**
 * These pin the second gate behind the middleware matcher.
 *
 * Each one is written so it FAILS if the guard is removed: delete the `if
 * (!actor) throw` in `assertAuthenticatedActor` and the four refusal cases below
 * stop throwing and start returning `undefined`.
 */

function bag(values: Record<string, string>) {
  return {
    get(name: string): string | null {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

test('an authenticated request resolves the middleware-issued actor', () => {
  assert.equal(assertAuthenticatedActor(bag({ [ACTOR_HEADER]: 'griff843' })), 'griff843');
});

test('a request that never reached the middleware is refused', () => {
  // This is the bypass the matcher used to allow: no actor header at all.
  assert.throws(
    () => assertAuthenticatedActor(bag({})),
    (error: unknown) => {
      assert.ok(error instanceof UnauthenticatedActorError);
      assert.equal(error.code, UNAUTHENTICATED_ACTOR_CODE);
      return true;
    },
  );
});

test('an empty actor header is refused, not treated as an identity', () => {
  assert.throws(
    () => assertAuthenticatedActor(bag({ [ACTOR_HEADER]: '' })),
    UnauthenticatedActorError,
  );
});

test('a whitespace-only actor header is refused', () => {
  assert.throws(
    () => assertAuthenticatedActor(bag({ [ACTOR_HEADER]: '   ' })),
    UnauthenticatedActorError,
  );
});

test('a header bag returning undefined is refused', () => {
  assert.throws(
    () => assertAuthenticatedActor({ get: () => undefined }),
    UnauthenticatedActorError,
  );
});

test('the resolved actor is trimmed', () => {
  assert.equal(assertAuthenticatedActor(bag({ [ACTOR_HEADER]: '  griff843  ' })), 'griff843');
});
