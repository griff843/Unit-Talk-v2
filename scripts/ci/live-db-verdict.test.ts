import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyLiveDbOutcome, verdictExitCode } from './live-db-verdict.js';

/*
 * UTV2-1292 — live-DB verdict classifier.
 *
 * Distinguishes a real CODE failure from transient Supabase INFRASTRUCTURE
 * unavailability (the UTV2-1290 write-path degradation: schema-cache errors,
 * statement timeouts, 520/521). Deterministic, offline — no live DB.
 */

test('UTV2-1292: exit 0 → passed', () => {
  const r = classifyLiveDbOutcome({ exitCode: 0, output: '# tests 7\n# pass 7\n# fail 0\n' });
  assert.equal(r.verdict, 'passed');
  assert.equal(verdictExitCode(r.verdict), 0);
});

test('UTV2-1292: schema-cache error → infra_unavailable (not code_failed)', () => {
  const out = "not ok 3 - ...\n  error: 'Failed to record audit log: Could not query the database for the schema cache. Retrying.'\n# fail 1";
  const r = classifyLiveDbOutcome({ exitCode: 1, output: out });
  assert.equal(r.verdict, 'infra_unavailable');
  assert.equal(verdictExitCode(r.verdict), 0, 'infra_unavailable is not a hard classifier failure; tier policy decides blocking');
});

test('UTV2-1292: statement timeout → infra_unavailable', () => {
  const out = 'not ok 1 - execution_intents insert\n  error: canceling statement due to statement timeout\n# fail 1';
  assert.equal(classifyLiveDbOutcome({ exitCode: 1, output: out }).verdict, 'infra_unavailable');
});

test('UTV2-1292: HTTP 520/521 → infra_unavailable', () => {
  assert.equal(
    classifyLiveDbOutcome({ exitCode: 1, output: 'Error: supabase.co returned HTTP 520 Web server error' }).verdict,
    'infra_unavailable',
  );
  assert.equal(
    classifyLiveDbOutcome({ exitCode: 1, output: 'request failed: 521 web server is down' }).verdict,
    'infra_unavailable',
  );
});

test('UTV2-1292: connection terminated / fetch failed → infra_unavailable', () => {
  assert.equal(
    classifyLiveDbOutcome({ exitCode: 1, output: 'Connection terminated due to connection timeout' }).verdict,
    'infra_unavailable',
  );
  assert.equal(
    classifyLiveDbOutcome({ exitCode: 1, output: 'TypeError: fetch failed' }).verdict,
    'infra_unavailable',
  );
});

test('UTV2-1292: assertion failure with no infra signature → code_failed (BLOCK)', () => {
  const out = "not ok 2 - lifecycle invariant holds\n  AssertionError [ERR_ASSERTION]: expected 'qualified' to equal 'pending'\n# fail 1";
  const r = classifyLiveDbOutcome({ exitCode: 1, output: out });
  assert.equal(r.verdict, 'code_failed');
  assert.equal(verdictExitCode(r.verdict), 1, 'code_failed is a hard failure');
});

test('UTV2-1292: missing Supabase credentials → proof_skipped', () => {
  const out = 'Skipping live proof: missing Supabase credentials (SUPABASE_SERVICE_ROLE_KEY not set)';
  assert.equal(classifyLiveDbOutcome({ exitCode: 1, output: out }).verdict, 'proof_skipped');
});

test('UTV2-1292: passed takes precedence over an infra-looking string in healthy output', () => {
  // A test name mentioning "statement timeout" must not flip a green run to infra.
  const out = 'ok 8 - evaluateIngestorHealth reports DB_TIMEOUT for statement timeout failure\n# pass 8\n# fail 0';
  assert.equal(classifyLiveDbOutcome({ exitCode: 0, output: out }).verdict, 'passed');
});
