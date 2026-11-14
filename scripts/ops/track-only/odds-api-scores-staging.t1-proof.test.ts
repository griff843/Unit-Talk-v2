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
  async (t) => {
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
      // One uncompleted write, followed by the completing write.
      assert.equal(rowsByTable.get('events'), 2);
      assert.deepEqual(dry.report!.blastRadius!.newEventExternalIds, [
        input.id,
      ]);
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
      const teams = {
        home: await repositories.participants.findById(
          links.find((link) => link.role === 'home')!.participant_id,
        ),
        away: await repositories.participants.findById(
          links.find((link) => link.role === 'away')!.participant_id,
        ),
      };
      assert.ok(teams.home);
      assert.ok(teams.away);
      assert.equal(
        teams.home.external_id,
        ODDS_API_SCORES_TEAM_MAP.NBA[input.home_team],
      );
      assert.equal(
        teams.away.external_id,
        ODDS_API_SCORES_TEAM_MAP.NBA[input.away_team],
      );
      const cases: Array<{
        market: string;
        selection: string;
        line?: number;
        side?: 'home' | 'away';
        expected: 'win' | 'loss' | 'push';
        arithmetic: string;
      }> = [
        {
          market: 'game_total_ou',
          selection: 'Over 215.5',
          line: 215.5,
          expected: 'win',
          arithmetic:
            '113 + 103 = 216, which exceeds 215.5; outcome is derived',
        },
        {
          market: 'game_total_ou',
          selection: 'Under 215.5',
          line: 215.5,
          expected: 'loss',
          arithmetic: '113 + 103 = 216 > 215.5, so Under loses',
        },
        {
          market: 'moneyline',
          selection: 'Sacramento Kings',
          side: 'home',
          expected: 'win',
          arithmetic: 'Kings 113 > Thunder 103, so Kings moneyline wins',
        },
        {
          market: 'moneyline',
          selection: 'Oklahoma City Thunder',
          side: 'away',
          expected: 'loss',
          arithmetic: 'Thunder 103 < Kings 113, so Thunder moneyline loses',
        },
        {
          market: 'spread',
          selection: 'Sacramento Kings -5.5',
          line: -5.5,
          side: 'home',
          expected: 'win',
          arithmetic: 'Kings margin 113 - 103 = 10; 10 - 5.5 = 4.5 > 0 wins',
        },
        {
          market: 'spread',
          selection: 'Oklahoma City Thunder +5.5',
          line: 5.5,
          side: 'away',
          expected: 'loss',
          arithmetic:
            'Thunder margin 103 - 113 = -10; -10 + 5.5 = -4.5 < 0 loses',
        },
        {
          market: 'spread',
          selection: 'Sacramento Kings -10',
          line: -10,
          side: 'home',
          expected: 'push',
          arithmetic: 'Kings margin 113 - 103 = 10; 10 - 10 = 0 pushes',
        },
        {
          market: 'team_total_ou',
          selection: 'Sacramento Kings Over 110.5',
          line: 110.5,
          side: 'home',
          expected: 'win',
          arithmetic: 'Kings 113 > 110.5, so Kings Over wins',
        },
        {
          market: 'team_total_ou',
          selection: 'Oklahoma City Thunder Over 110.5',
          line: 110.5,
          side: 'away',
          expected: 'loss',
          arithmetic: 'Thunder 103 < 110.5, so Thunder Over loses',
        },
      ];
      const submitted: Array<{
        scenario: (typeof cases)[number];
        pickId: string;
      }> = [];
      for (const scenario of cases) {
        const team = scenario.side ? teams[scenario.side] : null;
        // participantId persists the canonical FK through submission; teamId is
        // also understood by grading. Game totals deliberately have neither.
        const created = await processSubmission(
          {
            source: 'api',
            market: scenario.market,
            selection: `${scenario.selection} [WORK-2026111102:${namespace}]`,
            ...(scenario.line === undefined ? {} : { line: scenario.line }),
            odds: -110,
            stakeUnits: 1,
            eventName: event.event_name,
            metadata: {
              distributionMode: 'track-only',
              sport: 'NBA',
              eventId: event.id,
              fixtureRunId: namespace,
              fixtureProvenance: 'doc-derived',
              ...(team
                ? {
                    participantId: team.id,
                    teamId: team.id,
                    team: team.display_name,
                    participantResolution: {
                      resolution: 'canonical',
                      sportId: 'NBA',
                      eventId: event.id,
                      team: {
                        participantId: team.id,
                        displayName: team.display_name,
                        participantType: 'team',
                      },
                    },
                  }
                : {}),
            },
          },
          repositories,
        );
        const pickId = created.pick.id;
        const persistedPick = await repositories.picks.findPickById(pickId);
        assert.ok(persistedPick);
        assert.equal(persistedPick.participant_id, team?.id ?? null);
        assert.equal(
          await repositories.settlements.findLatestForPick(pickId),
          null,
        );
        submitted.push({ scenario, pickId });
      }
      // Batch the nine cases; each restricted pass loads only these pick ids
      // and reapplies the normal lifecycle and Track Only admission rules.
      const restrictToPickIds = new Set(submitted.map(({ pickId }) => pickId));
      assert.equal(restrictToPickIds.size, cases.length);
      const gradingStartedAt = performance.now();
      const grade = await runGradingPass(repositories, {
        restrictToPickIds,
        now: () => new Date(fixture.evaluateAt),
      });
      t.diagnostic(
        `Batched grading elapsed ms: ${performance.now() - gradingStartedAt}`,
      );
      assert.equal(grade.errors, 0, JSON.stringify(grade.details));
      assert.equal(grade.graded, 9, JSON.stringify(grade.details));
      const settlementsByPick = new Map<
        string,
        Awaited<ReturnType<typeof repositories.settlements.listByPick>>
      >();
      for (const { scenario, pickId } of submitted) {
        await t.test(
          `${scenario.market}: ${scenario.selection} -> ${scenario.expected}`,
          async () => {
            const settlement =
              await repositories.settlements.findLatestForPick(pickId);
            assert.equal(
              settlement?.result,
              scenario.expected,
              scenario.arithmetic,
            );
            const settlements =
              await repositories.settlements.listByPick(pickId);
            assert.equal(settlements.length, 1, scenario.arithmetic);
            settlementsByPick.set(pickId, settlements);
            assert.equal(
              (await repositories.picks.findPickById(pickId))?.status,
              'validated',
            );
            assert.deepEqual(
              await repositories.outbox.listByPickId(pickId),
              [],
            );
            assert.equal(vendorCalls, 0);
          },
        );
      }
      const replayStartedAt = performance.now();
      const replay = await runGradingPass(repositories, {
        restrictToPickIds,
        now: () => new Date(fixture.evaluateAt),
      });
      t.diagnostic(
        `Replay grading elapsed ms: ${performance.now() - replayStartedAt}`,
      );
      assert.equal(replay.errors, 0, JSON.stringify(replay.details));
      assert.equal(replay.graded, 0);
      for (const { scenario, pickId } of submitted) {
        assert.equal(
          (await repositories.settlements.listByPick(pickId)).length,
          1,
          scenario.arithmetic,
        );
        assert.deepEqual(
          await repositories.settlements.listByPick(pickId),
          settlementsByPick.get(pickId),
          scenario.arithmetic,
        );
        assert.deepEqual(await repositories.outbox.listByPickId(pickId), []);
      }
      // Exercise durable interruption recovery on a second namespaced game.
      const partialFixture = structuredClone(fixture);
      const partialInput = partialFixture.response[0]!;
      partialInput.id = createHash('sha256')
        .update(`WORK-2026111102:${namespace}:partial`)
        .digest('hex')
        .slice(0, 32);
      const partialPath = join(directory, 'nba-partial.doc-derived.json');
      await writeFile(partialPath, JSON.stringify(partialFixture));
      const errors: string[] = [];
      let interruptionObserved = false;
      const partialRun = (failAfter?: number) => {
        let inserted = 0;
        interruptionObserved = false;
        const faulty: typeof ingestor.gradeResults = {
          listByEvent: (id) => ingestor.gradeResults.listByEvent(id),
          findResult: (criteria) => ingestor.gradeResults.findResult(criteria),
          insert: async (value) => {
            if (inserted === failAfter) {
              interruptionObserved = true;
              throw new Error('injected interruption');
            }
            const row = await ingestor.gradeResults.insert(value);
            inserted++;
            return row;
          },
        };
        return runOddsApiScoresSync({
          argv: ['--league', 'NBA', '--fixture', partialPath, '--apply'],
          env: { SUPABASE_URL: env.SUPABASE_URL },
          fetchImpl: vendorForbidden,
          createRepositories: () => ({ ...ingestor, gradeResults: faulty }),
          now: () => new Date(fixture.evaluateAt),
          log: () => {},
          error: (message) => {
            errors.push(message);
          },
        });
      };
      assert.equal((await partialRun(1)).exitCode, 1);
      assert.equal(
        interruptionObserved,
        true,
        'the intended insert fault fired',
      );
      assert.equal(errors.at(-1), 'Scores sync failed (Error).');
      const partialEvent = await repositories.events.findByExternalId(
        partialInput.id,
      );
      assert.ok(partialEvent);
      assert.notEqual(partialEvent.status, 'completed');
      assert.equal(partialEvent.metadata['resultsProof'], undefined);
      assert.equal(
        (await repositories.gradeResults.listByEvent(partialEvent.id)).length,
        1,
      );
      const partialSubmission = await processSubmission(
        {
          source: 'api',
          market: 'game_total_ou',
          selection: `Over 215.5 [WORK-2026111102:${namespace}:partial]`,
          line: 215.5,
          odds: -110,
          stakeUnits: 1,
          eventName: partialEvent.event_name,
          metadata: {
            distributionMode: 'track-only',
            sport: 'NBA',
            eventId: partialEvent.id,
            fixtureRunId: namespace,
            fixtureProvenance: 'doc-derived',
          },
        },
        repositories,
      );
      const partialPickId = partialSubmission.pick.id;
      const gradePartial = async (label: string) => {
        const startedAt = performance.now();
        const result = await runGradingPass(repositories, {
          restrictToPickIds: new Set([partialPickId]),
          now: () => new Date(fixture.evaluateAt),
        });
        t.diagnostic(
          `${label} grading elapsed ms: ${performance.now() - startedAt}`,
        );
        assert.equal(result.errors, 0, JSON.stringify(result.details));
        return result;
      };
      const uncompleted = await gradePartial('After first interrupted write');
      assert.equal(uncompleted.graded, 0);
      assert.equal(uncompleted.details[0]?.reason, 'event_not_completed');
      assert.deepEqual(
        await repositories.settlements.listByPick(partialPickId),
        [],
      );
      assert.deepEqual(
        await repositories.outbox.listByPickId(partialPickId),
        [],
      );
      assert.equal((await partialRun(3)).exitCode, 1);
      assert.equal(
        interruptionObserved,
        true,
        'the intended insert fault fired',
      );
      assert.equal(errors.at(-1), 'Scores sync failed (Error).');
      const midEvent = await repositories.events.findById(partialEvent.id);
      assert.notEqual(midEvent?.status, 'completed');
      assert.equal(midEvent?.metadata['resultsProof'], undefined);
      assert.equal(
        (await repositories.gradeResults.listByEvent(partialEvent.id)).length,
        4,
      );
      const midGrade = await gradePartial('After mid-sequence interruption');
      assert.equal(midGrade.graded, 0);
      assert.equal(midGrade.details[0]?.reason, 'event_not_completed');
      assert.deepEqual(
        await repositories.settlements.listByPick(partialPickId),
        [],
      );
      assert.deepEqual(
        await repositories.outbox.listByPickId(partialPickId),
        [],
      );
      const resumed = await partialRun();
      assert.equal(resumed.exitCode, 0);
      assert.equal(resumed.report?.summary.resultsInserted, 3);
      const completeEvent = await repositories.events.findById(partialEvent.id);
      assert.equal(completeEvent?.status, 'completed');
      const proof = completeEvent?.metadata['resultsProof'] as Record<
        string,
        unknown
      >;
      assert.equal(proof['completedObserved'], true);
      const completeRows = await repositories.gradeResults.listByEvent(
        partialEvent.id,
      );
      assert.equal(completeRows.length, 7);
      assert.ok(
        completeRows.every(
          (row) =>
            row.source === 'odds-api' &&
            Date.parse(row.sourced_at) ===
              Date.parse(partialInput.last_update!),
        ),
      );
      const reapplied = await partialRun();
      assert.equal(reapplied.exitCode, 0);
      assert.equal(reapplied.report?.summary.eventsUpserted, 0);
      assert.equal(reapplied.report?.summary.resultsInserted, 0);
      assert.deepEqual(
        await repositories.events.findById(partialEvent.id),
        completeEvent,
      );
      assert.deepEqual(
        await repositories.gradeResults.listByEvent(partialEvent.id),
        completeRows,
      );
      const recoveredGrade = await gradePartial('Recovered event');
      assert.equal(
        recoveredGrade.graded,
        1,
        JSON.stringify(recoveredGrade.details),
      );
      const recoveredSettlements =
        await repositories.settlements.listByPick(partialPickId);
      assert.equal(recoveredSettlements.length, 1);
      assert.equal(
        recoveredSettlements[0]?.result,
        'win',
        '113 + 103 = 216 > 215.5, so Over wins',
      );
      assert.equal(
        (await repositories.picks.findPickById(partialPickId))?.status,
        'validated',
      );
      assert.deepEqual(
        await repositories.outbox.listByPickId(partialPickId),
        [],
      );
      assert.equal((await gradePartial('Recovered event replay')).graded, 0);
      assert.deepEqual(
        await repositories.settlements.listByPick(partialPickId),
        recoveredSettlements,
      );
      assert.deepEqual(
        await repositories.outbox.listByPickId(partialPickId),
        [],
      );
      assert.equal(vendorCalls, 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
      if (previousUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = previousUrl;
    }
  },
);
