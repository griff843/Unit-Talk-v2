import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CANONICAL_LEDGER_PATH,
  collectLedger,
  computeObservability,
  computeVerdict,
  measureProofCoverage,
  probeConstitutionConvergence,
  probeDbTripwires,
  probeDeadLetterCount,
  probeDeploySha,
  probeIngestorHealth,
  probeWorkerOutboxHealth,
  resolveProductionDb,
  wrapReadOnlyClient,
  type DbFilter,
  type GithubReader,
  type ProbeContext,
  type ReadinessDimension,
  type ReadOnlyDb,
  type WorkflowRun,
} from './readiness-refresh.js';

const NOW = new Date('2026-07-30T12:00:00.000Z');

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function dimension(overrides: Partial<ReadinessDimension>): ReadinessDimension {
  return {
    id: 'x',
    title: 'x',
    blocking: true,
    status: 'pass',
    observed_at: NOW.toISOString(),
    method: { kind: 'repo_scan', source: 'test', query: 'test' },
    evidence: 'test',
    measured: null,
    unreadable_reason: null,
    ...overrides,
  };
}

function stubDb(handlers: {
  rows?: Record<string, Record<string, unknown> | null>;
  counts?: Record<string, number>;
  throwOn?: string;
}): ReadOnlyDb {
  const key = (table: string, filters: DbFilter[]) =>
    `${table}|${filters.map((f) => `${f.column}${f.op}${f.value}`).join(',')}`;
  return {
    projectRef: 'zfzdnfwdarxucxtaojxm',
    async latestRow(table, _columns, filters) {
      if (handlers.throwOn === table) throw new Error(`${table} exploded`);
      const rows = handlers.rows ?? {};
      return rows[key(table, filters)] ?? rows[table] ?? null;
    },
    async countRows(table, filters) {
      if (handlers.throwOn === table) throw new Error(`${table} exploded`);
      const counts = handlers.counts ?? {};
      const exact = counts[key(table, filters)];
      return exact ?? 0;
    },
  };
}

function stubGithub(overrides: Partial<GithubReader> = {}): GithubReader {
  return {
    repo: 'unit-talk/v2',
    async headSha() {
      return 'a'.repeat(40);
    },
    async latestRun() {
      return null;
    },
    async commitsBetween() {
      return null;
    },
    async failedSteps() {
      return [];
    },
    ...overrides,
  };
}

function context(overrides: Partial<ProbeContext> = {}): ProbeContext {
  return {
    now: NOW,
    db: null,
    dbUnavailableReason: 'no db in this test',
    github: null,
    githubUnavailableReason: 'no github in this test',
    repoRoot: process.cwd(),
    ...overrides,
  };
}

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 1,
    head_sha: 'b'.repeat(40),
    status: 'completed',
    conclusion: 'success',
    created_at: minutesAgo(60),
    updated_at: minutesAgo(30),
    html_url: 'https://github.com/unit-talk/v2/actions/runs/1',
    ...overrides,
  };
}

// ── Fail-closed scoring ──────────────────────────────────────────────────────

test('an unreadable blocking dimension is never scored as passing', () => {
  const dimensions = [
    dimension({ id: 'a', status: 'pass' }),
    dimension({ id: 'b', status: 'unknown' }),
  ];
  assert.equal(computeVerdict(dimensions), 'UNKNOWN');
  assert.notEqual(computeVerdict(dimensions), 'GREEN');
  assert.equal(computeObservability(dimensions), 'degraded');
});

test('a measured failure outranks an unreadable dimension — RED is still RED', () => {
  assert.equal(
    computeVerdict([dimension({ id: 'a', status: 'fail' }), dimension({ id: 'b', status: 'unknown' })]),
    'RED',
  );
});

test('a non-blocking gap yields YELLOW, not GREEN', () => {
  assert.equal(
    computeVerdict([dimension({ status: 'pass' }), dimension({ blocking: false, status: 'fail' })]),
    'YELLOW',
  );
});

test('GREEN requires every dimension measured and passing', () => {
  assert.equal(computeVerdict([dimension({}), dimension({ blocking: false })]), 'GREEN');
  assert.equal(computeObservability([dimension({}), dimension({ blocking: false })]), 'complete');
});

// ── Probes record how and when, and degrade to unknown ───────────────────────

test('a probe whose reader is missing records unknown with the reason, not a default', async () => {
  const result = await probeIngestorHealth(context());
  assert.equal(result.status, 'unknown');
  assert.equal(result.observed_at, NOW.toISOString());
  assert.match(result.unreadable_reason ?? '', /no db in this test/);
  assert.equal(result.measured, null);
});

test('a probe whose read throws records unknown, never pass', async () => {
  const result = await probeIngestorHealth(
    context({ db: stubDb({ throwOn: 'system_runs' }), dbUnavailableReason: null }),
  );
  assert.equal(result.status, 'unknown');
  assert.match(result.unreadable_reason ?? '', /system_runs exploded/);
});

test('ingestor health passes only when the cycle and merged offers are both current', async () => {
  const healthy = await probeIngestorHealth(
    context({
      dbUnavailableReason: null,
      db: stubDb({
        rows: {
          system_runs: { status: 'success', started_at: minutesAgo(3) },
          provider_cycle_status: { updated_at: minutesAgo(4) },
          game_results: { created_at: minutesAgo(20) },
        },
      }),
    }),
  );
  assert.equal(healthy.status, 'pass');
  assert.equal(healthy.method.kind, 'supabase_read');
  assert.equal(healthy.measured?.['latest_cycle_age_minutes'], 3);

  const stale = await probeIngestorHealth(
    context({
      dbUnavailableReason: null,
      db: stubDb({
        rows: {
          system_runs: { status: 'failed', started_at: minutesAgo(20_000) },
          provider_cycle_status: { updated_at: minutesAgo(20_000) },
          game_results: { created_at: minutesAgo(30_000) },
        },
      }),
    }),
  );
  assert.equal(stale.status, 'fail');
  assert.match(stale.evidence, /threshold 30m/);
});

test('dead-letter classification separates governance holds from true delivery failures', async () => {
  const db = stubDb({
    counts: {
      'distribution_outbox|statuseqdead_letter': 1948,
      'distribution_outbox|statuseqdead_letter,attempt_counteq0': 1947,
      'distribution_outbox|statuseqdead_letter,attempt_countgt0': 1,
    },
  });
  const result = await probeDeadLetterCount(context({ db, dbUnavailableReason: null }));
  assert.equal(result.status, 'fail');
  assert.equal(result.measured?.['governance_hold_count'], 1947);
  assert.equal(result.measured?.['true_failure_count'], 1);

  const clean = await probeDeadLetterCount(
    context({
      dbUnavailableReason: null,
      db: stubDb({
        counts: {
          'distribution_outbox|statuseqdead_letter': 946,
          'distribution_outbox|statuseqdead_letter,attempt_counteq0': 946,
          'distribution_outbox|statuseqdead_letter,attempt_countgt0': 0,
        },
      }),
    }),
  );
  assert.equal(clean.status, 'pass', '946 governance holds alone must not fail readiness');
});

test('worker/outbox health fails on a stale heartbeat even with an empty queue', async () => {
  const result = await probeWorkerOutboxHealth(
    context({
      dbUnavailableReason: null,
      db: stubDb({ rows: { system_runs: { status: 'success', started_at: minutesAgo(400) } } }),
    }),
  );
  assert.equal(result.status, 'fail');
  assert.match(result.evidence, /worker\.heartbeat/);
});

test('deploy alignment compares the deployed SHA to main HEAD', async () => {
  const aligned = await probeDeploySha(
    context({
      githubUnavailableReason: null,
      github: stubGithub({
        async headSha() {
          return 'c'.repeat(40);
        },
        async latestRun() {
          return run({ head_sha: 'c'.repeat(40) });
        },
      }),
    }),
  );
  assert.equal(aligned.status, 'pass');

  const drifted = await probeDeploySha(
    context({
      githubUnavailableReason: null,
      github: stubGithub({
        async latestRun() {
          return run({ head_sha: 'd'.repeat(40) });
        },
        async commitsBetween() {
          return 285;
        },
      }),
    }),
  );
  assert.equal(drifted.status, 'fail');
  assert.match(drifted.evidence, /285 commits ahead/);
});

test('a tripwire observer that could not run is unknown, never a passing dimension', async () => {
  const result = await probeDbTripwires(
    context({
      githubUnavailableReason: null,
      github: stubGithub({
        async latestRun() {
          return run({ conclusion: 'failure' });
        },
        async failedSteps() {
          return ['Select live DB connection URL (prefer pooler)'];
        },
      }),
    }),
  );
  assert.equal(result.status, 'unknown');
  assert.match(result.unreadable_reason ?? '', /Select live DB connection URL/);
});

test('a red tripwire observer records the failed steps and stays unknown', async () => {
  const result = await probeDbTripwires(
    context({
      githubUnavailableReason: null,
      github: stubGithub({
        async latestRun() {
          return run({ conclusion: 'failure' });
        },
        // Reads like a fired tripwire; the real run behind this case exited 127
        // before executing a single check. Neither reading is provable from here.
        async failedSteps() {
          return ['Run DB health checks'];
        },
      }),
    }),
  );
  assert.equal(result.status, 'unknown');
  assert.match(result.unreadable_reason ?? '', /Run DB health checks/);
  assert.match(result.unreadable_reason ?? '', /cannot distinguish/);
});

test('a tripwire observer that has not run recently cannot prove anything', async () => {
  const result = await probeDbTripwires(
    context({
      githubUnavailableReason: null,
      github: stubGithub({
        async latestRun() {
          return run({ conclusion: 'success', updated_at: minutesAgo(60 * 40) });
        },
      }),
    }),
  );
  assert.equal(result.status, 'unknown');
  assert.match(result.unreadable_reason ?? '', /not current/);
});

test('constitutional convergence is recorded unknown rather than reproducing a hand-entered number', async () => {
  const result = await probeConstitutionConvergence(context());
  assert.equal(result.status, 'unknown');
  assert.equal(result.method.kind, 'not_measurable');
  assert.match(result.unreadable_reason ?? '', /no generator/);
});

// ── Ledger assembly ──────────────────────────────────────────────────────────

test('a ledger with no readers at all is UNKNOWN and degraded, never GREEN', async () => {
  const ledger = await collectLedger(context(), { gitHeadSha: 'e'.repeat(40), runUrl: null });
  assert.equal(ledger.verdict, 'UNKNOWN');
  assert.equal(ledger.observability, 'degraded');
  assert.equal(ledger.target.production_target_confirmed, false);
  assert.ok(ledger.unreadable.length > 0);
  for (const entry of ledger.dimensions) {
    assert.ok(entry.observed_at, `${entry.id} must record when it was observed`);
    assert.ok(entry.method.query.length > 0, `${entry.id} must record how it was measured`);
  }
});

test('the ledger carries a per-run generator receipt and freshness contract', async () => {
  const ledger = await collectLedger(context(), { gitHeadSha: 'f'.repeat(40), runUrl: 'https://run' });
  assert.equal(ledger.generator.git_head_sha, 'f'.repeat(40));
  assert.equal(ledger.generator.run_url, 'https://run');
  assert.equal(ledger.freshness.max_age_hours, 24);
  assert.equal(ledger.freshness.hard_stale_hours, 48);
  assert.ok(new Date(ledger.observation_window.started_at).getTime() <= new Date(ledger.generated_at).getTime());
});

// ── Production targeting ─────────────────────────────────────────────────────

test('a staging or unidentified database target yields no handle, so nothing is measured against it', () => {
  assert.equal(resolveProductionDb({}).db, null);
  assert.match(resolveProductionDb({}).reason ?? '', /not present/);

  const staging = resolveProductionDb({
    SUPABASE_URL: 'https://xskgrzbteyqdufktjrjx.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'not-a-real-key',
  });
  assert.equal(staging.db, null);
  assert.match(staging.reason ?? '', /not canonical production/);

  const custom = resolveProductionDb({
    SUPABASE_URL: 'https://db.internal.example.com',
    SUPABASE_SERVICE_ROLE_KEY: 'not-a-real-key',
  });
  assert.equal(custom.db, null);
});

// ── Read-only guarantee ──────────────────────────────────────────────────────

test('the generator source contains no database mutation path', () => {
  const source = fs.readFileSync(new URL('./readiness-refresh.ts', import.meta.url), 'utf8');
  for (const mutation of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
    assert.equal(
      source.includes(mutation),
      false,
      `readiness-refresh.ts must stay read-only against production; found ${mutation}`,
    );
  }
});

test('the read-only wrapper issues select reads and surfaces errors instead of returning empties', async () => {
  const calls: string[] = [];
  const builder = {
    eq(column: string, value: string | number) {
      calls.push(`eq:${column}=${value}`);
      return builder;
    },
    neq() {
      return builder;
    },
    gt(column: string, value: string | number) {
      calls.push(`gt:${column}=${value}`);
      return builder;
    },
    gte() {
      return builder;
    },
    lt() {
      return builder;
    },
    order(column: string) {
      calls.push(`order:${column}`);
      return builder;
    },
    limit(count: number) {
      calls.push(`limit:${count}`);
      return builder;
    },
    then<R>(resolve: (value: { data: Record<string, unknown>[] | null; error: null; count: number }) => R): R {
      return resolve({ data: [{ started_at: 'now' }], error: null, count: 7 });
    },
  };
  const client = {
    from(table: string) {
      calls.push(`from:${table}`);
      return {
        select(columns: string) {
          calls.push(`select:${columns}`);
          return builder;
        },
      };
    },
  };

  const db = wrapReadOnlyClient(client as never, 'zfzdnfwdarxucxtaojxm');
  const row = await db.latestRow('system_runs', 'started_at', [{ column: 'run_type', op: 'eq', value: 'x' }], 'started_at');
  assert.deepEqual(row, { started_at: 'now' });
  assert.deepEqual(calls, ['from:system_runs', 'select:started_at', 'eq:run_type=x', 'order:started_at', 'limit:1']);

  const failing = {
    from() {
      return {
        select() {
          return {
            eq() {
              return this;
            },
            order() {
              return this;
            },
            limit() {
              return this;
            },
            then<R>(resolve: (value: { data: null; error: { message: string } }) => R): R {
              return resolve({ data: null, error: { message: 'permission denied' } });
            },
          };
        },
      };
    },
  };
  await assert.rejects(
    () => wrapReadOnlyClient(failing as never, 'zfzdnfwdarxucxtaojxm').latestRow('picks', 'id', [], 'id'),
    /permission denied/,
  );
});

// ── Repo-scanned dimension ───────────────────────────────────────────────────

test('proof coverage counts only lanes closed inside the window and needs a merge SHA', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1626-'));
  const lanes = path.join(root, 'docs', '06_status', 'lanes');
  fs.mkdirSync(lanes, { recursive: true });
  const write = (id: string, status: string, closedAt: string) =>
    fs.writeFileSync(
      path.join(lanes, `${id}.json`),
      JSON.stringify({ issue_id: id, status, closed_at: closedAt }),
    );

  write('UTV2-1', 'done', minutesAgo(60));
  write('UTV2-2', 'done', minutesAgo(60));
  write('UTV2-3', 'done', new Date(NOW.getTime() - 90 * 86_400_000).toISOString());
  write('UTV2-4', 'in_progress', minutesAgo(60));

  const proofDir = path.join(root, 'docs', '06_status', 'proof', 'UTV2-1');
  fs.mkdirSync(proofDir, { recursive: true });
  fs.writeFileSync(path.join(proofDir, 'verification.md'), '## Verification\nMerge SHA: 1234567890abcdef\n');

  const coverage = measureProofCoverage(root, NOW);
  assert.deepEqual(coverage.considered.sort(), ['UTV2-1', 'UTV2-2']);
  assert.deepEqual(coverage.bound, ['UTV2-1']);
  assert.deepEqual(coverage.unbound, ['UTV2-2']);
});

test('the canonical ledger path is the one the gate reads', () => {
  assert.equal(CANONICAL_LEDGER_PATH, 'docs/06_status/readiness/readiness-score.json');
});
