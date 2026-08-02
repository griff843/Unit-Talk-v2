import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  CANONICAL_LEDGER_PATH,
  collectLedger,
  computeObservability,
  computeVerdict,
  DEPLOY_PROMOTE_JOB_NAME,
  measureProofCoverage,
  probeCiVerify,
  probeConstitutionConvergence,
  probeDbTripwires,
  probeDeadLetterCount,
  probeDeploySha,
  probeIngestorHealth,
  probeWorkerOutboxHealth,
  resolveProductionDb,
  selectMostRecentlyUpdatedRun,
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

// Round 20 (PM review of 4b2fae01): verifyKillSwitchesEngagedNow now requires
// EXACTLY ONE row per required target (countRows on target alone) plus that
// row's own killed column read as strictly true (latestRow), instead of
// counting killed=false rows and treating two zero counts as "engaged" --
// zero was indistinguishable from "the row doesn't exist at all." This
// fixture builds the happy-path (both targets present, single row, killed
// true) counts+rows for both dictionaries; individual tests override a
// target's count (0 = missing, 2 = duplicate) or its row's killed value to
// exercise each fail-closed branch.
function killSwitchFixture(
  overrides: {
    bestBetsCount?: number;
    bestBetsKilled?: boolean;
    traderInsightsCount?: number;
    traderInsightsKilled?: boolean;
  } = {},
) {
  const {
    bestBetsCount = 1,
    bestBetsKilled = true,
    traderInsightsCount = 1,
    traderInsightsKilled = true,
  } = overrides;
  return {
    counts: {
      'delivery_kill_switch|targeteqbest-bets': bestBetsCount,
      'delivery_kill_switch|targeteqtrader-insights': traderInsightsCount,
    },
    rows: {
      'delivery_kill_switch|targeteqbest-bets': { killed: bestBetsKilled },
      'delivery_kill_switch|targeteqtrader-insights': { killed: traderInsightsKilled },
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
    async latestArtifactJson() {
      return null;
    },
    async jobConclusionForAttempt() {
      // Default to the happy path (promote genuinely ran, completed at a
      // fixed point in the past) so existing probeDeploySha tests that
      // don't care about this specific round-12/16 check don't all need
      // updating; tests proving the new fail-closed or recency-selection
      // behavior override this explicitly.
      return { conclusion: 'success', completedAt: minutesAgo(30) };
    },
    async listRunsByRecency(workflowFile, options) {
      // Round 14: default derives from latestRun (wrapping its single
      // result in a one-element array) so existing tests that only
      // override latestRun keep working unchanged; tests proving the
      // multi-candidate fallback-search behavior override this directly.
      const single = await this.latestRun(workflowFile, options);
      return single ? [single] : [];
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
    run_attempt: 1,
    ...overrides,
  };
}

// ── selectMostRecentlyUpdatedRun ─────────────────────────────────────────────

test('selectMostRecentlyUpdatedRun picks the run with the latest updated_at, not the first in the list', () => {
  // Round 10 (Codex review of bd4e3ace): GitHub's default run ordering is by
  // creation time. A run created earlier (run 1) but manually RE-RUN more
  // recently than a genuinely newer run (run 2) should win -- its re-run
  // attempt could be the most recent thing that actually mutated production,
  // even though it sorts first-by-created_at behind run 2.
  const olderRunReRunRecently = run({
    id: 1,
    created_at: minutesAgo(120),
    updated_at: minutesAgo(5), // re-run just now
    html_url: 'https://github.com/unit-talk/v2/actions/runs/1',
  });
  const newerRunNotTouchedSince = run({
    id: 2,
    created_at: minutesAgo(60),
    updated_at: minutesAgo(55), // completed once, never re-run
    html_url: 'https://github.com/unit-talk/v2/actions/runs/2',
  });
  const selected = selectMostRecentlyUpdatedRun([newerRunNotTouchedSince, olderRunReRunRecently]);
  assert.equal(selected?.id, 1);
});

test('selectMostRecentlyUpdatedRun returns null for an empty list, never throws', () => {
  assert.equal(selectMostRecentlyUpdatedRun([]), null);
});

test('selectMostRecentlyUpdatedRun returns the sole run when only one exists', () => {
  const onlyRun = run({ id: 7 });
  assert.equal(selectMostRecentlyUpdatedRun([onlyRun])?.id, 7);
});

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
  // UTV2-1660: measured now always carries a runtime_state, including for the
  // unreadable case -- it is one of the six required states, distinct from
  // active_failed/parked_drift, and must never be silently null.
  assert.deepEqual(result.measured, { runtime_state: 'unreadable' });
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
  assert.equal(stale.measured?.['runtime_state'], 'active_failed');
  assert.equal(healthy.measured?.['runtime_state'], 'active_healthy');
});

test('ingestor health reports active_degraded past half the SLA, without failing', async () => {
  const result = await probeIngestorHealth(
    context({
      dbUnavailableReason: null,
      db: stubDb({
        rows: {
          system_runs: { status: 'success', started_at: minutesAgo(20) }, // > 15 (half of 30), < 30
          provider_cycle_status: { updated_at: minutesAgo(4) },
          game_results: { created_at: minutesAgo(20) },
        },
      }),
    }),
  );
  assert.equal(result.status, 'pass');
  assert.equal(result.measured?.['runtime_state'], 'active_degraded');
  assert.match(result.evidence, /DEGRADED/);
});

// ── UTV2-1660: parked-vs-active runtime state ───────────────────────────────

const PARKED_RECEIPT_OBSERVED_AT = minutesAgo(15);

function parkedContractReceipt(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'parked-contract-receipt/v1',
    stage: 'production',
    mode: 'parked',
    requestedValue: 'false',
    runtimeValue: 'false',
    ingestorAutorun: 'false',
    ingestorScheduling: 'false',
    workerAutorun: 'false',
    enabledTargets: 'none',
    releaseTag: 'c'.repeat(40),
    deployedImageNamespace: 'ghcr.io/example/unit-talk-v2',
    killSwitchEngaged: true,
    observedAt: PARKED_RECEIPT_OBSERVED_AT,
    ...overrides,
  };
}

function githubWithParkedReceipt(receiptOverrides: Record<string, unknown> = {}) {
  return stubGithub({
    async latestRun(workflowFile) {
      if (workflowFile !== 'deploy.yml') return null;
      return run({ head_sha: 'c'.repeat(40), html_url: 'https://github.com/unit-talk/v2/actions/runs/999' });
    },
    async latestArtifactJson() {
      return parkedContractReceipt(receiptOverrides);
    },
  });
}

test('ingestor health refuses a parked-contract receipt that does not belong to the run\'s current attempt (round 11)', async () => {
  // Codex round 11 (review of 559bb788): a failed-jobs-only rerun of a
  // downstream job (e.g. deploy.yml's `smoke`, which needs: promote) bumps
  // the run's run_attempt and updated_at WITHOUT re-running `promote` --
  // meaning no new receipt artifact exists for that later attempt. Simulate
  // exactly that: the run reports run_attempt=2 (as if smoke alone was just
  // rerun), but the stub only has a receipt for attempt 1 (from when
  // promote originally ran) -- proving the fix refuses to fall back to that
  // stale attempt-1 receipt.
  const github = stubGithub({
    async latestRun(workflowFile) {
      if (workflowFile !== 'deploy.yml') return null;
      return run({ run_attempt: 2, html_url: 'https://github.com/unit-talk/v2/actions/runs/999' });
    },
    async latestArtifactJson(_runId, _namePrefix, expectedAttempt) {
      // Only attempt 1 ever produced a receipt (promote ran once, originally).
      if (expectedAttempt !== 1) return null;
      return parkedContractReceipt();
    },
  });
  const result = await probeIngestorHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github,
      db: stubDb({
        rows: {
          system_runs: { status: 'success', started_at: minutesAgo(3) },
          provider_cycle_status: { updated_at: minutesAgo(4) },
          game_results: { created_at: minutesAgo(20) },
        },
      }),
    }),
  );
  assert.notEqual(result.measured?.['runtime_state'], 'parked_verified');
  assert.match(result.evidence, /parked-mode evidence unavailable/);
});

test('ingestor health reports parked_verified, not active_healthy, when the deployed contract is confirmed parked with no new activity', async () => {
  const result = await probeIngestorHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github: githubWithParkedReceipt(),
      // Both stale relative to now (long past the 30m active threshold), but
      // BEFORE the parked-contract's own observedAt -- i.e. no new activity
      // since parking, exactly the expected shape of a parked deployment.
      db: stubDb({
        rows: {
          system_runs: { status: 'success', started_at: minutesAgo(400) },
          provider_cycle_status: { updated_at: minutesAgo(400) },
          game_results: { created_at: minutesAgo(400) },
        },
      }),
    }),
  );
  assert.equal(result.status, 'pass', 'parked_verified must not fail readiness');
  assert.equal(result.measured?.['runtime_state'], 'parked_verified');
  assert.match(result.evidence, /parked_verified/);
  assert.match(result.evidence, /NOT ordinary active health/, 'parked_verified must never read as "healthy"');
});

test('ingestor health reports parked_drift on a reapStaleRuns()-style startup mutation, even though the reaped row\'s started_at predates parking (round 15)', async () => {
  // Codex round 15 (review of 3a190143): apps/ingestor/src/index.ts calls
  // reapStaleRuns() BEFORE runIngestorCycles() on every startup.
  // packages/db/src/runtime-repositories.ts's real implementation updates
  // ONLY status='failed' and finished_at on a stale row -- never
  // started_at. An accidentally-resumed ingestor whose first action is
  // this reap (or that crashes before completing a first new cycle) would
  // leave cycleStartedAt still reflecting the OLD, pre-parking value --
  // genuine post-parking DB activity the started_at-only check misses.
  const result = await probeIngestorHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github: githubWithParkedReceipt(),
      db: stubDb({
        rows: {
          // started_at predates parking -- this is the OLD, reaped row,
          // not a freshly-started cycle.
          system_runs: { status: 'success', started_at: minutesAgo(400) },
          provider_cycle_status: { updated_at: minutesAgo(400) },
          game_results: { created_at: minutesAgo(400) },
        },
        counts: {
          [`system_runs|run_typeeqingestor.cycle,finished_atgt${PARKED_RECEIPT_OBSERVED_AT}`]: 1,
        },
      }),
    }),
  );
  assert.equal(result.status, 'fail');
  assert.equal(result.measured?.['runtime_state'], 'parked_drift');
  assert.match(result.evidence, /reapStaleRuns\(\) startup mutation or cycle completion/);
});

test('ingestor health reports parked_drift when a cycle ran AFTER the parked deploy was confirmed', async () => {
  const result = await probeIngestorHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github: githubWithParkedReceipt(),
      db: stubDb({
        rows: {
          // started_at is AFTER PARKED_RECEIPT_OBSERVED_AT -- the ingestor ran
          // despite being told to park. This must be worse than an ordinary
          // active failure, never a pass.
          system_runs: { status: 'success', started_at: minutesAgo(5) },
          provider_cycle_status: { updated_at: minutesAgo(400) },
          game_results: { created_at: minutesAgo(400) },
        },
      }),
    }),
  );
  assert.equal(result.status, 'fail');
  assert.equal(result.measured?.['runtime_state'], 'parked_drift');
  assert.match(result.evidence, /PARKED_DRIFT/);
  assert.match(result.evidence, /ran despite being parked|ran at.*AFTER/);
});

test('ingestor health detects post-parking activity even when the receipt has no fractional seconds and the DB row does (round 9)', async () => {
  // Codex round 9 (review of 4e1abf8a): lexical string comparison of ISO
  // timestamps is unsafe when precision differs. receipt.observedAt is
  // whole-second (as deploy.yml's receipt writer emits it); Postgres-sourced
  // timestamps commonly carry milliseconds. '.' (0x2E) sorts before 'Z'
  // (0x5A), so a millisecond-precision timestamp 500ms AFTER a whole-second
  // one can still compare as lexically SMALLER -- a naive `a > b` string
  // comparison would silently miss this real post-parking activity and
  // report parked_verified instead of parked_drift.
  const observedAt = '2026-07-30T11:00:00Z'; // whole-second, no fraction
  const cycleStartedAt = '2026-07-30T11:00:00.500Z'; // 500ms LATER, has a fraction
  const result = await probeIngestorHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github: githubWithParkedReceipt({ observedAt }),
      db: stubDb({
        rows: {
          system_runs: { status: 'success', started_at: cycleStartedAt },
          provider_cycle_status: { updated_at: minutesAgo(400) },
          game_results: { created_at: minutesAgo(400) },
        },
      }),
    }),
  );
  assert.equal(result.status, 'fail');
  assert.equal(result.measured?.['runtime_state'], 'parked_drift');
  assert.match(result.evidence, /PARKED_DRIFT/);
});

test('ingestor health reports parked_drift when the receipt itself shows a non-false autorun flag', async () => {
  const result = await probeIngestorHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github: githubWithParkedReceipt({ ingestorAutorun: 'true' }),
      db: stubDb({
        rows: {
          system_runs: { status: 'success', started_at: minutesAgo(400) },
          provider_cycle_status: { updated_at: minutesAgo(400) },
          game_results: { created_at: minutesAgo(400) },
        },
      }),
    }),
  );
  assert.equal(result.status, 'fail');
  assert.equal(result.measured?.['runtime_state'], 'parked_drift');
  assert.match(result.evidence, /UNIT_TALK_INGESTOR_AUTORUN/);
});

test('ingestor health falls back to unchanged active-mode logic when the parked receipt cannot be established', async () => {
  const github = stubGithub({
    async latestRun() {
      return null; // no successful deploy.yml run at all
    },
  });
  const result = await probeIngestorHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github,
      db: stubDb({
        rows: {
          system_runs: { status: 'success', started_at: minutesAgo(20_000) },
          provider_cycle_status: { updated_at: minutesAgo(20_000) },
          game_results: { created_at: minutesAgo(20_000) },
        },
      }),
    }),
  );
  // Must fail exactly like the pre-UTV2-1660 active-mode path -- absence of
  // parked evidence is never treated as an excuse to relax the check.
  assert.equal(result.status, 'fail');
  assert.equal(result.measured?.['runtime_state'], 'active_failed');
  assert.match(result.evidence, /parked-mode evidence unavailable/);
});

test('ingestor health refuses a parked-contract receipt whose releaseTag does not match the deploy run head SHA', async () => {
  const github = stubGithub({
    async latestRun(workflowFile) {
      if (workflowFile !== 'deploy.yml') return null;
      return run({ head_sha: 'd'.repeat(40) });
    },
    async latestArtifactJson() {
      return parkedContractReceipt({ releaseTag: 'e'.repeat(40) }); // mismatched
    },
  });
  const result = await probeIngestorHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github,
      db: stubDb({
        rows: {
          system_runs: { status: 'success', started_at: minutesAgo(3) },
          provider_cycle_status: { updated_at: minutesAgo(4) },
          game_results: { created_at: minutesAgo(20) },
        },
      }),
    }),
  );
  // A releaseTag mismatch means the receipt cannot be trusted as belonging to
  // this run; must fall back to active-mode evaluation, not parked_verified.
  assert.notEqual(result.measured?.['runtime_state'], 'parked_verified');
});

test('ingestor health refuses to trust an older successful deploy receipt when the newest deploy.yml run is not itself a completed success', async () => {
  // A server-side status=success filter would be blind to this: it would
  // still find and trust the OLDER successful run's receipt even though a
  // newer run (in progress, or failed after mutating production) exists.
  const github = stubGithub({
    async latestRun(workflowFile) {
      if (workflowFile !== 'deploy.yml') return null;
      // The newest run overall is still in progress -- not a completed success.
      return run({ status: 'in_progress', conclusion: null, html_url: 'https://github.com/unit-talk/v2/actions/runs/2' });
    },
    async latestArtifactJson() {
      // Should never be reached -- the newest-run check must short-circuit first.
      return parkedContractReceipt();
    },
  });
  const result = await probeIngestorHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github,
      db: stubDb({
        rows: {
          system_runs: { status: 'success', started_at: minutesAgo(3) },
          provider_cycle_status: { updated_at: minutesAgo(4) },
          game_results: { created_at: minutesAgo(20) },
        },
      }),
    }),
  );
  assert.notEqual(result.measured?.['runtime_state'], 'parked_verified');
  assert.match(result.evidence, /parked-mode evidence unavailable/);
});

test('ingestor health trusts the newest deploy.yml run regardless of branch, and never passes a branch filter', async () => {
  // Round 8 (Codex review of 2be41dd8): deploy.yml's workflow_dispatch is
  // unrestricted -- a manual dispatch from a non-main branch or tag performs
  // the exact same production container replacement. A `{ branch: 'main' }`
  // filter on resolveParkedContractReceipt's latestRun call would be blind to
  // a newer run dispatched from e.g. a hotfix branch, and could trust a
  // stale main-branch receipt instead. This asserts both that the call
  // receives NO branch filter, and that a newest run whose head_sha/ref
  // belongs to a non-main dispatch is still trusted as the parked receipt's
  // source of truth.
  let capturedOptions: { branch?: string; status?: string } | undefined = 'unset' as never;
  const github = stubGithub({
    async latestRun(workflowFile, options) {
      if (workflowFile !== 'deploy.yml') return null;
      capturedOptions = options;
      // The newest run overall was dispatched from a non-main ref (e.g. a
      // hotfix branch), not main -- there is no `ref`/`head_branch` field on
      // WorkflowRun to assert against directly, so this is proven by the
      // fact that a `{ branch: 'main' }`-filtered call would never surface a
      // run like this from GitHub's API in the first place.
      return run({ head_sha: 'f'.repeat(40), html_url: 'https://github.com/unit-talk/v2/actions/runs/777' });
    },
    async latestArtifactJson() {
      return parkedContractReceipt({ releaseTag: 'f'.repeat(40) });
    },
  });
  const result = await probeIngestorHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github,
      db: stubDb({
        rows: {
          system_runs: { status: 'success', started_at: minutesAgo(400) },
          provider_cycle_status: { updated_at: minutesAgo(400) },
          game_results: { created_at: minutesAgo(400) },
        },
      }),
    }),
  );
  assert.deepEqual(capturedOptions, undefined);
  assert.equal(result.measured?.['runtime_state'], 'parked_verified');
});

function githubWithParkedWorkerReceipt(receiptOverrides: Record<string, unknown> = {}) {
  return stubGithub({
    async latestRun(workflowFile) {
      if (workflowFile !== 'deploy.yml') return null;
      return run({ head_sha: 'c'.repeat(40), html_url: 'https://github.com/unit-talk/v2/actions/runs/999' });
    },
    async latestArtifactJson() {
      return parkedContractReceipt(receiptOverrides);
    },
  });
}

test('worker/outbox health reports parked_verified when parked and kill switches re-verify engaged', async () => {
  const result = await probeWorkerOutboxHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github: githubWithParkedWorkerReceipt(),
      db: stubDb({
        rows: { system_runs: { status: 'success', started_at: minutesAgo(400) }, ...killSwitchFixture().rows },
        counts: killSwitchFixture().counts,
      }),
    }),
  );
  assert.equal(result.status, 'pass');
  assert.equal(result.measured?.['runtime_state'], 'parked_verified');
  assert.equal(result.measured?.['kill_switch_reverified_engaged'], true);
  assert.match(result.evidence, /NOT ordinary active health/);
});

test('worker/outbox health reports parked_verified despite a PRE-parking stuck row that ages past the active-mode threshold while parked (round 13)', async () => {
  // Codex round 13 (review of 68b1d87d): staleUnknown/stuckRetryable are
  // NOT time-scoped to parking -- they count rows currently over the
  // active-mode staleness threshold regardless of whether that staleness
  // predates parking. A row already stuck in 'processing' BEFORE parking,
  // left untouched by parking itself, eventually crosses the 5m threshold
  // purely by the clock running while parked. This must NOT be reported as
  // drift: no post-parking activity actually occurred.
  const result = await probeWorkerOutboxHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github: githubWithParkedWorkerReceipt(),
      db: stubDb({
        rows: { system_runs: { status: 'success', started_at: minutesAgo(400) }, ...killSwitchFixture().rows },
        counts: {
          ...killSwitchFixture().counts,
          // The exact real staleUnknown query: processing rows older than
          // the 5m active-mode threshold. Deliberately nonzero here -- a
          // pre-existing stuck row that would have false-triggered drift
          // under the old code.
          [`distribution_outbox|statuseqprocessing,updated_atlt${minutesAgo(5)}`]: 3,
          // No row was newly claimed after parking (claimed_at gt observedAt).
          [`distribution_outbox|statuseqprocessing,claimed_atgt${PARKED_RECEIPT_OBSERVED_AT}`]: 0,
        },
      }),
    }),
  );
  assert.equal(result.status, 'pass', 'a pre-parking stuck row aging past threshold must not report drift');
  assert.equal(result.measured?.['runtime_state'], 'parked_verified');
});

test('worker/outbox health reports parked_drift on a live post-parking claim, before the 5-minute staleness threshold elapses (round 13)', async () => {
  // Codex round 13, second finding: if claimNextAtomic() succeeds but the
  // following (separate, non-atomic) runs.startRun() fails transiently,
  // workerRunsSinceParking (system_runs-based) never sees this claim, and
  // during the first 5 minutes the row isn't yet "stale" either -- every
  // existing counter could read zero. A live claimed_at-after-parking check
  // catches this regardless of staleness age or whether the run-record
  // write succeeded.
  const result = await probeWorkerOutboxHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github: githubWithParkedWorkerReceipt(),
      db: stubDb({
        rows: { system_runs: { status: 'success', started_at: minutesAgo(400) }, ...killSwitchFixture().rows },
        counts: {
          ...killSwitchFixture().counts,
          // Claimed 1 minute ago (after parking), well within the 5m
          // window -- not yet "stale" by the old, removed check.
          [`distribution_outbox|statuseqprocessing,claimed_atgt${PARKED_RECEIPT_OBSERVED_AT}`]: 1,
        },
      }),
    }),
  );
  assert.equal(result.status, 'fail');
  assert.equal(result.measured?.['runtime_state'], 'parked_drift');
  assert.match(result.evidence, /currently claimed.*claimed_at after the parked deploy/);
});

test('worker/outbox health reports parked_drift when kill switches re-verify as NOT engaged, even though the receipt claimed they were', async () => {
  const result = await probeWorkerOutboxHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github: githubWithParkedWorkerReceipt(),
      db: stubDb({
        rows: {
          system_runs: { status: 'success', started_at: minutesAgo(400) },
          ...killSwitchFixture({ bestBetsKilled: false }).rows, // best-bets is NOT killed right now
        },
        counts: killSwitchFixture({ bestBetsKilled: false }).counts,
      }),
    }),
  );
  assert.equal(result.status, 'fail', 'a disengaged public kill switch must fail readiness even in parked mode');
  assert.equal(result.measured?.['runtime_state'], 'parked_drift');
  assert.equal(result.measured?.['kill_switch_reverified_engaged'], false);
  assert.match(result.evidence, /kill switches are not both engaged/);
});

test('worker/outbox health reports parked_drift when a required kill-switch target row is MISSING entirely (round 20)', async () => {
  // PM review (round 20, exact-head 4b2fae01): the pre-round-20 query
  // counted rows where killed='false' and treated two zero counts as
  // "engaged" -- a MISSING row also produces a zero count, so an absent
  // best-bets or trader-insights record would be silently certified as
  // engaged. Zero matching rows for the target itself (not just for
  // killed=false) must fail closed, never read as engaged.
  const result = await probeWorkerOutboxHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github: githubWithParkedWorkerReceipt(),
      db: stubDb({
        rows: {
          system_runs: { status: 'success', started_at: minutesAgo(400) },
          ...killSwitchFixture().rows,
        },
        counts: killSwitchFixture({ bestBetsCount: 0 }).counts, // best-bets row does not exist at all
      }),
    }),
  );
  assert.equal(result.status, 'fail', 'a missing kill-switch target row must never be treated as engaged');
  assert.equal(result.measured?.['runtime_state'], 'parked_drift');
  assert.equal(result.measured?.['kill_switch_reverified_engaged'], false);
});

test('worker/outbox health reports parked_drift when a kill-switch target has DUPLICATE rows (round 20)', async () => {
  // PM review (round 20): the pre-round-20 query never checked row count at
  // all, only the killed=false count -- two rows for the same target (e.g.
  // a bad migration or a race writing a second row) with conflicting or
  // ambiguous state must not be trusted as a single authoritative "engaged"
  // reading, even if a killed=false-count-based check might have read as 0.
  const result = await probeWorkerOutboxHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github: githubWithParkedWorkerReceipt(),
      db: stubDb({
        rows: {
          system_runs: { status: 'success', started_at: minutesAgo(400) },
          ...killSwitchFixture().rows,
        },
        counts: killSwitchFixture({ traderInsightsCount: 2 }).counts, // duplicate trader-insights rows
      }),
    }),
  );
  assert.equal(result.status, 'fail', 'duplicate kill-switch target rows must never be treated as a single authoritative engaged reading');
  assert.equal(result.measured?.['runtime_state'], 'parked_drift');
  assert.equal(result.measured?.['kill_switch_reverified_engaged'], false);
});

test('worker/outbox health reports parked_drift when a kill-switch target row has a MALFORMED killed value (round 20)', async () => {
  // PM review (round 20): the single row exists (count === 1) but its own
  // killed column is not strictly boolean true -- e.g. null, a string, or
  // any other value a corrupted write or a client library quirk could
  // produce. Only a strict `=== true` check is a pass; anything else must
  // fail closed rather than being coerced to a truthy/falsy read.
  const result = await probeWorkerOutboxHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github: githubWithParkedWorkerReceipt(),
      db: stubDb({
        rows: {
          system_runs: { status: 'success', started_at: minutesAgo(400) },
          'delivery_kill_switch|targeteqbest-bets': { killed: null },
          'delivery_kill_switch|targeteqtrader-insights': { killed: true },
        },
        counts: {
          'delivery_kill_switch|targeteqbest-bets': 1,
          'delivery_kill_switch|targeteqtrader-insights': 1,
        },
      }),
    }),
  );
  assert.equal(result.status, 'fail', 'a malformed (non-boolean-true) killed value must never be treated as engaged');
  assert.equal(result.measured?.['runtime_state'], 'parked_drift');
  assert.equal(result.measured?.['kill_switch_reverified_engaged'], false);
});

test('worker/outbox health reports parked_drift when the worker heartbeat ran after the parked deploy was confirmed', async () => {
  const result = await probeWorkerOutboxHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github: githubWithParkedWorkerReceipt(),
      db: stubDb({
        rows: { system_runs: { status: 'success', started_at: minutesAgo(5) }, ...killSwitchFixture().rows }, // after PARKED_RECEIPT_OBSERVED_AT
        counts: killSwitchFixture().counts,
      }),
    }),
  );
  assert.equal(result.status, 'fail');
  assert.equal(result.measured?.['runtime_state'], 'parked_drift');
  assert.match(result.evidence, /worker\.heartbeat ran at/);
});

test('worker/outbox health is unknown (never parked_verified, and never a confident parked_drift) when the live kill-switch recheck is unreadable and nothing else shows drift', async () => {
  // Codex round 14 (review of 8bde6b79): killSwitchNow === null means the
  // RECHECK ITSELF failed -- an observability failure, not a confirmed
  // product condition. The pre-round-14 code folded this into driftReasons,
  // producing a confident status:'fail', runtime_state:'parked_drift' with
  // unreadable_reason: null -- a false RED reported as fully observed. It
  // must instead be `unknown`, distinguishable from both "confirmed healthy"
  // and "confirmed broken."
  const result = await probeWorkerOutboxHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github: githubWithParkedWorkerReceipt(),
      db: stubDb({
        rows: { system_runs: { status: 'success', started_at: minutesAgo(400) } },
        // No 'counts' entry for delivery_kill_switch and no throwOn: the real
        // bug this guards was distinguishing null (unreadable) from false
        // (confirmed not engaged) -- so throw specifically inside
        // verifyKillSwitchesEngagedNow's own query, not elsewhere.
        throwOn: 'delivery_kill_switch',
      }),
    }),
  );
  assert.notEqual(result.measured?.['runtime_state'], 'parked_verified', 'unreadable containment evidence must never read as parked_verified');
  assert.equal(result.status, 'unknown');
  assert.notEqual(result.measured?.['runtime_state'], 'parked_drift', 'an unreadable recheck alone is not a CONFIRMED breach');
  // Round 17 (Codex review of 3be07234): this path returned the generic
  // unreadable() helper directly, whose measured is always null -- unlike
  // every other unreadable path in this file, which wraps it with
  // measured.runtime_state: 'unreadable' so consumers can distinguish this
  // observer failure from active_failed/parked_drift at the field level.
  assert.equal(result.measured?.['runtime_state'], 'unreadable', 'must be field-level distinguishable from other states, like every other unreadable path in this file');
  assert.ok(result.unreadable_reason, 'an unreadable dimension must record why');
  assert.match(result.evidence, /unreadable/i);
});

test('worker/outbox health still reports parked_drift when the kill-switch recheck is unreadable BUT another signal independently proves genuine drift', async () => {
  // The unreadable kill-switch recheck must not suppress or downgrade a
  // drift finding some OTHER signal already confirms on its own -- an
  // observability failure on one check is not a license to hide a real
  // breach proven by a different, genuinely-readable check.
  const result = await probeWorkerOutboxHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github: githubWithParkedWorkerReceipt(),
      db: stubDb({
        // heartbeat ran AFTER parking -- independently confirmed real drift.
        rows: { system_runs: { status: 'success', started_at: minutesAgo(5) } },
        throwOn: 'delivery_kill_switch',
      }),
    }),
  );
  assert.equal(result.status, 'fail');
  assert.equal(result.measured?.['runtime_state'], 'parked_drift');
  assert.match(result.evidence, /worker\.heartbeat ran at/);
});

test('worker/outbox health reports parked_drift when a distribution.process run started after parking, even when no outbox row is currently stuck', async () => {
  // A row claimed, attempted, and resolved (success OR failure) quickly,
  // before the 5m/30m "stuck" windows above would elapse, leaves
  // staleUnknown/stuckRetryable both at zero even though the worker plainly
  // ran. system_runs.run_type='distribution.process' is created at the
  // moment of claim (before success/failure is known) exclusively by
  // distribution-worker.ts's claim step -- recap-service never calls
  // repositories.runs.startRun, so it can never produce this run_type.
  const result = await probeWorkerOutboxHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github: githubWithParkedWorkerReceipt(),
      db: stubDb({
        rows: { system_runs: { status: 'success', started_at: minutesAgo(400) }, ...killSwitchFixture().rows },
        counts: {
          ...killSwitchFixture().counts,
          [`system_runs|run_typeeqdistribution.process,started_atgt${PARKED_RECEIPT_OBSERVED_AT}`]: 1,
        },
      }),
    }),
  );
  assert.equal(result.status, 'fail', 'a post-parking distribution.process run must fail readiness even with zero stuck rows');
  assert.equal(result.measured?.['runtime_state'], 'parked_drift');
  assert.equal(result.measured?.['post_parking_worker_run_count'], 1);
  assert.match(result.evidence, /distribution\.process.*started after the parked deploy/);
});

test('worker/outbox health reports parked_drift on a post-parking stale-claim reap, which creates no system_runs row', async () => {
  // apps/worker/src/runner.ts's runWorkerCycles reaps stale claims via a
  // SEPARATE step (reapStaleClaims) before processNextDistributionWork in
  // the same cycle -- it resets a stale row to fresh 'pending' (clearing
  // any stuck-ness AND claimed_at), but creates no system_runs row. This is
  // the one worker code path round 5's system_runs-only check could not
  // see. Queries last_error (LIKE 'stale claim reaped by%') rather than the
  // audit_log entry the same call also records: the real
  // (Supabase-backed) reapStaleClaims implementation writes last_error in
  // the SAME atomic UPDATE that clears claimed_at, whereas the audit_log
  // write happens afterward and is not atomic with the mutation -- round 7
  // caught this gap in the audit_log-based version.
  const result = await probeWorkerOutboxHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github: githubWithParkedWorkerReceipt(),
      db: stubDb({
        rows: { system_runs: { status: 'success', started_at: minutesAgo(400) }, ...killSwitchFixture().rows },
        counts: {
          ...killSwitchFixture().counts,
          [`distribution_outbox|last_errorlikestale claim reaped by%,updated_atgt${PARKED_RECEIPT_OBSERVED_AT}`]: 1,
        },
      }),
    }),
  );
  assert.equal(result.status, 'fail', 'a post-parking stale-claim reap must fail readiness even with zero system_runs rows');
  assert.equal(result.measured?.['runtime_state'], 'parked_drift');
  assert.equal(result.measured?.['post_parking_stale_claim_reap_count'], 1);
  assert.match(result.evidence, /stale-claim reap/);
});

test('worker/outbox health does NOT flag a parked-enabled recap-scheduler write as drift', async () => {
  // apps/api/src/recap-service.ts enqueues, and on both success (markSent)
  // and transient failure (recordRecapDeliveryFailure -> markFailed), writes
  // through the exact same OutboxRepository methods the worker uses --
  // confirmed by exhaustive grep, distribution-worker.ts and
  // recap-service.ts are the only two callers in the codebase -- but it
  // never calls repositories.runs.startRun or reapStaleClaims, so it can
  // never produce a distribution.process system_runs row, and its own
  // markFailed calls set last_error to an arbitrary delivery-error message
  // (e.g. "HTTP 500"), never the reap-specific "stale claim reaped by"
  // prefix. A fixture with zero matching rows on either signal must read as
  // parked_verified regardless of how much distribution_outbox activity
  // recap-service produced.
  const result = await probeWorkerOutboxHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github: githubWithParkedWorkerReceipt(),
      db: stubDb({
        rows: { system_runs: { status: 'success', started_at: minutesAgo(400) }, ...killSwitchFixture().rows },
        counts: {
          ...killSwitchFixture().counts,
          // No matching system_runs or last_error-prefixed rows -- both default to 0 in stubDb.
        },
      }),
    }),
  );
  assert.equal(result.status, 'pass', 'a parked-enabled scheduler write must not be misread as worker activity');
  assert.equal(result.measured?.['runtime_state'], 'parked_verified');
  assert.equal(result.measured?.['post_parking_worker_run_count'], 0);
  assert.equal(result.measured?.['post_parking_stale_claim_reap_count'], 0);
});

test('worker/outbox health falls back to unchanged active-mode logic when the parked receipt cannot be established', async () => {
  const result = await probeWorkerOutboxHealth(
    context({
      dbUnavailableReason: null,
      githubUnavailableReason: null,
      github: stubGithub({ async latestRun() { return null; } }),
      db: stubDb({ rows: { system_runs: { status: 'success', started_at: minutesAgo(400) } } }),
    }),
  );
  assert.equal(result.status, 'fail');
  assert.equal(result.measured?.['runtime_state'], 'active_failed');
  assert.match(result.evidence, /parked-mode evidence unavailable/);
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

test('deploy alignment refuses to trust a run when NO attempt (current or earlier) ever ran promote, and no other candidate exists (round 12/14/15)', async () => {
  // Codex round 12 (review of cc95a8f3): a failed-jobs-only rerun of a
  // downstream job (smoke, needs: promote) can advance a run's current
  // attempt and updated_at WITHOUT re-running promote. Round 14 changed
  // the mechanism from "trust or give up" to "walk the candidate list past
  // non-promoting candidates." Round 15 further widened the per-candidate
  // check to search every attempt (current down to 1), not just the
  // current one (see the next two tests) -- this case proves the search
  // still fails closed, at every level, when NO attempt of the only
  // candidate ever ran promote successfully.
  const result = await probeDeploySha(
    context({
      githubUnavailableReason: null,
      github: stubGithub({
        async latestRun() {
          return run({ head_sha: 'c'.repeat(40), run_attempt: 2 });
        },
        async jobConclusionForAttempt() {
          // promote never succeeded in ANY attempt of this run.
          return null;
        },
      }),
    }),
  );
  assert.equal(result.status, 'unknown');
  assert.match(result.evidence, /show a successful "promote" job in ANY of their attempts/);
});

test('deploy alignment finds a successful promote in an EARLIER attempt of the SAME run, without falling through to an older candidate (round 15)', async () => {
  // Codex round 15 (review of 3a190143): round 14's fix checked only a
  // candidate's CURRENT attempt for promote. If promote succeeded in
  // attempt 1 but a LATER failed-jobs-only rerun of smoke alone created
  // attempt 2 (which never re-runs promote), round 14 rejected the ENTIRE
  // run and fell through to an older, less accurate candidate -- even
  // though attempt 1 is exactly what changed production and this run's
  // own head_sha is still correct. The fix must search every attempt of
  // THIS run before moving on, so this run (not an older one) is used.
  const onlyCandidate = run({
    id: 200,
    head_sha: 'e'.repeat(40),
    run_attempt: 2,
    html_url: 'https://github.com/unit-talk/v2/actions/runs/200',
  });
  const result = await probeDeploySha(
    context({
      githubUnavailableReason: null,
      github: stubGithub({
        async headSha() {
          return 'e'.repeat(40);
        },
        async listRunsByRecency() {
          return [onlyCandidate];
        },
        async jobConclusionForAttempt(runId, jobName, attempt) {
          if (jobName !== DEPLOY_PROMOTE_JOB_NAME || runId !== 200) return null;
          if (attempt === 1) return { conclusion: 'success', completedAt: minutesAgo(45) }; // promote succeeded here originally
          return null; // attempt 2 only re-ran smoke, never re-ran promote
        },
      }),
    }),
  );
  assert.equal(result.status, 'pass');
  assert.equal(result.measured?.['deployed_sha'], 'e'.repeat(40));
});

test('deploy alignment walks past a non-promoting candidate to the next one that genuinely ran promote (round 14)', async () => {
  // Codex round 14 (review of 8bde6b79): giving up unreadable at the very
  // first (most-recently-updated) candidate throws away a recoverable
  // answer when an OLDER candidate's current attempt genuinely ran promote.
  // Simulates: the newest run is a downstream-only (smoke) rerun of an
  // older deploy whose promote never re-ran in its current attempt; the
  // NEXT candidate (genuinely older by updated_at, but the one that
  // actually deployed) has a promote job that succeeded in its own current
  // attempt -- that one's head_sha must be trusted, not treated as
  // unreadable.
  const newestNonPromoting = run({
    id: 101,
    head_sha: 'c'.repeat(40),
    run_attempt: 2,
    updated_at: minutesAgo(1),
    html_url: 'https://github.com/unit-talk/v2/actions/runs/101',
  });
  const olderGenuineDeploy = run({
    id: 100,
    head_sha: 'd'.repeat(40),
    run_attempt: 1,
    updated_at: minutesAgo(10),
    html_url: 'https://github.com/unit-talk/v2/actions/runs/100',
  });
  const result = await probeDeploySha(
    context({
      githubUnavailableReason: null,
      github: stubGithub({
        async headSha() {
          return 'd'.repeat(40); // main HEAD matches the older, genuine deploy
        },
        async listRunsByRecency() {
          return [newestNonPromoting, olderGenuineDeploy];
        },
        async jobConclusionForAttempt(runId, jobName, attempt) {
          if (jobName !== DEPLOY_PROMOTE_JOB_NAME) return null;
          if (runId === 100 && attempt === 1) return { conclusion: 'success', completedAt: minutesAgo(10) };
          return null; // run 101's attempt 2 never ran promote
        },
      }),
    }),
  );
  assert.equal(result.status, 'pass');
  assert.equal(result.measured?.['deployed_sha'], 'd'.repeat(40));
});

test('deploy alignment selects by the promote job\'s own completion time, not run-level updated_at bumped by an unrelated rerun (round 16)', async () => {
  // Codex round 16 (review of cb0faf40): candidates are ordered by run-level
  // updated_at (round 10/14's selectMostRecentlyUpdatedRun / listRunsByRecency).
  // An unrelated downstream job's rerun can bump a run's updated_at without
  // touching promote at all -- so an OLDER run whose promote succeeded long
  // ago, but whose updated_at was recently bumped by a later smoke-only
  // rerun, would otherwise be selected over a genuinely NEWER run whose
  // promote actually completed more recently in real time. The fix must
  // compare by the promote job's own completedAt across every candidate,
  // not by run recency order or per-candidate early-exit.
  const olderRunBumpedRecently = run({
    id: 300,
    head_sha: 'f'.repeat(40),
    run_attempt: 2,
    updated_at: minutesAgo(1), // bumped by an unrelated smoke-only rerun
    html_url: 'https://github.com/unit-talk/v2/actions/runs/300',
  });
  const newerRunGenuinePromote = run({
    id: 301,
    head_sha: 'a'.repeat(40),
    run_attempt: 1,
    updated_at: minutesAgo(20), // not touched since it finished
    html_url: 'https://github.com/unit-talk/v2/actions/runs/301',
  });
  const result = await probeDeploySha(
    context({
      githubUnavailableReason: null,
      github: stubGithub({
        async headSha() {
          return 'a'.repeat(40);
        },
        async listRunsByRecency() {
          // recency order puts the bumped-but-stale-promote run first
          return [olderRunBumpedRecently, newerRunGenuinePromote];
        },
        async jobConclusionForAttempt(runId, jobName, attempt) {
          if (jobName !== DEPLOY_PROMOTE_JOB_NAME) return null;
          if (runId === 300 && attempt === 1) {
            // promote succeeded LONG ago in this run's original attempt
            return { conclusion: 'success', completedAt: minutesAgo(120) };
          }
          if (runId === 301 && attempt === 1) {
            // promote for the genuinely newer deploy completed more recently
            return { conclusion: 'success', completedAt: minutesAgo(15) };
          }
          return null; // run 300's attempt 2 (the smoke-only rerun) never re-ran promote
        },
      }),
    }),
  );
  assert.equal(result.status, 'pass');
  assert.equal(result.measured?.['deployed_sha'], 'a'.repeat(40));
});

test('deploy alignment still trusts a run whose promote succeeded even though a downstream smoke failure turned the overall workflow conclusion red (round 21)', async () => {
  // PM review (round 21, exact-head 11dcc7ce): probeDeploySha's real
  // implementation called listRunsByRecency('deploy.yml', { branch: 'main',
  // status: 'success' }) -- a server-side filter on the workflow run's
  // OVERALL conclusion. A run where `promote` itself succeeds (mutating
  // production) but a later, unrelated downstream job (smoke) fails turns
  // the whole workflow run's conclusion to 'failure' -- that run would never
  // even appear in `candidates`, so its genuinely successful promote job
  // (and the production mutation it performed) would be silently invisible
  // to this dimension. The fix drops the status filter entirely; only the
  // per-attempt jobConclusionForAttempt(promote) check below decides
  // trust, never the run's own aggregate status/conclusion fields. This
  // stub's run object is deliberately status:'completed'/conclusion:'failure'
  // (as GitHub would report the overall run) to prove the code path never
  // reads those fields when deciding whether to trust the run.
  const promoteSucceededSmokeFailed = run({
    id: 999,
    head_sha: 'c'.repeat(40),
    status: 'completed',
    conclusion: 'failure', // overall workflow run is RED because smoke failed
    run_attempt: 1,
    html_url: 'https://github.com/unit-talk/v2/actions/runs/999',
  });
  const result = await probeDeploySha(
    context({
      githubUnavailableReason: null,
      github: stubGithub({
        async headSha() {
          return 'c'.repeat(40); // main HEAD matches the run that actually promoted
        },
        async listRunsByRecency() {
          return [promoteSucceededSmokeFailed];
        },
        async jobConclusionForAttempt(runId, jobName, attempt) {
          if (runId !== 999 || jobName !== DEPLOY_PROMOTE_JOB_NAME || attempt !== 1) return null;
          // promote itself succeeded despite the overall run later failing on smoke.
          return { conclusion: 'success', completedAt: minutesAgo(10) };
        },
      }),
    }),
  );
  assert.equal(result.status, 'pass', 'a run whose promote succeeded must still be trusted even if the overall workflow conclusion is failure');
  assert.equal(result.measured?.['deployed_sha'], 'c'.repeat(40));
});

test('CI verify scopes its run lookup to the current main HEAD, so an unrelated older rerun cannot shadow it (round 13)', async () => {
  // Codex round 13, third finding (P2): probeCiVerify shares latestRun with
  // the deployment-history probes. If an older ci.yml run on main is
  // manually rerun after CI already passed on the current head, a global
  // updated_at-based selection (correct for deployment history) would
  // return the OLD run instead of the run for HEAD, reporting a false
  // failure despite current-main CI being green. Proven here by asserting
  // latestRun is called with headSha bound to main's own resolved SHA, and
  // that only a run matching that exact SHA is ever trusted.
  const mainSha = 'e'.repeat(40);
  const staleRerunSha = 'f'.repeat(40);
  let capturedHeadSha: string | undefined;
  const result = await probeCiVerify(
    context({
      githubUnavailableReason: null,
      github: stubGithub({
        async headSha() {
          return mainSha;
        },
        async latestRun(_workflowFile, options) {
          capturedHeadSha = options?.headSha;
          // The stub simulates GitHub's own server-side head_sha filtering:
          // asking for a SHA that doesn't match the (old, rerun) run's own
          // head_sha correctly finds nothing, rather than returning that
          // unrelated run just because it has the newest updated_at.
          if (options?.headSha !== mainSha) return null;
          return run({ head_sha: mainSha, conclusion: 'success' });
        },
      }),
    }),
  );
  assert.equal(capturedHeadSha, mainSha, 'latestRun must be scoped to the resolved main HEAD, not called unscoped');
  assert.notEqual(capturedHeadSha, staleRerunSha);
  assert.equal(result.status, 'pass');
  assert.equal(result.measured?.['on_main_head'], true);
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

test('readiness-refresh.yml grants the scheduled job actions:read (required to list/download the parked-contract artifact)', () => {
  const workflowPath = path.resolve(process.cwd(), '.github/workflows/readiness-refresh.yml');
  const source = fs.readFileSync(workflowPath, 'utf8');
  const parsed = parseYaml(source) as { permissions?: Record<string, string> };
  // Without this, gh api .../artifacts and gh run download are denied for the
  // scheduled GITHUB_TOKEN, resolveParkedContractReceipt() silently falls
  // back to active-mode evaluation, and the scheduled production workflow
  // can never produce parked_verified -- exactly the false-RED condition
  // this lane exists to eliminate.
  assert.equal(parsed.permissions?.['actions'], 'read');
});
