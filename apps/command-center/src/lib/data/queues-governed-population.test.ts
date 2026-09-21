import test from 'node:test';
import assert from 'node:assert/strict';
import { withRequestContext } from '../test-support/request-context';
import { withLoopbackSupabaseTarget, withWorkspaceEnvDefaults } from '../test-support/workspace-env';

/**
 * The review and held queues render `picks_current_state` through `.range()`
 * and report `count: 'exact'` as the queue total. Excluding fixtures *after*
 * that window makes the two disagree: the count describes the fixture corpus,
 * the list describes whatever survived the page. Measured on the recovery
 * preview before this guard existed, `/review` rendered
 *
 *   "Source query reported 19796 matching rows before local fixture exclusion"
 *   "0 review candidates loaded"
 *
 * — with eight genuine governed picks in production the whole time. An
 * operator cannot distinguish that from a cleared queue, which is precisely
 * the "truncated sample presented as truth" class this lane exists to remove.
 *
 * So assert the partition reaches PostgREST. An in-memory filter is defence in
 * depth and is deliberately *not* what these tests accept as sufficient.
 */
const GOVERNED_FIXTURE_KEYS = ['testRun', 'proof_issue', 'proof_fixture_id', 'proof_script', 'test_key'];

async function captureQueueRequest(
  load: (queues: typeof import('./queues')) => Promise<unknown>,
): Promise<URL> {
  const restoreDefaults = withWorkspaceEnvDefaults();
  const restoreTarget = withLoopbackSupabaseTarget();
  const previousToken = process.env.COMMAND_CENTER_AUTH_TOKEN;
  process.env.COMMAND_CENTER_AUTH_TOKEN = 'queues-governed-population-test';
  const originalFetch = globalThis.fetch;
  const seen: URL[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    seen.push(new URL(request.url));
    return new Response('[]', {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-range': '0-0/0' },
    });
  };
  try {
    await withRequestContext(
      { authorization: 'Bearer queues-governed-population-test' },
      async () => load(await import('./queues')),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previousToken === undefined) delete process.env.COMMAND_CENTER_AUTH_TOKEN;
    else process.env.COMMAND_CENTER_AUTH_TOKEN = previousToken;
    restoreTarget();
    restoreDefaults();
  }
  const queueRequest = seen.find((url) => url.pathname.endsWith('/picks_current_state'));
  assert.ok(queueRequest, `no picks_current_state read was issued (saw: ${seen.map((u) => u.pathname).join(', ') || 'nothing'})`);
  return queueRequest;
}

function assertGovernedPartitionInQuery(url: URL, label: string) {
  const params = url.searchParams;
  assert.equal(
    params.get('metadata->distributionMode'),
    'not.is.null',
    `${label}: the governed cohort predicate must be in the query, not applied to the page`,
  );
  for (const key of GOVERNED_FIXTURE_KEYS) {
    assert.equal(
      params.get(`metadata->>${key}`),
      'is.null',
      `${label}: fixture marker '${key}' must be excluded by the query`,
    );
  }
  assert.ok(
    params.getAll('or').includes('(selection.is.null,selection.not.ilike.*proof*)'),
    `${label}: proof-named selections must be excluded by the query`,
  );
}

test('the review queue partitions governed rows in the query, so its exact count describes what is rendered', async () => {
  const url = await captureQueueRequest((queues) => queues.getReviewQueue({}));
  assertGovernedPartitionInQuery(url, 'getReviewQueue');
  assert.match(
    url.searchParams.get('select') ?? '',
    /metadata/,
    'getReviewQueue must still select metadata for the in-memory belt-and-braces filter',
  );
});

test('the held queue partitions governed rows in the query', async () => {
  const url = await captureQueueRequest((queues) => queues.getHeldQueue({}));
  assertGovernedPartitionInQuery(url, 'getHeldQueue');
  assert.equal(url.searchParams.get('review_decision'), 'eq.hold', 'the held queue must stay scoped to held picks');
});
