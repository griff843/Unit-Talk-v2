/**
 * WORK-2026111102 test 38. CI-only staging persistence and Track Only journey.
 * No vendor credential or request; fixtures are explicitly doc-derived.
 * New event/pick identities are derived from CI_FIXTURE_RUN_ID. Canonical teams
 * are shared reference identities required by the static map, never renamed.
 * No cleanup mutates the append-only settlement/audit history.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseRepositoryBundle,
  createDatabaseIngestorRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { isApprovedStagingTarget } from '@unit-talk/db/target-identity';

import { ODDS_API_SCORES_TEAM_MAP } from '../../../apps/ingestor/src/odds-api-scores-team-map.js';
import type { ScoresEvent } from '../../../apps/ingestor/src/odds-api-scores-parser.js';
import { processSubmission } from '../../../apps/api/src/submission-service.js';
import { runGradingPass } from '../../../apps/api/src/grading-service.js';
import { runOddsApiScoresSync } from '../odds-api-scores-sync.js';

const namespace = process.env['CI_FIXTURE_RUN_ID'];

test(
  'WORK-2026111102 38. fixture to staging results to Track Only settlement, with no delivery',
  {
    skip: namespace
      ? false
      : 'CI-only staging proof; CI_FIXTURE_RUN_ID is absent',
  },
  async () => {
    // This loader is reached only in the staging CI job, never in local tests.
    const env = loadEnvironment();
    assert.ok(
      isApprovedStagingTarget(env.SUPABASE_URL),
      'Proof refuses any target other than approved staging',
    );
    assert.ok(
      env.SUPABASE_SERVICE_ROLE_KEY,
      'CI proof requires staging credentials; missing credentials must fail',
    );
    const connection = createServiceRoleDatabaseConnectionConfig(env);
    const repositories = createDatabaseRepositoryBundle(connection);
    const ingestor = createDatabaseIngestorRepositoryBundle(connection);
    const previousUrl = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = env.SUPABASE_URL;
    const directory = await mkdtemp(join(tmpdir(), 'odds-api-scores-proof-'));
    try {
      const fixtureText = await readFile(
        new URL(
          '../../../apps/ingestor/src/__fixtures__/odds-api-scores/nba-final.doc-derived.json',
          import.meta.url,
        ),
        'utf8',
      );
      // Injected transport supplies the documented response, with no external I/O.
      const fixtureFetch: typeof fetch = async () =>
        new Response(fixtureText, { status: 200 });
      const fixture = (await (
        await fixtureFetch('https://fixture.invalid/scores')
      ).json()) as {
        provenance: string;
        league: 'NBA';
        evaluateAt: string;
        response: ScoresEvent[];
      };
      const input = fixture.response[0]!;
      input.id = createHash('sha256')
        .update(`WORK-2026111102:${namespace}`)
        .digest('hex')
        .slice(0, 32);
      // Canonical reference teams use the exact static-map ids. Only create a
      // missing staging reference row; never overwrite an existing canonical team.
      for (const name of [input.home_team, input.away_team]) {
        const externalId = ODDS_API_SCORES_TEAM_MAP.NBA[name]!;
        if (!(await repositories.participants.findByExternalId(externalId))) {
          await repositories.participants.upsertByExternalId({
            externalId,
            displayName: name,
            participantType: 'team',
            sport: 'NBA',
            league: 'NBA',
            metadata: {
              fixtureProvenance: 'doc-derived',
              fixtureRunId: namespace,
            },
          });
        }
      }
      const fixturePath = join(directory, 'nba-final.doc-derived.json');
      await writeFile(fixturePath, JSON.stringify(fixture));
      let vendorCalls = 0;
      const vendorForbidden: typeof fetch = async () => {
        vendorCalls++;
        throw new Error('Vendor contact forbidden');
      };
      const run = (apply: boolean) =>
        runOddsApiScoresSync({
          argv: [
            '--league',
            'NBA',
            '--fixture',
            fixturePath,
            ...(apply ? ['--apply'] : []),
          ],
          env: { SUPABASE_URL: env.SUPABASE_URL },
          fetchImpl: vendorForbidden,
          createRepositories: () => ingestor,
          now: () => new Date(fixture.evaluateAt),
          log: () => {},
          error: (message) => assert.fail(message),
        });
      const dry = await run(false);
      assert.equal(dry.exitCode, 0);
      assert.ok(dry.report?.wroteNothing);
      assert.equal(await repositories.events.findByExternalId(input.id), null);
      const applied = await run(true);
      assert.equal(applied.exitCode, 0);
      const event = await repositories.events.findByExternalId(input.id);
      assert.ok(event);
      assert.equal(event.status, 'completed');
      const links = await repositories.eventParticipants.listByEvent(event.id);
      const results = await repositories.gradeResults.listByEvent(event.id);
      const rowsByTable = new Map(
        dry.report!.blastRadius!.byTable.map((r) => [r.table, r.count]),
      );
      assert.equal(rowsByTable.get('events'), 1);
      assert.equal(rowsByTable.get('event_participants'), links.length);
      assert.equal(rowsByTable.get('game_results'), results.length);
      assert.equal(results.length, 7);
      assert.ok(results.every((r) => r.source === 'odds-api'));
      assert.deepEqual([...new Set(results.map((r) => r.market_key))].sort(), [
        'game_moneyline_win',
        'game_spread_margin',
        'game_total_ou',
        'team_total_ou',
      ]);
      for (const link of links)
        assert.ok(
          await repositories.participants.findById(link.participant_id),
        );
      const second = await run(true);
      assert.equal(second.exitCode, 0);
      assert.equal(second.report?.summary.eventsUpserted, 0);
      assert.equal(second.report?.summary.resultsInserted, 0);
      assert.deepEqual(await repositories.events.findById(event.id), event);
      assert.deepEqual(
        await repositories.gradeResults.listByEvent(event.id),
        results,
      );
      assert.deepEqual(
        await repositories.eventParticipants.listByEvent(event.id),
        links,
      );
      const created = await processSubmission(
        {
          source: 'api',
          market: 'game_total_ou',
          selection: `Over 215.5 [WORK-2026111102:${namespace}]`,
          line: 215.5,
          odds: -110,
          stakeUnits: 1,
          eventName: event.event_name,
          metadata: {
            distributionMode: 'track-only',
            sport: 'NBA',
            eventId: event.id,
            fixtureRunId: namespace,
            fixtureProvenance: 'doc-derived',
          },
        },
        repositories,
      );
      const pickId = created.pick.id;
      assert.equal(
        await repositories.settlements.findLatestForPick(pickId),
        null,
      );
      const grade = await runGradingPass(repositories, {
        restrictToPickIds: new Set([pickId]),
        now: () => new Date(fixture.evaluateAt),
      });
      assert.equal(grade.errors, 0, JSON.stringify(grade.details));
      assert.equal(grade.graded, 1, JSON.stringify(grade.details));
      const settlement =
        await repositories.settlements.findLatestForPick(pickId);
      assert.equal(
        settlement?.result,
        'win',
        '113 + 103 = 216, which exceeds 215.5; outcome is derived',
      );
      assert.equal(
        (await repositories.picks.findPickById(pickId))?.status,
        'validated',
      );
      assert.deepEqual(await repositories.outbox.listByPickId(pickId), []);
      assert.equal(vendorCalls, 0);
      const replay = await runGradingPass(repositories, {
        restrictToPickIds: new Set([pickId]),
        now: () => new Date(fixture.evaluateAt),
      });
      assert.equal(replay.graded, 0);
      assert.equal(
        (await repositories.settlements.listByPick(pickId)).length,
        1,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
      if (previousUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = previousUrl;
    }
  },
);
