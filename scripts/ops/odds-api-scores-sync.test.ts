/**
 * WORK-2026111102 -- `pnpm results:odds-api-scores` operator CLI.
 *
 * Plan tests 25-28 (`.ops/work/WORK-2026111102.md` "Tests").
 *
 * Written ahead of the implementation. The suite loads the CLI module at runtime
 * and skips with "not implemented yet" until `scripts/ops/odds-api-scores-sync.ts`
 * exists, so this file runs green on a branch where the source is absent.
 *
 * Contract these tests pin (the implementation must satisfy it, or the test is
 * updated in the same commit with a stated reason). Importing the module must
 * not run the CLI (main is guarded by the `process.argv[1] === import.meta.url`
 * pattern used in `scripts/ops/track-only-report.ts`).
 *
 *   runOddsApiScoresSync(deps: {
 *     argv: string[];                                  // process.argv.slice(2)
 *     env: Record<string, string | undefined>;         // never read from process.env in tests
 *     fetchImpl: typeof fetch;                         // the only route to the vendor
 *     createRepositories: () => IngestorRepositoryBundle; // called only after every guard passes
 *     now?: () => Date;
 *     log: (line: string) => void;                     // stdout: the JSON report
 *     error: (line: string) => void;                   // stderr: usage and refusal messages
 *   }) -> Promise<{ exitCode: number; report: OddsApiScoresSyncReport | null }>
 *
 *   OddsApiScoresSyncReport = {
 *     mode: 'dry-run' | 'apply'; wroteNothing: boolean;
 *     blastRadius: DryRunReport | null;                // from createDryRunIngestorRepositoryBundle
 *     quota: { remaining: number | null; used: number | null; last: number | null };
 *     decisions: Array<{ eventId: string | null; status: string; reason: string | null }>;
 *     summary: unknown;
 *   }
 *
 * No network: fetch is injected and asserted. No API key: only dummy literals.
 * No database: repositories are the in-memory bundle.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { IngestorRepositoryBundle, ParticipantRow } from '@unit-talk/db';
import { createInMemoryIngestorRepositoryBundle, InMemoryParticipantRepository } from '@unit-talk/db';

import { INGESTOR_WRITE_SURFACE } from '../../apps/ingestor/src/write-surface.ts';

const PRODUCTION_URL = 'https://zfzdnfwdarxucxtaojxm.supabase.co';
/** Any non-production ref; the CLI's own staging check is not asserted here. */
const NON_PRODUCTION_URL = 'https://stagingrefnotproduction.supabase.co';
const NOW = new Date('2026-11-09T12:00:00Z');

const FIXTURE_DIR = new URL('../../apps/ingestor/src/__fixtures__/odds-api-scores/', import.meta.url);
const fixturePath = (name: string) => fileURLToPath(new URL(`${name}.doc-derived.json`, FIXTURE_DIR));

/**
 * Canonical teams for the fixtures these tests run, keyed by the production-style
 * external id (`UPPER(name, non-alphanumerics to "_") + "_" + league`) the team map
 * uses for these six teams.
 */
const CANONICAL_TEAMS: Array<[string, string]> = [
  ['NBA', 'Sacramento Kings'],
  ['NBA', 'Oklahoma City Thunder'],
  ['NHL', 'Winnipeg Jets'],
  ['NHL', 'Florida Panthers'],
];

function canonicalTeamRows(): ParticipantRow[] {
  const at = '2026-11-01T00:00:00.000Z';
  return CANONICAL_TEAMS.map(([league, name], index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    display_name: name,
    external_id: `${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_${league}`,
    league,
    metadata: {},
    participant_type: 'team',
    sport: league,
    created_at: at,
    updated_at: at,
  }));
}

// ---------------------------------------------------------------------------
// Runtime loading of the not-yet-implemented CLI
// ---------------------------------------------------------------------------

interface SyncReport {
  mode: 'dry-run' | 'apply';
  wroteNothing: boolean;
  blastRadius: { writes: unknown[] } | null;
  quota: { remaining: number | null; used: number | null; last: number | null };
  decisions: Array<{ eventId: string | null; status: string; reason: string | null }>;
}

interface SyncDeps {
  argv: string[];
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  createRepositories: () => IngestorRepositoryBundle;
  now?: () => Date;
  log: (line: string) => void;
  error: (line: string) => void;
}

interface SyncModule {
  runOddsApiScoresSync(deps: SyncDeps): Promise<{ exitCode: number; report: SyncReport | null }>;
}

// The root package is CommonJS for tsx, so no top-level await: existence decides the
// skip synchronously, and the module is imported in the suite's `before` hook. Once the
// file exists, a missing or misnamed export fails the suite rather than skipping it.
const CLI_FILE = new URL('./odds-api-scores-sync.ts', import.meta.url);
const CLI_SPECIFIER = './odds-api-scores-sync.ts';
const CLI_SKIP = existsSync(CLI_FILE)
  ? false
  : 'not implemented yet: scripts/ops/odds-api-scores-sync.ts (WORK-2026111102)';
let cli: SyncModule | null = null;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  deps: SyncDeps;
  fetchCalls: string[];
  repositoryFactoryCalls: number;
  repositoryCalls: string[];
  writes: string[];
  stdout: string[];
  stderr: string[];
}

function createHarness(argv: string[], env: Record<string, string | undefined>): Harness {
  const h: Harness = {
    deps: undefined as unknown as SyncDeps,
    fetchCalls: [],
    repositoryFactoryCalls: 0,
    repositoryCalls: [],
    writes: [],
    stdout: [],
    stderr: [],
  };
  const fetchImpl = (async (input: string | URL | Request) => {
    h.fetchCalls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const createRepositories = () => {
    h.repositoryFactoryCalls += 1;
    const bundle: IngestorRepositoryBundle = {
      ...createInMemoryIngestorRepositoryBundle(),
      participants: new InMemoryParticipantRepository(canonicalTeamRows()),
    };
    const wrapped: Record<string, unknown> = {};
    for (const [name, repo] of Object.entries(bundle) as Array<[string, object]>) {
      wrapped[name] = new Proxy(repo, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver) as unknown;
          if (typeof value !== 'function') return value;
          const key = `${name}.${String(prop)}`;
          return (...args: unknown[]) => {
            h.repositoryCalls.push(key);
            if (key in INGESTOR_WRITE_SURFACE) h.writes.push(key);
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
    }
    return wrapped as unknown as IngestorRepositoryBundle;
  };

  h.deps = {
    argv,
    env,
    fetchImpl,
    createRepositories,
    now: () => NOW,
    log: (line) => h.stdout.push(line),
    error: (line) => h.stderr.push(line),
  };
  return h;
}

async function runCli(argv: string[], env: Record<string, string | undefined> = { SUPABASE_URL: NON_PRODUCTION_URL }) {
  assert.ok(cli);
  const h = createHarness(argv, env);
  const result = await cli.runOddsApiScoresSync(h.deps);
  return { h, ...result };
}

// ---------------------------------------------------------------------------
// CLI (plan tests 25-28)
// ---------------------------------------------------------------------------

test('WORK-2026111102 results:odds-api-scores CLI', { skip: CLI_SKIP }, () => {
  before(async () => {
    const mod = (await import(CLI_SPECIFIER)) as Partial<SyncModule>;
    assert.equal(typeof mod.runOddsApiScoresSync, 'function', 'runOddsApiScoresSync is exported');
    cli = mod as SyncModule;
  });

  await test('25. no --apply: zero writes, blast-radius report printed', async () => {
    const { h, exitCode, report } = await runCli(['--league', 'NBA', '--fixture', fixturePath('nba-final')]);
    assert.equal(exitCode, 0, h.stderr.join('\n'));
    assert.deepEqual(h.writes, [], 'the underlying repositories saw no write');
    assert.ok(report);
    assert.equal(report.mode, 'dry-run');
    assert.equal(report.wroteNothing, true);
    assert.ok(report.blastRadius, 'blast radius present');
    assert.ok(report.blastRadius.writes.length > 0, 'a final fixture would have written rows');
    assert.equal(report.decisions.length, 1);
    assert.equal(report.decisions[0]?.status, 'final');
    const printed = h.stdout.join('\n');
    assert.match(printed, /blastRadius/);
    assert.match(printed, /"remaining"/, 'credits are printed on every run');
  });

  await test('25b. fixture runs print null credits rather than a guess', async () => {
    const { report } = await runCli(['--league', 'NBA', '--fixture', fixturePath('nba-final')]);
    assert.deepEqual(report?.quota, { remaining: null, used: null, last: null });
  });

  await test('25c. dry run of the equal-score NHL shootout fixture reports zero result writes', async () => {
    const { report } = await runCli(['--league', 'NHL', '--fixture', fixturePath('nhl-shootout-equal-scores')]);
    assert.ok(report?.blastRadius);
    const resultWrites = (report.blastRadius.writes as Array<{ table: string }>).filter(
      (w) => w.table === 'game_results',
    );
    assert.equal(resultWrites.length, 0);
    assert.equal(report.decisions[0]?.reason, 'tie_not_possible');
  });

  await test('26. --apply against the production ref exits non-zero before any read or write', async () => {
    for (const source of ['--fixture', '--live'] as const) {
      const argv =
        source === '--fixture'
          ? ['--league', 'NBA', '--fixture', fixturePath('nba-final'), '--apply']
          : ['--league', 'NBA', '--days-from', '1', '--live', '--apply'];
      const { h, exitCode } = await runCli(argv, {
        SUPABASE_URL: PRODUCTION_URL,
        ODDS_API_KEY: 'dummy-not-a-key',
      });
      assert.notEqual(exitCode, 0, source);
      assert.equal(h.repositoryFactoryCalls, 0, `${source}: no repository constructed`);
      assert.deepEqual(h.repositoryCalls, [], `${source}: no read or write`);
      assert.deepEqual(h.fetchCalls, [], `${source}: vendor not contacted`);
      assert.match(h.stderr.join('\n'), /production/i);
    }
  });

  await test('26b. there is no override flag for production apply', async () => {
    for (const flag of ['--force', '--allow-production', '--i-know']) {
      const { h, exitCode } = await runCli(
        ['--league', 'NBA', '--fixture', fixturePath('nba-final'), '--apply', flag],
        { SUPABASE_URL: PRODUCTION_URL },
      );
      assert.notEqual(exitCode, 0, flag);
      assert.deepEqual(h.repositoryCalls, [], flag);
    }
  });

  await test('27. neither --fixture nor --live: one usage error listing every problem', async () => {
    const { h, exitCode } = await runCli(['--days-from', '7']);
    assert.notEqual(exitCode, 0);
    assert.equal(h.repositoryFactoryCalls, 0);
    assert.deepEqual(h.fetchCalls, []);
    const message = h.stderr.join('\n');
    assert.match(message, /--league/, 'missing league reported');
    assert.match(message, /--fixture/, 'missing source reported');
    assert.match(message, /--live/);
    assert.match(message, /--days-from/, 'bad days-from reported in the same message');
    assert.match(message, /results:odds-api-scores --league/, 'full corrected invocation shown');
  });

  await test('27b. both --fixture and --live is a usage error', async () => {
    const { h, exitCode } = await runCli(
      ['--league', 'NBA', '--fixture', fixturePath('nba-final'), '--live'],
      { SUPABASE_URL: NON_PRODUCTION_URL, ODDS_API_KEY: 'dummy-not-a-key' },
    );
    assert.notEqual(exitCode, 0);
    assert.deepEqual(h.fetchCalls, []);
    assert.equal(h.repositoryFactoryCalls, 0);
  });

  await test('27c. --live without ODDS_API_KEY fails with no request', async () => {
    const { h, exitCode } = await runCli(['--league', 'NBA', '--days-from', '1', '--live'], {
      SUPABASE_URL: NON_PRODUCTION_URL,
    });
    assert.notEqual(exitCode, 0);
    assert.deepEqual(h.fetchCalls, []);
    assert.match(h.stderr.join('\n'), /ODDS_API_KEY/);
  });

  await test('27d. unknown league is a usage error', async () => {
    const { h, exitCode } = await runCli(['--league', 'WNBA', '--fixture', fixturePath('nba-final')]);
    assert.notEqual(exitCode, 0);
    assert.equal(h.repositoryFactoryCalls, 0);
  });

  await test('28. --fixture makes no network call', async () => {
    const { h, exitCode } = await runCli(['--league', 'NBA', '--fixture', fixturePath('nba-final')], {
      SUPABASE_URL: NON_PRODUCTION_URL,
      ODDS_API_KEY: 'dummy-not-a-key',
    });
    assert.equal(exitCode, 0, h.stderr.join('\n'));
    assert.deepEqual(h.fetchCalls, [], 'injected fetch saw zero calls even with a key present');
  });

  await test('28b. --apply against a non-production ref writes and opens a system_runs row', async () => {
    const { h, exitCode, report } = await runCli(
      ['--league', 'NBA', '--fixture', fixturePath('nba-final'), '--apply'],
      { SUPABASE_URL: NON_PRODUCTION_URL },
    );
    assert.equal(exitCode, 0, h.stderr.join('\n'));
    assert.equal(report?.mode, 'apply');
    assert.ok(h.writes.includes('runs.startRun'), 'run opened');
    assert.ok(h.writes.includes('runs.completeRun'), 'run completed');
    assert.ok(h.writes.includes('gradeResults.insert'));
    assert.ok(
      h.writes.indexOf('runs.startRun') < h.writes.indexOf('events.upsertByExternalId'),
      'run opened before any event write',
    );
    assert.deepEqual(h.fetchCalls, []);
  });

  await test.todo(
    '28c. applied run row carries run_type odds-api-scores.operator-run, opened as failed and upgraded on completion (assert startRun/completeRun arguments once the run-row shape is implemented)',
  );
});
