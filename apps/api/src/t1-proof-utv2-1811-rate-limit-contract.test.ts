import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiServer, type ApiRateLimitStore } from './server.js';
import { createInMemoryRepositoryBundle } from './persistence.js';
// ─────────────────────────────────────────────────────────────────────────────
// UTV2-1811 — the submission path's behaviour when the shared rate limit store's
// backing function is absent, and when it is present.
//
// These are HTTP-level, not store-level. The pre-existing store tests above prove
// SupabaseRpcApiRateLimitStore rejects on an RPC error; what was never covered is what
// that rejection does to a real request, which is the thing that actually broke: the
// throw happens in handleSubmissions BEFORE handleSubmitPick, so an absent function is a
// total submission outage with no row written, not a rate-limiting problem at all.
//
// What these tests do NOT prove: that any database contains the function, or that the SQL
// is correct. A test double cannot prove either — supplying a working fake is precisely
// how the original defect stayed invisible. Those are proven against real PostgreSQL in
// this lane's proof bundle; the split is deliberate.
// ─────────────────────────────────────────────────────────────────────────────

/** Rejects exactly as SupabaseRpcApiRateLimitStore does when PostgREST reports the function is absent. */
function createMissingFunctionRateLimitStore(): ApiRateLimitStore {
  return {
    kind: 'supabase_rpc',
    async consume() {
      throw new Error(
        'Shared rate limit store unavailable: Could not find the function public.consume_rate_limit_bucket(p_key, p_limit, p_window_expires_at, p_window_start) in the schema cache',
      );
    },
  };
}

/**
 * Mirrors the migration's semantics: increment per call, exceeded at count > limit,
 * remaining clamped at zero, window keyed by the floored window start.
 */
function createGovernedRateLimitStore(): ApiRateLimitStore {
  const buckets = new Map<string, number>();
  return {
    kind: 'supabase_rpc',
    async consume(key, limit, now) {
      const windowStart = Math.floor(now / limit.windowMs) * limit.windowMs;
      const bucketKey = `${key}:${windowStart}`;
      const count = (buckets.get(bucketKey) ?? 0) + 1;
      buckets.set(bucketKey, count);
      return {
        exceeded: count > limit.maxRequests,
        limit: limit.maxRequests,
        remaining: Math.max(limit.maxRequests - count, 0),
        resetAt: windowStart + limit.windowMs,
      };
    },
  };
}

// `selection` varies per call so each request is a distinct submission. Identical bodies
// deduplicate on the idempotency key, which would make "two requests, one pick" look like
// a limiter defect when it is the idempotency contract working correctly.
async function postSubmission(port: number, selection = 'Player Over 18.5') {
  return fetch(`http://127.0.0.1:${port}/api/submissions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: 'api',
      market: 'NBA points',
      selection,
      stakeUnits: 1,
    }),
  });
}

test('a submission fails and persists nothing when the rate limit function is absent', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const server = createApiServer({
    repositories,
    rateLimitStore: createMissingFunctionRateLimitStore(),
  });

  server.listen(0);
  await once(server, 'listening');
  const address = server.address() as AddressInfo;

  try {
    const response = await postSubmission(address.port);

    // Not 429. The request never reached a rate-limiting decision — the store threw while
    // being asked. Conflating the two is what made the production failure look like
    // throttling in the UI.
    assert.notEqual(response.status, 429);
    assert.ok(response.status >= 500, `expected a server-side failure, got ${response.status}`);

    // The whole point: no pick exists. handleSubmitPick was never called.
    const picks = await repositories.picks.listByLifecycleState('validated', 10);
    assert.equal(picks.length, 0, 'a failed rate-limit lookup must not create a pick');
  } finally {
    server.close();
  }
});

test('a submission proceeds past the limiter, and the over-limit request is 429 rather than 500', async () => {
  const previousMax = process.env.UNIT_TALK_API_SUBMISSION_RATE_LIMIT_MAX;
  process.env.UNIT_TALK_API_SUBMISSION_RATE_LIMIT_MAX = '2';

  const repositories = createInMemoryRepositoryBundle();
  const server = createApiServer({
    repositories,
    rateLimitStore: createGovernedRateLimitStore(),
  });

  server.listen(0);
  await once(server, 'listening');
  const address = server.address() as AddressInfo;

  try {
    const first = await postSubmission(address.port, 'Player Over 18.5');
    const second = await postSubmission(address.port, 'Player Over 19.5');
    const third = await postSubmission(address.port, 'Player Over 20.5');

    // Requests 1..N reach handleSubmitPick and create picks.
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);

    // Request N+1 is refused BY the limiter, with the limiter's own status and code —
    // not by an exception from the limiter, which is what a 500 here would mean.
    assert.equal(third.status, 429);
    const body = (await third.json()) as { ok: boolean; error?: { code?: string } };
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, 'RATE_LIMIT_EXCEEDED');

    // Exactly the allowed requests persisted: the refusal is a refusal, not a silent write.
    const picks = await repositories.picks.listByLifecycleState('validated', 10);
    assert.equal(picks.length, 2);
  } finally {
    server.close();
    if (previousMax === undefined) {
      delete process.env.UNIT_TALK_API_SUBMISSION_RATE_LIMIT_MAX;
    } else {
      process.env.UNIT_TALK_API_SUBMISSION_RATE_LIMIT_MAX = previousMax;
    }
  }
});
