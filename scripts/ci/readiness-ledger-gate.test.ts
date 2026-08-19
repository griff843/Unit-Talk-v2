import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertRefreshAdvanced,
  evaluateLedger,
  evaluateReadinessRegression,
  parseLedger,
  type GateCode,
} from './readiness-ledger-gate.js';
import type { ReadinessDimension, ReadinessLedger } from '../ops/readiness-refresh.js';

const NOW = new Date('2026-07-30T12:00:00.000Z');

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

function dimension(overrides: Partial<ReadinessDimension> = {}): ReadinessDimension {
  return {
    id: 'ingestor_health',
    title: 'ingestor',
    blocking: true,
    status: 'pass',
    observed_at: hoursAgo(1),
    method: { kind: 'supabase_read', source: 'supabase:prod', query: 'system_runs' },
    evidence: 'measured',
    measured: {},
    unreadable_reason: null,
    ...overrides,
  };
}

function ledger(overrides: Partial<ReadinessLedger> = {}): ReadinessLedger {
  return {
    schema_version: 2,
    generated_at: hoursAgo(1),
    observation_window: { started_at: hoursAgo(1), completed_at: hoursAgo(1) },
    generator: { script: 'scripts/ops/readiness-refresh.ts', generator_version: '1.0.0', git_head_sha: null, run_url: null },
    freshness: { max_age_hours: 24, hard_stale_hours: 48 },
    target: {
      supabase_project_ref: 'zfzdnfwdarxucxtaojxm',
      expected_production_project_ref: 'zfzdnfwdarxucxtaojxm',
      production_target_confirmed: true,
    },
    main_sha: null,
    deployed_sha: null,
    verdict: 'GREEN',
    observability: 'complete',
    dimensions: [dimension()],
    blockers: [],
    unreadable: [],
    open_gap_count: 0,
    queue_semantics_version: '1.0',
    queue_semantics_doc: 'docs/05_operations/QUEUE_READINESS_SEMANTICS.md',
    ...overrides,
  };
}

function codeOf(input: ReadinessLedger): GateCode {
  return evaluateLedger(input, NOW).code;
}

// ── The distinction the old gate could not make ──────────────────────────────

test('a stale ledger reports LEDGER_STALE, not READINESS_RED, even when its verdict is RED', () => {
  const result = evaluateLedger(
    ledger({
      generated_at: hoursAgo(351),
      verdict: 'RED',
      dimensions: [dimension({ status: 'fail', observed_at: hoursAgo(351) })],
      blockers: ['ingestor_health'],
    }),
    NOW,
  );
  assert.equal(result.code, 'LEDGER_STALE');
  assert.equal(result.observer_failure, true);
  assert.equal(result.passed, false);
  assert.match(result.summary, /OBSERVER failure/);
});

test('a current measured failure reports READINESS_RED and is not an observer failure', () => {
  const result = evaluateLedger(
    ledger({
      verdict: 'RED',
      dimensions: [dimension({ status: 'fail' })],
      blockers: ['ingestor_health'],
    }),
    NOW,
  );
  assert.equal(result.code, 'READINESS_RED');
  assert.equal(result.observer_failure, false);
  assert.equal(result.passed, false);
});

test('a fresh file with a stale blocking dimension is caught as DIMENSION_STALE', () => {
  const result = evaluateLedger(
    ledger({
      generated_at: hoursAgo(1),
      dimensions: [dimension({ status: 'pass', observed_at: hoursAgo(300) })],
    }),
    NOW,
  );
  assert.equal(result.code, 'DIMENSION_STALE');
  assert.equal(result.observer_failure, true);
});

test('a blocking dimension with no observation timestamp cannot pass', () => {
  assert.equal(
    codeOf(ledger({ dimensions: [dimension({ status: 'pass', observed_at: null })] })),
    'DIMENSION_STALE',
  );
});

test('an unreadable blocking dimension reports OBSERVER_DEGRADED, distinct from RED', () => {
  const result = evaluateLedger(
    ledger({
      verdict: 'UNKNOWN',
      observability: 'degraded',
      dimensions: [dimension({ status: 'unknown', unreadable_reason: 'no credential' })],
    }),
    NOW,
  );
  assert.equal(result.code, 'OBSERVER_DEGRADED');
  assert.equal(result.observer_failure, true);
  assert.equal(result.passed, false);
  assert.match(result.summary, /never scored as passing/);
});

test('a measured failure is reported even when another dimension is unreadable', () => {
  const result = evaluateLedger(
    ledger({
      dimensions: [dimension({ id: 'a', status: 'fail' }), dimension({ id: 'b', status: 'unknown' })],
    }),
    NOW,
  );
  assert.equal(result.code, 'READINESS_RED');
  assert.ok(result.details.some((detail) => detail.includes('also unreadable: b')));
});

test('all-pass is GREEN and non-blocking gaps are YELLOW, both passing', () => {
  assert.equal(codeOf(ledger()), 'GREEN');
  const yellow = evaluateLedger(
    ledger({
      verdict: 'YELLOW',
      dimensions: [dimension(), dimension({ id: 'proof_coverage', blocking: false, status: 'fail' })],
    }),
    NOW,
  );
  assert.equal(yellow.code, 'READINESS_YELLOW');
  assert.equal(yellow.passed, true);
});

test('a ledger that is not usable is refused rather than partially trusted', () => {
  assert.equal(parseLedger('not json').ledger, null);
  assert.equal(parseLedger('[]').ledger, null);
  assert.deepEqual(parseLedger('{"verdict":"GREEN"}').errors.length > 0, true);
});

test('the hard-stale threshold comes from the ledger itself, so the contract travels with the artifact', () => {
  const strict = ledger({ generated_at: hoursAgo(10), freshness: { max_age_hours: 4, hard_stale_hours: 6 } });
  assert.equal(codeOf(strict), 'LEDGER_STALE');
});

test('PR readiness is neutral when head inherits the same failing classification from base', () => {
  const inherited = evaluateLedger(
    ledger({ verdict: 'RED', dimensions: [dimension({ status: 'fail' })] }),
    NOW,
  );
  const result = evaluateReadinessRegression(inherited, inherited);
  assert.equal(result.conclusion, 'neutral');
  assert.equal(result.passed, true);
  assert.match(result.summary, /inherits repository readiness debt/);
});

test('PR readiness fails when a passing base becomes failing on head', () => {
  const base = evaluateLedger(ledger(), NOW);
  const head = evaluateLedger(
    ledger({ verdict: 'RED', dimensions: [dimension({ status: 'fail' })] }),
    NOW,
  );
  const result = evaluateReadinessRegression(base, head);
  assert.equal(result.conclusion, 'failure');
  assert.equal(result.passed, false);
  assert.match(result.summary, /GREEN to READINESS_RED/);
});

test('PR readiness fails closed when head changes to a different failing classification', () => {
  const base = evaluateLedger(
    ledger({ verdict: 'RED', dimensions: [dimension({ status: 'fail' })] }),
    NOW,
  );
  const head = evaluateLedger(
    ledger({ verdict: 'UNKNOWN', dimensions: [dimension({ status: 'unknown' })] }),
    NOW,
  );
  const result = evaluateReadinessRegression(base, head);
  assert.equal(result.conclusion, 'failure');
  assert.equal(result.passed, false);
});

test('PR readiness fails when head adds a blocking failure under the same RED classification', () => {
  const base = evaluateLedger(
    ledger({ verdict: 'RED', dimensions: [dimension({ id: 'ingestor', status: 'fail' })] }),
    NOW,
  );
  const head = evaluateLedger(
    ledger({
      verdict: 'RED',
      dimensions: [
        dimension({ id: 'ingestor', status: 'fail' }),
        dimension({ id: 'worker', status: 'fail' }),
      ],
    }),
    NOW,
  );
  const result = evaluateReadinessRegression(base, head);
  assert.equal(result.conclusion, 'failure');
  assert.equal(result.passed, false);
});

test('PR readiness succeeds when head readiness passes', () => {
  const result = evaluateReadinessRegression(
    evaluateLedger(ledger(), NOW),
    evaluateLedger(ledger({ verdict: 'YELLOW' }), NOW),
  );
  assert.equal(result.conclusion, 'success');
  assert.equal(result.passed, true);
});

// ── Persistence: a scheduled run cannot conclude success without a new observation

test('a byte-identical ledger fails persistence — the generator did not publish', () => {
  const raw = JSON.stringify(ledger());
  const result = assertRefreshAdvanced(raw, raw, new Date(NOW.getTime() - 3_600_000));
  assert.equal(result.code, 'NOT_REWRITTEN');
  assert.equal(result.passed, false);
});

test('a missing output file fails persistence', () => {
  const result = assertRefreshAdvanced(JSON.stringify(ledger()), null, NOW);
  assert.equal(result.code, 'NOT_WRITTEN');
});

test('a ledger whose generated_at did not advance fails persistence', () => {
  const previous = ledger({ generated_at: hoursAgo(2) });
  const next = ledger({ generated_at: hoursAgo(3), dimensions: [dimension({ observed_at: hoursAgo(3) })] });
  const result = assertRefreshAdvanced(JSON.stringify(previous), JSON.stringify(next), new Date(NOW.getTime() - 4 * 3_600_000));
  assert.equal(result.code, 'TIMESTAMP_NOT_ADVANCED');
});

test('a dimension carried forward from an earlier run fails persistence even when the file changed', () => {
  const runStart = new Date(NOW.getTime() - 600_000);
  const previous = ledger({ generated_at: hoursAgo(6) });
  const next = ledger({
    generated_at: NOW.toISOString(),
    dimensions: [
      dimension({ id: 'fresh', observed_at: NOW.toISOString() }),
      dimension({ id: 'carried', observed_at: hoursAgo(300) }),
    ],
  });
  const result = assertRefreshAdvanced(JSON.stringify(previous), JSON.stringify(next), runStart);
  assert.equal(result.code, 'OBSERVATION_NOT_CURRENT');
  assert.match(result.summary, /carried@/);
});

test('a genuinely new observation passes persistence, including an unchanged verdict', () => {
  const runStart = new Date(NOW.getTime() - 600_000);
  const previous = ledger({ verdict: 'RED', generated_at: hoursAgo(6) });
  const next = ledger({
    verdict: 'RED',
    generated_at: NOW.toISOString(),
    dimensions: [dimension({ status: 'fail', observed_at: NOW.toISOString() })],
  });
  const result = assertRefreshAdvanced(JSON.stringify(previous), JSON.stringify(next), runStart);
  assert.equal(result.code, 'OK');
  assert.equal(result.passed, true);
});

test('an empty ledger cannot satisfy persistence', () => {
  const result = assertRefreshAdvanced(null, JSON.stringify(ledger({ dimensions: [] })), new Date(0));
  assert.equal(result.code, 'OBSERVATION_NOT_CURRENT');
});
