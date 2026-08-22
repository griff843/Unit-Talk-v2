import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import {
  assessRuntimeMode,
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
  probeServiceRuntimeMode,
  probeWorkerOutboxHealth,
  parseRuntimeModeReceipt,
  resolveProductionDb,
  resolveRuntimeModeReceipt,
  RUNTIME_MODE_RECEIPT_SCHEMA,
  runtimeModeReceiptArtifactName,
  serviceRuntimeState,
  THRESHOLDS,
  wrapReadOnlyClient,
  type ArtifactFetch,
  type DbFilter,
  type GithubReader,
  type ProbeContext,
  type ReadinessDimension,
  type ReadOnlyDb,
  type RuntimeModeAssessment,
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
    async downloadRunArtifact() {
      return { text: null, reason: 'no artifact in this test' } satisfies ArtifactFetch;
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

/**
 * A hand-built assessment for probes that are exercising active-mode scoring
 * specifically. Declaring the mode is deliberate: an absent assessment means
 * "not assessed" and is scored `unknown`, never silently assumed active.
 */
function declaredMode(
  mode: 'active' | 'parked',
  state: 'active_healthy' | 'active_degraded' | 'active_failed' | 'parked_verified' | 'parked_drift',
): RuntimeModeAssessment {
  return {
    declared_mode: mode,
    receipt_source: 'https://github.com/unit-talk/v2/actions/runs/5001 (attempt 1)',
    deployed_tag: 'release-test',
    source_sha: 'a'.repeat(40),
    compose_project: 'unit-talk',
    observed_at: NOW.toISOString(),
    observation_age_hours: 0,
    services: (['api', 'ingestor', 'worker'] as const).map((service) => ({
      service,
      declared_mode: mode,
      state,
      findings: [],
      notes: [],
      unreadable_reason: null,
    })),
    signals: null,
    unreadable_reason: null,
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
      runtimeMode: declaredMode('active', 'active_healthy'),
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
      runtimeMode: declaredMode('active', 'active_failed'),
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
      runtimeMode: declaredMode('active', 'active_failed'),
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

// ── Desired runtime mode (UTV2-1667) ─────────────────────────────────────────
//
// Every control below is proved by making it FAIL on the condition it names: a
// drifted parked machine must produce a hard failure, an unprovable observation
// must produce `unreadable`, and a parked machine and a dead active machine must
// not produce the same verdict from the same database rows.

const PARKED_AT = new Date(NOW.getTime() - 6 * 3_600_000).toISOString();

function receiptBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: RUNTIME_MODE_RECEIPT_SCHEMA,
    run_id: 5001,
    run_attempt: 1,
    stage: 'promote',
    declared_mode: 'parked',
    source_sha: 'a'.repeat(40),
    deployed_tag: 'release-2026-08-01',
    compose_project: 'unit-talk',
    observed_at: PARKED_AT,
    services: [
      {
        service: 'api',
        image: 'ghcr.io/griff843/unit-talk-v2/api:release-2026-08-01',
        env: { SYNDICATE_MACHINE_ENABLED: 'false' },
      },
      {
        service: 'ingestor',
        image: 'ghcr.io/griff843/unit-talk-v2/ingestor:release-2026-08-01',
        env: { UNIT_TALK_INGESTOR_AUTORUN: 'false', UNIT_TALK_INGESTOR_SCHEDULING_ENABLED: 'false' },
      },
      {
        service: 'worker',
        image: 'ghcr.io/griff843/unit-talk-v2/worker:release-2026-08-01',
        env: { UNIT_TALK_WORKER_AUTORUN: 'false', UNIT_TALK_ENABLED_TARGETS: 'none' },
      },
    ],
    kill_switch: [
      { target: 'best-bets', killed: true },
      { target: 'trader-insights', killed: true },
    ],
    ...overrides,
  });
}

function activeReceiptBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ...(JSON.parse(receiptBody()) as Record<string, unknown>),
    declared_mode: 'active',
    services: [
      {
        service: 'api',
        image: 'ghcr.io/griff843/unit-talk-v2/api:release-2026-08-01',
        env: { SYNDICATE_MACHINE_ENABLED: 'true' },
      },
      {
        service: 'ingestor',
        image: 'ghcr.io/griff843/unit-talk-v2/ingestor:release-2026-08-01',
        env: { UNIT_TALK_INGESTOR_AUTORUN: 'true', UNIT_TALK_INGESTOR_SCHEDULING_ENABLED: 'true' },
      },
      {
        service: 'worker',
        image: 'ghcr.io/griff843/unit-talk-v2/worker:release-2026-08-01',
        env: { UNIT_TALK_WORKER_AUTORUN: 'true', UNIT_TALK_ENABLED_TARGETS: 'best-bets' },
      },
    ],
    kill_switch: [
      { target: 'best-bets', killed: false },
      { target: 'trader-insights', killed: false },
    ],
    ...overrides,
  });
}

function githubWithReceipt(body: string | null, runOverrides: Partial<WorkflowRun> = {}): GithubReader {
  return stubGithub({
    async latestRun() {
      return run({ id: 5001, run_attempt: 1, conclusion: 'success', ...runOverrides });
    },
    async downloadRunArtifact(_runId, name) {
      if (body === null || name !== runtimeModeReceiptArtifactName(5001, 1)) {
        return { text: null, reason: `no artifact named ${name}` };
      }
      return { text: body, reason: null };
    },
  });
}

/**
 * Silence everywhere: no ingestor cycle, no merged provider cycle, no worker
 * heartbeat, nothing claimed or delivered, both public kill switches engaged.
 * This is the exact database shape a correctly parked production produces — and
 * also the shape a dead active production produces. Only the declared mode
 * separates them.
 */
function silentDb(overrides: { rows?: Record<string, Record<string, unknown> | null>; counts?: Record<string, number> } = {}): ReadOnlyDb {
  const killSwitchRows: Record<string, Record<string, unknown> | null> = {
    'delivery_kill_switch|targeteqbest-bets': {
      target: 'best-bets',
      killed: true,
      actor: 'claude-session-utv2-1601-containment',
      updated_at: minutesAgo(60 * 24 * 20),
    },
    'delivery_kill_switch|targeteqtrader-insights': {
      target: 'trader-insights',
      killed: true,
      actor: 'claude-session-utv2-1601-containment',
      updated_at: minutesAgo(60 * 24 * 20),
    },
  };
  return stubDb({
    rows: {
      'system_runs|run_typeeqingestor.cycle': { status: 'success', started_at: minutesAgo(60 * 24 * 52) },
      'system_runs|run_typeeqworker.heartbeat': { status: 'success', started_at: minutesAgo(60 * 24 * 20) },
      'provider_cycle_status|stage_statuseqmerged': { updated_at: minutesAgo(60 * 24 * 52) },
      game_results: { created_at: minutesAgo(60 * 24 * 52) },
      ...killSwitchRows,
      ...(overrides.rows ?? {}),
    },
    counts: overrides.counts ?? {},
  });
}

function parkedContext(overrides: { db?: ReadOnlyDb; github?: GithubReader } = {}): ProbeContext {
  return context({
    db: overrides.db ?? silentDb(),
    dbUnavailableReason: null,
    github: overrides.github ?? githubWithReceipt(receiptBody()),
    githubUnavailableReason: null,
  });
}

function stateOf(assessment: RuntimeModeAssessment, service: string): string {
  return assessment.services.find((entry) => entry.service === service)?.state ?? 'missing';
}

// ── The receipt is the only declaration channel, and it is strict ────────────

test('a malformed, truncated, or foreign runtime-mode receipt is rejected with a reason, never partially honoured', () => {
  assert.match(parseRuntimeModeReceipt('{"schema":"runtime-mode-rece').reason ?? '', /not valid JSON/);
  assert.equal(parseRuntimeModeReceipt('{"schema":"runtime-mode-rece').receipt, null);

  assert.match(parseRuntimeModeReceipt(JSON.stringify({ schema: 'deploy-mutation-confirmed/v1' })).reason ?? '', /schema/);

  const unknownMode = parseRuntimeModeReceipt(receiptBody({ declared_mode: 'maintenance' }));
  assert.equal(unknownMode.receipt, null);
  assert.match(unknownMode.reason ?? '', /neither "active" nor "parked"/);

  const unbound = parseRuntimeModeReceipt(receiptBody({ run_attempt: 0 }));
  assert.equal(unbound.receipt, null);
  assert.match(unbound.reason ?? '', /run_id, run_attempt/);

  const softKillSwitch = parseRuntimeModeReceipt(
    receiptBody({ kill_switch: [{ target: 'best-bets', killed: 'true' }] }),
  );
  assert.equal(softKillSwitch.receipt, null, 'a string "true" is not a proven kill switch');

  assert.ok(parseRuntimeModeReceipt(receiptBody()).receipt, 'the well-formed receipt must still parse');
});

test('deploy-run discovery is never scoped to a branch, so an off-main dispatch is not read as no deploy at all', async () => {
  const seen: unknown[] = [];
  const github = stubGithub({
    async latestRun(workflowFile, options) {
      seen.push({ workflowFile, options });
      return run({ id: 5001, run_attempt: 1 });
    },
    async downloadRunArtifact() {
      return { text: receiptBody(), reason: null };
    },
  });
  await resolveRuntimeModeReceipt(context({ github, githubUnavailableReason: null }));
  assert.deepEqual(seen, [{ workflowFile: 'deploy.yml', options: undefined }]);
});

test('every attempt of the candidate run is searched, newest first', async () => {
  const asked: string[] = [];
  const github = stubGithub({
    async latestRun() {
      return run({ id: 5001, run_attempt: 3 });
    },
    async downloadRunArtifact(_runId, name) {
      asked.push(name);
      // A downstream-only rerun advanced run_attempt to 3 without re-deploying,
      // so only attempt 1 ever published a receipt.
      return name === runtimeModeReceiptArtifactName(5001, 1)
        ? { text: receiptBody(), reason: null }
        : { text: null, reason: 'not found' };
    },
  });
  const resolved = await resolveRuntimeModeReceipt(context({ github, githubUnavailableReason: null }));
  assert.deepEqual(asked, [
    runtimeModeReceiptArtifactName(5001, 3),
    runtimeModeReceiptArtifactName(5001, 2),
    runtimeModeReceiptArtifactName(5001, 1),
  ]);
  assert.equal(resolved.receipt?.declared_mode, 'parked');
});

test('a malformed receipt on the newest attempt fails closed instead of falling through to an older valid one', async () => {
  const github = stubGithub({
    async latestRun() {
      return run({ id: 5001, run_attempt: 2 });
    },
    async downloadRunArtifact(_runId, name) {
      return name === runtimeModeReceiptArtifactName(5001, 2)
        ? { text: '{"schema":"runtime-mode-receipt/v1","run_id":5001,', reason: null }
        : { text: receiptBody({ run_attempt: 1 }), reason: null };
    },
  });
  const resolved = await resolveRuntimeModeReceipt(context({ github, githubUnavailableReason: null }));
  assert.equal(resolved.receipt, null, 'an older attempt must never rescue a malformed newer one');
  assert.match(resolved.reason ?? '', /malformed/);
});

test("a receipt bound to another operation's run/attempt is rejected, not adopted", async () => {
  const github = githubWithReceipt(receiptBody({ run_id: 4000 }));
  const resolved = await resolveRuntimeModeReceipt(context({ github, githubUnavailableReason: null }));
  assert.equal(resolved.receipt, null);
  assert.match(resolved.reason ?? '', /another operation's receipt/);
});

test('a deploy still in flight yields no declaration at all', async () => {
  const github = githubWithReceipt(receiptBody(), { status: 'in_progress' });
  const resolved = await resolveRuntimeModeReceipt(context({ github, githubUnavailableReason: null }));
  assert.equal(resolved.receipt, null);
  assert.match(resolved.reason ?? '', /in_progress/);
});

// ── The six states, each reached by the condition that names it ──────────────

test('parked_verified: declared parked, values verified, provably silent since', async () => {
  const assessment = await assessRuntimeMode(parkedContext());
  assert.equal(assessment.declared_mode, 'parked');
  assert.equal(stateOf(assessment, 'api'), 'parked_verified');
  assert.equal(stateOf(assessment, 'ingestor'), 'parked_verified');
  assert.equal(stateOf(assessment, 'worker'), 'parked_verified');

  const dimension = probeServiceRuntimeMode(assessment, NOW);
  assert.equal(dimension.status, 'pass');
  assert.equal(dimension.blocking, true);
  assert.match(dimension.evidence, /parked_verified/);
  assert.doesNotMatch(dimension.evidence, /\bhealthy\b/, 'parked_verified must never be reported as ordinary health');
});

test('parked_drift: an ingestor cycle after the parked deployment is a hard failure', async () => {
  const assessment = await assessRuntimeMode(
    parkedContext({
      db: silentDb({
        counts: { ['system_runs|run_typeeqingestor.cycle,started_atgt' + PARKED_AT]: 2 },
      }),
    }),
  );
  assert.equal(stateOf(assessment, 'ingestor'), 'parked_drift');
  const dimension = probeServiceRuntimeMode(assessment, NOW);
  assert.equal(dimension.status, 'fail');
  assert.match(dimension.evidence, /2 ingestor\.cycle run\(s\) started after the parked deployment/);
});

test('parked_drift: a queue claim or a public delivery after the parked deployment is a hard failure', async () => {
  const claimed = await assessRuntimeMode(
    parkedContext({ db: silentDb({ counts: { ['distribution_outbox|claimed_atgt' + PARKED_AT]: 1 } }) }),
  );
  assert.equal(stateOf(claimed, 'worker'), 'parked_drift');
  assert.equal(probeServiceRuntimeMode(claimed, NOW).status, 'fail');

  const delivered = await assessRuntimeMode(
    parkedContext({ db: silentDb({ counts: { ['distribution_outbox|statuseqsent,updated_atgt' + PARKED_AT]: 3 } }) }),
  );
  assert.equal(stateOf(delivered, 'worker'), 'parked_drift');
  assert.match(probeServiceRuntimeMode(delivered, NOW).evidence, /3 outbox row\(s\) delivered/);
});

test('parked_drift: a disengaged public kill switch is a hard failure even with zero activity', async () => {
  const assessment = await assessRuntimeMode(
    parkedContext({
      db: silentDb({
        rows: {
          'delivery_kill_switch|targeteqbest-bets': { target: 'best-bets', killed: false, actor: 'someone', updated_at: minutesAgo(5) },
        },
      }),
    }),
  );
  assert.equal(stateOf(assessment, 'worker'), 'parked_drift');
  assert.match(probeServiceRuntimeMode(assessment, NOW).evidence, /kill switch for "best-bets" is disengaged/);
});

test('parked_drift: a parked value that drifted from the declared contract is a hard failure', async () => {
  const drifted = receiptBody({
    services: [
      { service: 'api', image: 'i', env: { SYNDICATE_MACHINE_ENABLED: 'false' } },
      { service: 'ingestor', image: 'i', env: { UNIT_TALK_INGESTOR_AUTORUN: 'false', UNIT_TALK_INGESTOR_SCHEDULING_ENABLED: 'false' } },
      // Public delivery is possible again: parked mode requires exactly "none".
      { service: 'worker', image: 'i', env: { UNIT_TALK_WORKER_AUTORUN: 'false', UNIT_TALK_ENABLED_TARGETS: 'best-bets' } },
    ],
  });
  const assessment = await assessRuntimeMode(parkedContext({ github: githubWithReceipt(drifted) }));
  assert.equal(stateOf(assessment, 'worker'), 'parked_drift');
  assert.match(
    probeServiceRuntimeMode(assessment, NOW).evidence,
    /worker\.UNIT_TALK_ENABLED_TARGETS is "best-bets", the parked contract requires "none"/,
  );
});

test('active_healthy, active_degraded and active_failed are distinguished on the same declaration', async () => {
  const liveDb = (extra: Record<string, Record<string, unknown> | null> = {}) =>
    silentDb({
      rows: {
        'system_runs|run_typeeqingestor.cycle': { status: 'success', started_at: minutesAgo(3) },
        'system_runs|run_typeeqworker.heartbeat': { status: 'success', started_at: minutesAgo(2) },
        'provider_cycle_status|stage_statuseqmerged': { updated_at: minutesAgo(4) },
        'delivery_kill_switch|targeteqbest-bets': { target: 'best-bets', killed: false, actor: null, updated_at: minutesAgo(60) },
        'delivery_kill_switch|targeteqtrader-insights': { target: 'trader-insights', killed: false, actor: null, updated_at: minutesAgo(60) },
        ...extra,
      },
    });

  const healthy = await assessRuntimeMode(
    parkedContext({ db: liveDb(), github: githubWithReceipt(activeReceiptBody()) }),
  );
  assert.equal(healthy.declared_mode, 'active');
  assert.equal(stateOf(healthy, 'ingestor'), 'active_healthy');
  assert.equal(stateOf(healthy, 'worker'), 'active_healthy');
  assert.equal(probeServiceRuntimeMode(healthy, NOW).status, 'pass');

  // Declared active while the public kill switch is still engaged: the machine
  // is running but cannot deliver — a gap, not a dead service.
  const degraded = await assessRuntimeMode(
    parkedContext({
      db: liveDb({
        'delivery_kill_switch|targeteqbest-bets': { target: 'best-bets', killed: true, actor: 'containment', updated_at: minutesAgo(60) },
      }),
      github: githubWithReceipt(activeReceiptBody()),
    }),
  );
  assert.equal(stateOf(degraded, 'worker'), 'active_degraded');
  assert.equal(probeServiceRuntimeMode(degraded, NOW).status, 'fail');

  // Declared active over the silent database: staleness stays a hard failure.
  const failed = await assessRuntimeMode(
    parkedContext({ github: githubWithReceipt(activeReceiptBody()) }),
  );
  assert.equal(stateOf(failed, 'ingestor'), 'active_failed');
  assert.equal(stateOf(failed, 'worker'), 'active_failed');
  assert.equal(probeServiceRuntimeMode(failed, NOW).status, 'fail');
});

test('unreadable: with no receipt nothing is inferred, and the missing host observation is named', async () => {
  const assessment = await assessRuntimeMode(parkedContext({ github: githubWithReceipt(null) }));
  assert.equal(assessment.declared_mode, null);
  for (const service of ['api', 'ingestor', 'worker']) {
    assert.equal(stateOf(assessment, service), 'unreadable');
  }
  const dimension = probeServiceRuntimeMode(assessment, NOW);
  assert.equal(dimension.status, 'unknown');
  assert.match(dimension.evidence, /published no\s+runtime-mode receipt/);
  assert.match(dimension.evidence, /§12a/, 'the unprovisioned live host read must be named, not implied');
});

test('unreadable: a declared mode whose activity evidence cannot be read is not scored either way', async () => {
  const assessment = await assessRuntimeMode(
    context({
      db: null,
      dbUnavailableReason: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not present in this environment',
      github: githubWithReceipt(receiptBody()),
      githubUnavailableReason: null,
    }),
  );
  assert.equal(assessment.declared_mode, 'parked', 'the declaration was readable');
  assert.equal(stateOf(assessment, 'worker'), 'unreadable', 'but confirming it was not');
  assert.equal(probeServiceRuntimeMode(assessment, NOW).status, 'unknown');
});

test('unreadable: an observation past the SLA is not published as parked_verified', async () => {
  const stale = new Date(NOW.getTime() - (THRESHOLDS.runtimeModeObservationMaxHours + 24) * 3_600_000).toISOString();
  const assessment = await assessRuntimeMode(parkedContext({ github: githubWithReceipt(receiptBody({ observed_at: stale })) }));
  assert.equal(stateOf(assessment, 'api'), 'unreadable');
  const dimension = probeServiceRuntimeMode(assessment, NOW);
  assert.equal(dimension.status, 'unknown');
  assert.match(dimension.unreadable_reason ?? '', /observation SLA/);
});

// ── Parked is not health, and not the failure a dead active service produces ──

test('the same silent database yields pass under parked and fail under active — the mode is what decides', async () => {
  const parkedAssessment = await assessRuntimeMode(parkedContext());
  const parked = await probeIngestorHealth({ ...parkedContext(), runtimeMode: parkedAssessment });
  assert.equal(parked.status, 'pass');
  assert.match(parked.evidence, /PARKED_VERIFIED \(not active health\)/);
  assert.equal(parked.measured?.['declared_runtime_state'], 'parked_verified');

  const activeCtx = parkedContext({ github: githubWithReceipt(activeReceiptBody()) });
  const activeAssessment = await assessRuntimeMode(activeCtx);
  const active = await probeIngestorHealth({ ...activeCtx, runtimeMode: activeAssessment });
  assert.equal(active.status, 'fail');
  assert.match(active.evidence, /Declared active \(active_failed\)/);
  assert.match(active.evidence, /threshold 30m/);
});

test('parked silence does not erase the fact that ingestion had already stopped before the machine was parked', async () => {
  const assessment = await assessRuntimeMode(parkedContext());
  const ingestor = assessment.services.find((entry) => entry.service === 'ingestor');
  assert.equal(ingestor?.state, 'parked_verified');
  assert.ok(
    ingestor?.notes.some((note) => /already stopped .* before the parked deployment/.test(note)),
    'the pre-park stoppage is a separate fact and must be surfaced, not collapsed into the parked verdict',
  );
  const dimension = await probeIngestorHealth({ ...parkedContext(), runtimeMode: assessment });
  assert.match(dimension.evidence, /Separately, and not explained by parking/);
});

test('parking does not excuse rows stuck mid-flight — those fail in every mode', async () => {
  const db = silentDb({
    counts: {
      ['distribution_outbox|statuseqprocessing,updated_atlt' +
        new Date(NOW.getTime() - THRESHOLDS.outboxStaleProcessingMinutes * 60_000).toISOString()]: 4,
    },
  });
  const ctx = parkedContext({ db });
  const assessment = await assessRuntimeMode(ctx);
  assert.equal(stateOf(assessment, 'worker'), 'parked_verified');
  const worker = await probeWorkerOutboxHealth({ ...ctx, runtimeMode: assessment });
  assert.equal(worker.status, 'fail');
  assert.match(worker.evidence, /parking does not explain these: 4 bucket:stale_unknown rows/);
});

test('an unassessed mode is never treated as active — the probe keeps the reading and refuses the verdict', async () => {
  assert.equal(serviceRuntimeState(undefined, 'ingestor'), 'unreadable');
  assert.equal(serviceRuntimeState(null, 'worker'), 'unreadable');

  const ctx = parkedContext();
  const result = await probeIngestorHealth(ctx);
  assert.equal(result.status, 'unknown');
  assert.match(result.unreadable_reason ?? '', /not assessed/);
  assert.equal(
    result.measured?.['latest_cycle_age_minutes'],
    60 * 24 * 52,
    'the measured age must survive the refusal to score it',
  );
});

test('the ledger carries the runtime-mode dimension as blocking, and an unreadable mode is never GREEN', async () => {
  const ledger = await collectLedger(parkedContext({ github: githubWithReceipt(null) }), {
    gitHeadSha: 'b'.repeat(40),
    runUrl: null,
  });
  const dimension = ledger.dimensions.find((entry) => entry.id === 'service_runtime_mode');
  assert.ok(dimension, 'the ledger must record the desired-runtime-mode dimension');
  assert.equal(dimension?.blocking, true);
  assert.equal(dimension?.status, 'unknown');
  assert.ok(ledger.unreadable.includes('service_runtime_mode'));
  assert.notEqual(ledger.verdict, 'GREEN');
});

// ── The producer side of the channel, checked against this reader ────────────

test('deploy.yml publishes exactly the receipt this reader expects, after every assertion has passed', () => {
  const workflow = fs.readFileSync(
    new URL('../../.github/workflows/deploy.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /name: runtime-mode-receipt-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /path: runtime-mode-receipt\.json/);
  assert.match(workflow, /if-no-files-found: ignore/);
  assert.ok(
    workflow.includes(`"schema":"${RUNTIME_MODE_RECEIPT_SCHEMA}"`),
    'the workflow must emit the schema this reader accepts',
  );

  const confirmStart = workflow.indexOf('Confirm syndicate machine gate in production container');
  const killSwitchAt = workflow.indexOf('delivery_kill_switch', confirmStart);
  const receiptAt = workflow.indexOf(`"schema":"${RUNTIME_MODE_RECEIPT_SCHEMA}"`, confirmStart);
  assert.ok(confirmStart > 0 && killSwitchAt > confirmStart && receiptAt > killSwitchAt,
    'the receipt must be written after the kill-switch verification, so its existence means every assertion passed');

  // Every value the receipt reports must be a shell expansion of something the
  // step proved — a hardcoded literal would make the receipt decoration.
  for (const declared of ['"$SYNDICATE_MACHINE_MODE"', '"$INGESTOR_AUTORUN_VALUE"', '"$WORKER_AUTORUN_VALUE"', '"$ENABLED_TARGETS_VALUE"', '"$KILL_SWITCH_JSON"']) {
    assert.ok(workflow.includes(declared), `the receipt must carry the proved value ${declared}`);
  }
});

test('EXECUTABLE: the receipt deploy.yml actually writes is one this reader accepts, and no identity means no receipt', () => {
  const workflow = parseYaml(
    fs.readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8'),
  ) as { jobs: Record<string, { steps: { name?: string; run?: string }[] }> };
  const confirm = workflow.jobs['promote']?.steps.find((step) =>
    step.name?.startsWith('Confirm syndicate machine gate in production container'),
  );
  assert.ok(confirm?.run, 'the production confirm step must exist');
  const script = confirm.run as string;
  const block = script.slice(script.indexOf('if [ -z "${GITHUB_RUN_ID:-}"'));
  assert.ok(block.length > 0, 'the receipt-writing block must be identifiable');

  const proved = {
    SYNDICATE_MACHINE_MODE: 'parked',
    RELEASE_TAG: 'release-2026-08-01',
    EXPECTED_PROJECT: 'unit-talk',
    API_RUNNING_IMAGE: 'ghcr.io/griff843/unit-talk-v2/api:release-2026-08-01',
    VALUE: 'false',
    INGESTOR_RUNNING_IMAGE: 'ghcr.io/griff843/unit-talk-v2/ingestor:release-2026-08-01',
    INGESTOR_AUTORUN_VALUE: 'false',
    INGESTOR_SCHEDULING_VALUE: 'false',
    WORKER_RUNNING_IMAGE: 'ghcr.io/griff843/unit-talk-v2/worker:release-2026-08-01',
    WORKER_AUTORUN_VALUE: 'false',
    ENABLED_TARGETS_VALUE: 'none',
    KILL_SWITCH_JSON: '[{"target":"best-bets","killed":true},{"target":"trader-insights","killed":true}]',
  };

  const runBlock = (env: Record<string, string>) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1667-receipt-'));
    try {
      const result = spawnSync('bash', ['-euo', 'pipefail', '-c', block], {
        cwd: dir,
        env: { PATH: process.env['PATH'] ?? '', ...env },
        encoding: 'utf8',
      });
      const file = path.join(dir, 'runtime-mode-receipt.json');
      return {
        status: result.status,
        stdout: result.stdout,
        body: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null,
      };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  const written = runBlock({
    ...proved,
    GITHUB_RUN_ID: '12345',
    GITHUB_RUN_ATTEMPT: '2',
    GITHUB_SHA: 'c'.repeat(40),
  });
  assert.equal(written.status, 0);
  assert.ok(written.body, 'the workflow must actually write a receipt when the run identity is present');
  const parsed = parseRuntimeModeReceipt(written.body as string);
  assert.equal(parsed.reason, null, 'the receipt the workflow writes must parse without a single fixture edit');
  assert.equal(parsed.receipt?.declared_mode, 'parked');
  assert.equal(parsed.receipt?.run_id, 12345);
  assert.equal(parsed.receipt?.run_attempt, 2);
  assert.equal(parsed.receipt?.source_sha, 'c'.repeat(40));
  assert.deepEqual(
    parsed.receipt?.services.map((entry) => entry.service),
    ['api', 'ingestor', 'worker'],
  );
  assert.equal(parsed.receipt?.services.find((entry) => entry.service === 'worker')?.env['UNIT_TALK_ENABLED_TARGETS'], 'none');
  assert.deepEqual(parsed.receipt?.kill_switch, [
    { target: 'best-bets', killed: true },
    { target: 'trader-insights', killed: true },
  ]);

  // No run identity: nothing to bind the receipt to, so nothing is written and
  // readiness falls to `unreadable` rather than reading an unbindable receipt.
  const unbound = runBlock(proved);
  assert.equal(unbound.status, 0);
  assert.equal(unbound.body, null);
  assert.match(unbound.stdout, /receipt not written/);
});
