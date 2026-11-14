/**
 * WORK-2026111102 -- Odds API `/scores` resolver and static team map.
 *
 * Plan tests 12 (write side), 14-24 (`.ops/work/WORK-2026111102.md` "Tests").
 *
 * Written ahead of the implementation. The suites load their targets at runtime
 * and skip with "not implemented yet" until `odds-api-scores-team-map.ts`,
 * `odds-api-scores-parser.ts` and `odds-api-scores-resolver.ts` exist, so this
 * file type-checks and runs green on a branch where the source is absent.
 *
 * Contract these tests pin (the implementation must satisfy it, or the test is
 * updated in the same commit with a stated reason):
 *
 *   ODDS_API_SCORES_TEAM_MAP: Readonly<Record<'NFL'|'NBA'|'NHL'|'MLB',
 *                                             Readonly<Record<string, string>>>>
 *     // (league, exact vendor team string) -> participants.external_id
 *
 *   resolveOddsApiScores(
 *     parsed: ParsedScore[],                    // parseOddsApiScores output (each carries `event`)
 *     league: 'NFL'|'NBA'|'NHL'|'MLB',
 *     runId: string,                            // system_runs id -> metadata.ingestionCycleRunId
 *     repositories: IngestorRepositoryBundle,   // only events, eventParticipants, participants,
 *                                               // gradeResults are used
 *     context: { fetchedAt: string; payloadKind: 'live'|'fixture-doc-derived'|'fixture-recorded' },
 *   ) -> Promise<{ resultsInserted: number; skipped: Array<{ eventId: string | null; reason: string }> }>
 *
 * Writes are observed through a recording wrapper over the in-memory bundle keyed by
 * INGESTOR_WRITE_SURFACE, so "zero writes" means zero calls to any classified write.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { IngestorRepositoryBundle } from '@unit-talk/db';
import {
  createInMemoryIngestorRepositoryBundle,
  InMemoryParticipantRepository,
} from '@unit-talk/db';

import { INGESTOR_WRITE_SURFACE } from './write-surface.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type League = 'NFL' | 'NBA' | 'NHL' | 'MLB';

const FIXTURE_DIR = new URL('./__fixtures__/odds-api-scores/', import.meta.url);
const NOW = new Date('2026-11-09T12:00:00Z');
const RUN_ID = 'run-work-2026111102-test';
const CONTEXT = {
  fetchedAt: '2026-11-09T11:59:00.000Z',
  payloadKind: 'fixture-doc-derived',
} as const;
const FOUR_KEYS = [
  'game_moneyline_win',
  'game_spread_margin',
  'game_total_ou',
  'team_total_ou',
];

interface ScoreEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: Array<{ name: string; score: string }> | null;
  last_update: string | null;
}

interface FixtureEnvelope {
  league: League;
  response: ScoreEvent[];
}

function loadFixture(name: string): FixtureEnvelope {
  const file = name.endsWith('.json') ? name : `${name}.doc-derived.json`;
  return JSON.parse(
    readFileSync(new URL(file, FIXTURE_DIR), 'utf8'),
  ) as FixtureEnvelope;
}

function firstEvent(name: string): ScoreEvent {
  const event = loadFixture(name).response[0];
  assert.ok(event, `fixture ${name} has no event`);
  return structuredClone(event);
}

// ---------------------------------------------------------------------------
// Runtime loading of not-yet-implemented targets
// ---------------------------------------------------------------------------

type ParsedScore = {
  status: 'final' | 'not_final' | 'rejected';
  eventId: string | null;
};

interface ResolveSummary {
  eventsUpserted: number;
  resultsInserted: number;
  skipped: Array<{ eventId: string | null; reason: string }>;
}

interface TeamMapModule {
  ODDS_API_SCORES_TEAM_MAP: Readonly<
    Record<League, Readonly<Record<string, string>>>
  >;
}

interface ParserModule {
  parseOddsApiScores(raw: unknown, league: League, now: Date): ParsedScore[];
}

interface ResolverModule {
  resolveOddsApiScores(
    parsed: ParsedScore[],
    league: League,
    runId: string,
    repositories: IngestorRepositoryBundle,
    context: typeof CONTEXT | { fetchedAt: string; payloadKind: string },
  ): Promise<ResolveSummary>;
}

async function importIfPresent<T>(specifier: string): Promise<T | null> {
  try {
    return (await import(specifier)) as T;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND')
      return null;
    throw error;
  }
}

// Specifiers are held in variables so tsc does not resolve modules that do not exist yet.
const TEAM_MAP_SPECIFIER = './odds-api-scores-team-map.js';
const PARSER_SPECIFIER = './odds-api-scores-parser.js';
const RESOLVER_SPECIFIER = './odds-api-scores-resolver.js';

const teamMapModule = await importIfPresent<TeamMapModule>(TEAM_MAP_SPECIFIER);
const teamMap: TeamMapModule['ODDS_API_SCORES_TEAM_MAP'] | null =
  teamMapModule?.ODDS_API_SCORES_TEAM_MAP ?? null;
const parserModule = await importIfPresent<ParserModule>(PARSER_SPECIFIER);
const resolverModule =
  await importIfPresent<ResolverModule>(RESOLVER_SPECIFIER);

assert.ok(teamMap, 'static team map must be implemented');
assert.equal(typeof parserModule?.parseOddsApiScores, 'function');
assert.equal(typeof resolverModule?.resolveOddsApiScores, 'function');
const TEAM_MAP_SKIP = false;
const RESOLVER_SKIP = false;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  /** The recording bundle handed to the resolver. */
  repositories: IngestorRepositoryBundle;
  /** The unwrapped bundle, for seeding and inspection without recording. */
  raw: IngestorRepositoryBundle;
  writes: string[];
  resetWrites(): void;
}

/** Wraps every repository so each call to a classified write is recorded. */
function recordWrites(
  bundle: IngestorRepositoryBundle,
  writes: string[],
): IngestorRepositoryBundle {
  const wrapped: Record<string, unknown> = {};
  for (const [name, repo] of Object.entries(bundle) as Array<
    [string, object]
  >) {
    wrapped[name] = new Proxy(repo, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (typeof value !== 'function') return value;
        const key = `${name}.${String(prop)}`;
        return (...args: unknown[]) => {
          if (key in INGESTOR_WRITE_SURFACE) writes.push(key);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  }
  return wrapped as unknown as IngestorRepositoryBundle;
}

function externalIdFor(league: League, vendorName: string): string {
  assert.ok(teamMap);
  const id = teamMap[league][vendorName];
  assert.ok(id, `team map has no ${league} entry for ${vendorName}`);
  return id;
}

/**
 * A bundle whose participants hold exactly the canonical teams named, keyed by the
 * production-style external id the team map returns (not the in-memory seed ids).
 */
async function createHarness(teams: Array<[League, string]>): Promise<Harness> {
  const raw: IngestorRepositoryBundle = {
    ...createInMemoryIngestorRepositoryBundle(),
    participants: new InMemoryParticipantRepository(),
  };
  for (const [league, name] of teams) {
    await raw.participants.upsertByExternalId({
      externalId: externalIdFor(league, name),
      displayName: name,
      participantType: 'team',
      sport: league,
      league,
      metadata: {},
    });
  }
  const writes: string[] = [];
  return {
    raw,
    repositories: recordWrites(raw, writes),
    writes,
    resetWrites: () => writes.splice(0, writes.length),
  };
}

function teamsOf(event: ScoreEvent, league: League): Array<[League, string]> {
  return [
    [league, event.home_team],
    [league, event.away_team],
  ];
}

async function run(
  harness: Harness,
  events: ScoreEvent[],
  league: League,
  now: Date = NOW,
): Promise<ResolveSummary> {
  assert.ok(parserModule && resolverModule);
  const parsed = parserModule.parseOddsApiScores(events, league, now);
  return resolverModule.resolveOddsApiScores(
    parsed,
    league,
    RUN_ID,
    harness.repositories,
    CONTEXT,
  );
}

async function resultsFor(harness: Harness, externalId: string) {
  const event = await harness.raw.events.findByExternalId(externalId);
  if (!event) return [];
  return harness.raw.gradeResults.listByEvent(event.id);
}

async function seedForeignEvent(
  harness: Harness,
  input: {
    externalId: string;
    league: League;
    home: string;
    away: string;
    eventDate: string;
    providerKey: string;
  },
) {
  const event = await harness.raw.events.upsertByExternalId({
    externalId: input.externalId,
    sportId: input.league,
    eventName: `${input.away} @ ${input.home}`,
    eventDate: input.eventDate,
    status: 'scheduled',
    metadata: { source: input.providerKey, providerKey: input.providerKey },
  });
  for (const [name, role] of [
    [input.home, 'home'],
    [input.away, 'away'],
  ] as const) {
    const participant = await harness.raw.participants.findByExternalId(
      externalIdFor(input.league, name),
    );
    assert.ok(participant);
    await harness.raw.eventParticipants.upsert({
      eventId: event.id,
      participantId: participant.id,
      role,
    });
  }
  return event;
}

// ---------------------------------------------------------------------------
// Team map (plan tests 14, 16)
// ---------------------------------------------------------------------------

test(
  'WORK-2026111102 odds-api-scores team map',
  { skip: TEAM_MAP_SKIP },
  async (t) => {
    await t.test(
      '14. 124 entries: 30 MLB, 30 NBA, 32 NFL, 32 NHL; ids unique and league-suffixed',
      () => {
        assert.ok(teamMap);
        const expected: Record<League, number> = {
          MLB: 30,
          NBA: 30,
          NFL: 32,
          NHL: 32,
        };
        const all: string[] = [];
        for (const league of Object.keys(expected) as League[]) {
          const entries: Array<[string, string]> = Object.entries(
            teamMap[league],
          );
          assert.equal(
            entries.length,
            expected[league],
            `${league} entry count`,
          );
          for (const [vendorName, externalId] of entries) {
            assert.ok(
              externalId.endsWith(`_${league}`),
              `${league} ${vendorName} -> ${externalId}`,
            );
            assert.equal(
              vendorName,
              vendorName.trim(),
              `${vendorName}: no padding`,
            );
            all.push(externalId);
          }
        }
        assert.equal(all.length, 124);
        assert.equal(
          new Set(all).size,
          124,
          'no two vendor strings map to the same participant',
        );
      },
    );

    await t.test('14b. the six explicit production ids are present', () => {
      assert.ok(teamMap);
      const values = new Set(
        Object.values(teamMap).flatMap((m) => Object.values(m)),
      );
      for (const id of [
        'STLOUIS_CARDINALS_MLB',
        'ST_LOUIS_BLUES_NHL',
        'OAKLAND_ATHLETICS_MLB',
        'UTAH_HOCKEY_CLUB_NHL',
        'PHILADELPHIA_76ERS_NBA',
        'MONTREAL_CANADIENS_NHL',
      ]) {
        assert.ok(values.has(id), `missing explicit id ${id}`);
      }
    });

    await test.todo(
      '14c. every map entry resolves to an existing canonical team: assert against a catalog fixture generated from the production participants external-id list (read-only export; not created in this preparation pass)',
    );

    await t.test(
      '16. suffix collisions resolve only within their own league and only by full string',
      () => {
        assert.ok(teamMap);
        const collisions: Array<[string, Array<[League, string]>]> = [
          [
            'Kings',
            [
              ['NBA', 'Sacramento Kings'],
              ['NHL', 'Los Angeles Kings'],
            ],
          ],
          [
            'Jets',
            [
              ['NFL', 'New York Jets'],
              ['NHL', 'Winnipeg Jets'],
            ],
          ],
          [
            'Rangers',
            [
              ['MLB', 'Texas Rangers'],
              ['NHL', 'New York Rangers'],
            ],
          ],
          [
            'Giants',
            [
              ['NFL', 'New York Giants'],
              ['MLB', 'San Francisco Giants'],
            ],
          ],
          [
            'Cardinals',
            [
              ['NFL', 'Arizona Cardinals'],
              ['MLB', 'St. Louis Cardinals'],
            ],
          ],
          [
            'Panthers',
            [
              ['NFL', 'Carolina Panthers'],
              ['NHL', 'Florida Panthers'],
            ],
          ],
        ];
        const leagues: League[] = ['MLB', 'NBA', 'NFL', 'NHL'];
        for (const [suffix, owners] of collisions) {
          for (const league of leagues) {
            assert.equal(
              teamMap[league][suffix],
              undefined,
              `${league} must not map bare "${suffix}"`,
            );
            assert.equal(teamMap[league][suffix.toLowerCase()], undefined);
          }
          for (const [ownLeague, fullName] of owners) {
            // Exact full string resolves in its own league ...
            assert.ok(
              teamMap[ownLeague][fullName],
              `${ownLeague} ${fullName} must resolve`,
            );
            assert.ok(teamMap[ownLeague][fullName]!.endsWith(`_${ownLeague}`));
            // ... and nowhere else.
            for (const other of leagues.filter((l) => l !== ownLeague)) {
              assert.equal(
                teamMap[other][fullName],
                undefined,
                `${fullName} must not resolve in ${other}`,
              );
            }
            // Case and whitespace variants do not resolve.
            assert.equal(teamMap[ownLeague][fullName.toUpperCase()], undefined);
            assert.equal(teamMap[ownLeague][` ${fullName}`], undefined);
          }
        }
      },
    );
  },
);

// ---------------------------------------------------------------------------
// Resolver (plan tests 12, 15, 17-24)
// ---------------------------------------------------------------------------

test(
  'WORK-2026111102 resolveOddsApiScores',
  { skip: RESOLVER_SKIP },
  async (t) => {
    await t.test(
      'final event: row, roles, metadata and the four result keys',
      async () => {
        const event = firstEvent('nba-final');
        const h = await createHarness(teamsOf(event, 'NBA'));
        const summary = await run(h, [event], 'NBA');

        assert.equal(summary.skipped.length, 0);
        const row = await h.raw.events.findByExternalId(event.id);
        assert.ok(row, 'event upserted under the vendor id unchanged');
        assert.equal(row.status, 'completed');
        assert.equal(
          row.event_name,
          'Oklahoma City Thunder @ Sacramento Kings',
        );
        assert.equal(
          row.event_date,
          '2026-11-07',
          'Eastern date of 2026-11-08T00:10Z',
        );

        const meta = row.metadata as Record<string, unknown>;
        assert.equal(meta['source'], 'odds-api');
        assert.equal(meta['providerKey'], 'odds-api');
        assert.equal(meta['ingestionSource'], 'odds-api-scores.operator-run');
        assert.equal(meta['ingestionCycleRunId'], RUN_ID);
        assert.equal(meta['sport_key'], 'basketball_nba');
        assert.equal(meta['home_team_name'], 'Sacramento Kings');
        assert.equal(meta['away_team_name'], 'Oklahoma City Thunder');
        assert.equal(
          Date.parse(String(meta['starts_at'])),
          Date.parse(event.commence_time),
        );
        const proof = meta['resultsProof'] as Record<string, unknown>;
        assert.equal(proof['matchMethod'], 'static-team-map');
        assert.equal(proof['providerEventId'], event.id);
        assert.equal(
          Date.parse(String(proof['providerLastUpdate'])),
          Date.parse(event.last_update!),
        );
        assert.equal(proof['fetchedAt'], CONTEXT.fetchedAt);
        assert.equal(proof['completedObserved'], true);
        assert.equal(proof['payloadKind'], 'fixture-doc-derived');

        const roles = await h.raw.eventParticipants.listByEvent(row.id);
        const byRole = new Map<string, string>();
        for (const r of roles) {
          const p = await h.raw.participants.findById(r.participant_id);
          byRole.set(r.role, p?.display_name ?? '?');
        }
        assert.deepEqual(Object.fromEntries(byRole), {
          home: 'Sacramento Kings',
          away: 'Oklahoma City Thunder',
        });

        const results = await h.raw.gradeResults.listByEvent(row.id);
        assert.equal(summary.resultsInserted, results.length);
        assert.equal(
          results.length,
          7,
          '1 game total + 2 team totals + 2 margins + 2 moneylines',
        );
        assert.ok(results.every((r) => r.source === 'odds-api'));
        assert.deepEqual(
          [...new Set(results.map((r) => r.market_key))].sort(),
          FOUR_KEYS,
        );
      },
    );

    await t.test(
      '12. NHL shootout equal scores: rejected, nothing written to game_results',
      async () => {
        const event = firstEvent('nhl-shootout-equal-scores');
        const h = await createHarness(teamsOf(event, 'NHL'));
        const summary = await run(h, [event], 'NHL');
        assert.equal(summary.resultsInserted, 0);
        assert.ok(!h.writes.includes('gradeResults.insert'));
        assert.deepEqual(await resultsFor(h, event.id), []);
        const row = await h.raw.events.findByExternalId(event.id);
        assert.notEqual(row?.status, 'completed');
        assert.ok(
          summary.skipped.some(
            (s) => s.eventId === event.id && s.reason === 'tie_not_possible',
          ),
        );
      },
    );

    await t.test(
      '15. unknown team string skips the whole event with team_unmapped; no partial rows',
      async () => {
        const event = firstEvent('nba-unknown-team');
        // Only the away team exists canonically; the home string is not in the map at all.
        const h = await createHarness([['NBA', event.away_team]]);
        const summary = await run(h, [event], 'NBA');
        assert.deepEqual(summary.skipped, [
          { eventId: event.id, reason: 'team_unmapped' },
        ]);
        assert.equal(summary.resultsInserted, 0);
        assert.deepEqual(
          h.writes,
          [],
          'no event, participant, role or result written',
        );
      },
    );

    await t.test(
      '15b. mapped string whose canonical participant is missing also skips team_unmapped',
      async () => {
        const event = firstEvent('nba-final');
        const h = await createHarness([['NBA', event.home_team]]);
        const summary = await run(h, [event], 'NBA');
        assert.deepEqual(summary.skipped, [
          { eventId: event.id, reason: 'team_unmapped' },
        ]);
        assert.deepEqual(h.writes, []);
      },
    );

    await t.test(
      '16b. a team from another league does not resolve in this league',
      async () => {
        const event = firstEvent('nba-final');
        event.home_team = 'Los Angeles Kings';
        event.scores = [
          { name: 'Los Angeles Kings', score: '113' },
          { name: event.away_team, score: '103' },
        ];
        const h = await createHarness([
          ['NHL', 'Los Angeles Kings'],
          ['NBA', event.away_team],
        ]);
        const summary = await run(h, [event], 'NBA');
        assert.deepEqual(summary.skipped, [
          { eventId: event.id, reason: 'team_unmapped' },
        ]);
        assert.deepEqual(h.writes, []);
      },
    );

    await t.test(
      '17. foreign-provenance event for the same matchup and Eastern date: skipped, zero writes',
      async () => {
        const event = firstEvent('nba-final');
        for (const providerKey of ['sgo', 'operator-manual-entry']) {
          const h = await createHarness(teamsOf(event, 'NBA'));
          await seedForeignEvent(h, {
            externalId: `${providerKey}-foreign-1`,
            league: 'NBA',
            home: event.home_team,
            away: event.away_team,
            eventDate: '2026-11-07',
            providerKey,
          });
          const summary = await run(h, [event], 'NBA');
          assert.deepEqual(
            summary.skipped,
            [{ eventId: event.id, reason: 'ambiguous_existing_event' }],
            providerKey,
          );
          assert.deepEqual(h.writes, [], `${providerKey}: zero writes`);
          assert.equal(
            await h.raw.events.findByExternalId(event.id),
            null,
            'no second event created beside it',
          );
        }
      },
    );

    await t.test(
      '17b. a foreign event without links or with conflicting source still blocks all writes',
      async () => {
        const input = firstEvent('nba-final');
        for (const metadata of [
          { providerKey: 'sgo', source: 'sgo' },
          { providerKey: 'odds-api', source: 'operator-manual-entry' },
        ]) {
          const h = await createHarness(teamsOf(input, 'NBA'));
          await h.raw.events.upsertByExternalId({
            externalId: 'unlinked-foreign-event',
            sportId: 'NBA',
            eventName: `${input.away_team} @ ${input.home_team}`,
            eventDate: '2026-11-07',
            status: 'scheduled',
            metadata,
          });
          const summary = await run(h, [input], 'NBA');
          assert.deepEqual(summary.skipped, [
            { eventId: input.id, reason: 'ambiguous_existing_event' },
          ]);
          assert.deepEqual(h.writes, []);
        }
      },
    );

    await t.test(
      '18. pre-existing result rows on the event: skipped, rows and sourced_at unchanged',
      async () => {
        const event = firstEvent('nba-final');
        const h = await createHarness(teamsOf(event, 'NBA'));
        await run(h, [event], 'NBA');
        const row = structuredClone(await h.raw.events.findByExternalId(event.id));
        assert.ok(row);
        // Changed final scores conflict with the durable result facts; never overwrite them.
        const before = structuredClone(await h.raw.gradeResults.listByEvent(row.id));
        assert.ok(before.length > 0);

        h.resetWrites();
        const changed = structuredClone(event);
        changed.scores = [
          { name: event.home_team, score: '120' },
          { name: event.away_team, score: '90' },
        ];
        const summary = await run(h, [changed], 'NBA');
        assert.deepEqual(summary.skipped, [
          { eventId: event.id, reason: 'conflicting_results' },
        ]);
        assert.ok(
          !h.writes.includes('gradeResults.insert'),
          'no result insert attempted',
        );
        assert.deepEqual(
          await h.raw.gradeResults.listByEvent(row.id),
          before,
          'values and sourced_at unchanged',
        );
        assert.deepEqual(h.writes, [], 'conflict preflight makes zero writes');
        assert.deepEqual(await h.raw.events.findById(row.id), row,
          'completed status and results proof unchanged');
      },
    );

    await t.test(
      '18b. a result row from another source on an odds-api event also blocks results',
      async () => {
        const event = firstEvent('nba-final');
        const h = await createHarness(teamsOf(event, 'NBA'));
        // Event exists (non-final run), then an operator result lands on it.
        const live = structuredClone(event);
        live.completed = false;
        await run(h, [live], 'NBA');
        const row = await h.raw.events.findByExternalId(event.id);
        assert.ok(row, 'non-final run upserts the event');
        await h.raw.gradeResults.insert({
          eventId: row.id,
          participantId: null,
          marketKey: 'game_total_ou',
          actualValue: 200,
          source: 'operator-manual-entry',
          sourcedAt: '2026-11-08T03:00:00.000Z',
        });
        const before = await h.raw.gradeResults.listByEvent(row.id);
        h.resetWrites();
        const summary = await run(h, [event], 'NBA');
        assert.deepEqual(summary.skipped, [
          { eventId: event.id, reason: 'results_already_present' },
        ]);
        assert.deepEqual(await h.raw.gradeResults.listByEvent(row.id), before);
      },
    );

    await t.test(
      '19. re-run is idempotent: second run writes nothing',
      async () => {
        const event = firstEvent('nba-final');
        const h = await createHarness(teamsOf(event, 'NBA'));
        await run(h, [event], 'NBA');
        const row = await h.raw.events.findByExternalId(event.id);
        assert.ok(row);
        const eventBefore = structuredClone(row);
        const resultsBefore = await h.raw.gradeResults.listByEvent(row.id);

        h.resetWrites();
        const second = await run(h, [event], 'NBA');
        assert.equal(second.resultsInserted, 0);
        assert.deepEqual(h.writes, [], 'no new rows and no updated rows');
        assert.deepEqual(
          await h.raw.events.findByExternalId(event.id),
          eventBefore,
        );
        assert.deepEqual(
          await h.raw.gradeResults.listByEvent(row.id),
          resultsBefore,
        );
      },
    );

    await t.test(
      '20. margin sign both sides; moneyline 1/0; NFL tie 0.5/0.5 and margin 0',
      async () => {
        const valueOf = async (
          h: Harness,
          externalId: string,
          league: League,
          marketKey: string,
          team: string | null,
        ) => {
          const row = await h.raw.events.findByExternalId(externalId);
          assert.ok(row);
          const participantId = team
            ? ((
                await h.raw.participants.findByExternalId(
                  externalIdFor(league, team),
                )
              )?.id ?? null)
            : null;
          const result = await h.raw.gradeResults.findResult({
            eventId: row.id,
            participantId,
            marketKey,
          });
          assert.ok(result, `${marketKey} ${team ?? 'game'}`);
          return Number(result.actual_value);
        };

        const nba = firstEvent('nba-final'); // home Sacramento Kings 113, away Oklahoma City Thunder 103
        const h1 = await createHarness(teamsOf(nba, 'NBA'));
        await run(h1, [nba], 'NBA');
        assert.equal(
          await valueOf(h1, nba.id, 'NBA', 'game_total_ou', null),
          216,
        );
        assert.equal(
          await valueOf(h1, nba.id, 'NBA', 'team_total_ou', nba.home_team),
          113,
        );
        assert.equal(
          await valueOf(h1, nba.id, 'NBA', 'team_total_ou', nba.away_team),
          103,
        );
        assert.equal(
          await valueOf(h1, nba.id, 'NBA', 'game_spread_margin', nba.home_team),
          10,
        );
        assert.equal(
          await valueOf(h1, nba.id, 'NBA', 'game_spread_margin', nba.away_team),
          -10,
        );
        assert.equal(
          await valueOf(h1, nba.id, 'NBA', 'game_moneyline_win', nba.home_team),
          1,
        );
        assert.equal(
          await valueOf(h1, nba.id, 'NBA', 'game_moneyline_win', nba.away_team),
          0,
        );

        const swapped = firstEvent('nba-swapped-order'); // home Dallas 98, away Houston 120
        const h2 = await createHarness(teamsOf(swapped, 'NBA'));
        await run(h2, [swapped], 'NBA');
        assert.equal(
          await valueOf(
            h2,
            swapped.id,
            'NBA',
            'game_spread_margin',
            swapped.home_team,
          ),
          -22,
        );
        assert.equal(
          await valueOf(
            h2,
            swapped.id,
            'NBA',
            'game_moneyline_win',
            swapped.away_team,
          ),
          1,
        );

        const tie = firstEvent('nfl-tie'); // 20-20
        const h3 = await createHarness(teamsOf(tie, 'NFL'));
        await run(h3, [tie], 'NFL');
        assert.equal(
          await valueOf(h3, tie.id, 'NFL', 'game_total_ou', null),
          40,
        );
        for (const team of [tie.home_team, tie.away_team]) {
          assert.equal(
            await valueOf(h3, tie.id, 'NFL', 'game_spread_margin', team),
            0,
          );
          assert.equal(
            await valueOf(h3, tie.id, 'NFL', 'game_moneyline_win', team),
            0.5,
          );
        }

        const shootout = firstEvent('nhl-shootout-winner-credited'); // 3-2 (test 11 write side)
        const h4 = await createHarness(teamsOf(shootout, 'NHL'));
        await run(h4, [shootout], 'NHL');
        assert.equal(
          await valueOf(h4, shootout.id, 'NHL', 'game_total_ou', null),
          5,
        );
        assert.equal(
          await valueOf(
            h4,
            shootout.id,
            'NHL',
            'game_spread_margin',
            shootout.home_team,
          ),
          1,
        );
        assert.equal(
          await valueOf(
            h4,
            shootout.id,
            'NHL',
            'game_spread_margin',
            shootout.away_team,
          ),
          -1,
        );
      },
    );

    await t.test(
      '21. no results before final; event stays non-completed',
      async () => {
        for (const name of ['nba-live', 'nba-upcoming']) {
          const event = firstEvent(name);
          const h = await createHarness(teamsOf(event, 'NBA'));
          const summary = await run(h, [event], 'NBA');
          assert.equal(summary.resultsInserted, 0, name);
          assert.ok(!h.writes.includes('gradeResults.insert'), name);
          const row = await h.raw.events.findByExternalId(event.id);
          if (row) assert.notEqual(row.status, 'completed', name);
        }
      },
    );

    await t.test(
      '22. only the four keys are ever written across every fixture',
      async () => {
        const keys = new Set<string>();
        for (const file of readdirSync(FIXTURE_DIR).filter((name) =>
          name.endsWith('.json'),
        )) {
          const fixture = loadFixture(file);
          const teams: Array<[League, string]> = [];
          for (const event of fixture.response) {
            for (const name of [event.home_team, event.away_team]) {
              if (teamMap?.[fixture.league][name])
                teams.push([fixture.league, name]);
            }
          }
          const h = await createHarness(teams);
          await run(h, fixture.response, fixture.league);
          for (const event of fixture.response) {
            for (const result of await resultsFor(h, event.id))
              keys.add(result.market_key);
          }
        }
        assert.deepEqual([...keys].sort(), FOUR_KEYS);
      },
    );

    await t.test(
      '23. commence_time drift over 6 hours on an existing event: skipped, zero writes',
      async () => {
        const event = firstEvent('nba-final');
        const h = await createHarness(teamsOf(event, 'NBA'));
        const early = structuredClone(event);
        early.completed = false;
        early.commence_time = '2026-11-07T17:00:00Z'; // 7h10m before the final's commence_time
        early.last_update = null;
        early.scores = null;
        await run(h, [early], 'NBA', new Date('2026-11-07T12:00:00Z'));
        assert.ok(
          await h.raw.events.findByExternalId(event.id),
          'first sighting upserts the event',
        );

        h.resetWrites();
        const summary = await run(h, [event], 'NBA');
        assert.deepEqual(summary.skipped, [
          { eventId: event.id, reason: 'commence_time_changed' },
        ]);
        assert.deepEqual(h.writes, []);
        assert.deepEqual(await resultsFor(h, event.id), []);
      },
    );

    await t.test('23b. drift of 6 hours or less is not a skip', async () => {
      const event = firstEvent('nba-final');
      const h = await createHarness(teamsOf(event, 'NBA'));
      const early = structuredClone(event);
      early.completed = false;
      early.commence_time = '2026-11-07T18:10:00Z'; // exactly 6h before
      early.last_update = null;
      early.scores = null;
      await run(h, [early], 'NBA', new Date('2026-11-07T12:00:00Z'));
      const summary = await run(h, [event], 'NBA');
      assert.deepEqual(summary.skipped, []);
      assert.equal((await resultsFor(h, event.id)).length, 7);
    });

    await t.test(
      '24. a completed event is never regressed by a later non-final response',
      async () => {
        const event = firstEvent('nba-final');
        const h = await createHarness(teamsOf(event, 'NBA'));
        await run(h, [event], 'NBA');
        const later = structuredClone(event);
        later.completed = false;
        await run(h, [later], 'NBA');
        const row = await h.raw.events.findByExternalId(event.id);
        assert.equal(row?.status, 'completed');
        assert.equal(
          (await resultsFor(h, event.id)).length,
          7,
          'results untouched',
        );
      },
    );

    await t.test(
      'rejected and not-final outcomes are counted with a named reason',
      async () => {
        const events = [
          'nba-non-numeric-score',
          'nba-score-name-mismatch',
          'nba-wrong-sport-key',
        ].map(firstEvent);
        const teams = events.flatMap((e) =>
          [e.home_team, e.away_team]
            .filter((n) => teamMap?.NBA[n])
            .map((n): [League, string] => ['NBA', n]),
        );
        const h = await createHarness(teams);
        const summary = await run(h, events, 'NBA');
        assert.equal(summary.resultsInserted, 0);
        assert.ok(!h.writes.includes('gradeResults.insert'));
        for (const event of events) {
          const skip = summary.skipped.find((s) => s.eventId === event.id);
          assert.ok(
            skip && skip.reason.length > 0,
            `${event.id} skipped with a reason`,
          );
        }
      },
    );
  },
);

function interruptAfter(h: Harness, successfulInserts: number): Harness {
  let inserted = 0;
  return {
    ...h,
    repositories: {
      ...h.repositories,
      gradeResults: {
        listByEvent: (id) => h.repositories.gradeResults.listByEvent(id),
        findResult: (criteria) =>
          h.repositories.gradeResults.findResult(criteria),
        insert: async (input) => {
          if (inserted === successfulInserts)
            throw new Error('injected interruption');
          const row = await h.repositories.gradeResults.insert(input);
          inserted++;
          return row;
        },
      },
    },
  };
}

async function assertComplete(h: Harness, input: ScoreEvent) {
  const event = await h.raw.events.findByExternalId(input.id);
  assert.ok(event);
  assert.equal(event.status, 'completed');
  assert.deepEqual(event.metadata['resultsProof'], {
    matchMethod: 'static-team-map',
    providerEventId: input.id,
    providerLastUpdate: input.last_update,
    fetchedAt: CONTEXT.fetchedAt,
    completedObserved: true,
    payloadKind: CONTEXT.payloadKind,
  });
  const home = await h.raw.participants.findByExternalId(
    externalIdFor('NBA', input.home_team),
  );
  const away = await h.raw.participants.findByExternalId(
    externalIdFor('NBA', input.away_team),
  );
  assert.ok(home && away);
  const rows = await h.raw.gradeResults.listByEvent(event.id);
  assert.equal(rows.length, 7);
  assert.deepEqual(
    rows.map((r) => [r.participant_id, r.market_key, Number(r.actual_value)]),
    [
      [null, 'game_total_ou', 216],
      [home.id, 'team_total_ou', 113],
      [home.id, 'game_spread_margin', 10],
      [home.id, 'game_moneyline_win', 1],
      [away.id, 'team_total_ou', 103],
      [away.id, 'game_spread_margin', -10],
      [away.id, 'game_moneyline_win', 0],
    ],
  );
  assert.ok(
    rows.every(
      (r) =>
        r.source === 'odds-api' &&
        Date.parse(r.sourced_at) === Date.parse(input.last_update!),
    ),
  );
}

test('step 13a: a later provider timestamp cannot alter a completed proven event', async () => {
  const input = firstEvent('nba-final');
  const h = await createHarness(teamsOf(input, 'NBA'));
  await run(h, [input], 'NBA');
  const event = structuredClone(await h.raw.events.findByExternalId(input.id));
  const rows = structuredClone(await resultsFor(h, input.id));
  h.resetWrites();
  const later = {
    ...input,
    last_update: new Date(
      Date.parse(input.last_update!) + 60_000,
    ).toISOString(),
  };
  const summary = await run(h, [later], 'NBA');
  assert.deepEqual(summary.skipped, [
    { eventId: input.id, reason: 'conflicting_results' },
  ]);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(await h.raw.events.findByExternalId(input.id), event);
  assert.deepEqual(await resultsFor(h, input.id), rows);
});

test('step 13a: concurrent identical applies converge to seven facts and repeated applies write nothing', async () => {
  const input = firstEvent('nba-final');
  const h = await createHarness(teamsOf(input, 'NBA'));
  const summaries = await Promise.all([
    run(h, [input], 'NBA'),
    run(h, [input], 'NBA'),
  ]);
  assert.ok(summaries.every((summary) => summary.skipped.length === 0));
  await assertComplete(h, input);
  const event = structuredClone(await h.raw.events.findByExternalId(input.id));
  const rows = structuredClone(await resultsFor(h, input.id));
  assert.equal(
    new Set(
      rows.map((row) => JSON.stringify([row.participant_id, row.market_key])),
    ).size,
    7,
  );
  for (let replay = 0; replay < 3; replay++) {
    h.resetWrites();
    const summary = await run(h, [input], 'NBA');
    assert.equal(summary.eventsUpserted, 0);
    assert.equal(summary.resultsInserted, 0);
    assert.deepEqual(summary.skipped, [
      { eventId: input.id, reason: 'results_already_present' },
    ]);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(await h.raw.events.findByExternalId(input.id), event);
    assert.deepEqual(await resultsFor(h, input.id), rows);
  }
});

for (const successfulInserts of [1, 4]) {
  test(`step 13: interruption after ${successfulInserts} rows resumes and replays without writes`, async () => {
    const input = firstEvent('nba-final');
    const h = await createHarness(teamsOf(input, 'NBA'));
    await assert.rejects(
      run(interruptAfter(h, successfulInserts), [input], 'NBA'),
      /injected interruption/,
    );
    const partial = await h.raw.events.findByExternalId(input.id);
    assert.ok(partial);
    assert.notEqual(partial.status, 'completed');
    assert.equal(partial.metadata['resultsProof'], undefined);
    assert.equal(
      (await h.raw.gradeResults.listByEvent(partial.id)).length,
      successfulInserts,
    );
    h.resetWrites();
    const resumed = await run(h, [input], 'NBA');
    assert.equal(resumed.resultsInserted, 7 - successfulInserts);
    assert.equal(resumed.eventsUpserted, 1);
    assert.equal(
      h.writes.filter((w) => w === 'gradeResults.insert').length,
      7 - successfulInserts,
    );
    await assertComplete(h, input);
    h.resetWrites();
    const replay = await run(h, [input], 'NBA');
    assert.equal(replay.eventsUpserted, 0);
    assert.equal(replay.resultsInserted, 0);
    assert.deepEqual(replay.skipped, [
      { eventId: input.id, reason: 'results_already_present' },
    ]);
    assert.deepEqual(h.writes, []);
  });
}

test('step 13: legacy completed partial event loses proof before repair and restores it only after completion', async () => {
  const input = firstEvent('nba-final');
  const h = await createHarness(teamsOf(input, 'NBA'));
  const legacy = await h.raw.events.upsertByExternalId({
    externalId: input.id,
    sportId: 'NBA',
    eventName: `${input.away_team} @ ${input.home_team}`,
    eventDate: '2026-11-07',
    status: 'completed',
    metadata: {
      source: 'odds-api',
      providerKey: 'odds-api',
      ingestionSource: 'odds-api-scores.operator-run',
      ingestionCycleRunId: RUN_ID,
      starts_at: input.commence_time,
      sport_key: input.sport_key,
      home_team_name: input.home_team,
      away_team_name: input.away_team,
      resultsProof: {
        completedObserved: true,
        providerEventId: input.id,
        providerLastUpdate: input.last_update,
        fetchedAt: CONTEXT.fetchedAt,
        payloadKind: CONTEXT.payloadKind,
        matchMethod: 'static-team-map',
      },
    },
  });
  await h.raw.gradeResults.insert({
    eventId: legacy.id,
    participantId: null,
    marketKey: 'game_total_ou',
    actualValue: 216,
    source: 'odds-api',
    sourcedAt: input.last_update!,
  });
  await assert.rejects(
    run(interruptAfter(h, 1), [input], 'NBA'),
    /injected interruption/,
  );
  const repairing = await h.raw.events.findById(legacy.id);
  assert.equal(
    repairing?.status,
    'completed',
    'repository preserves completed status',
  );
  assert.equal(repairing?.metadata['resultsProof'], undefined);
  assert.equal((await h.raw.gradeResults.listByEvent(legacy.id)).length, 2);
  assert.equal((await run(h, [input], 'NBA')).resultsInserted, 5);
  await assertComplete(h, input);
});

for (const kind of [
  'value',
  'timestamp',
  'participant',
  'unexpected_key',
] as const) {
  test(`step 13: conflicting ${kind} leaves every fact unchanged with zero writes`, async () => {
    const input = firstEvent('nba-final');
    const h = await createHarness(teamsOf(input, 'NBA'));
    await run(h, [{ ...input, completed: false }], 'NBA');
    const event = await h.raw.events.findByExternalId(input.id);
    assert.ok(event);
    const outsider = await h.raw.participants.upsertByExternalId({
      externalId: 'OUTSIDER_NBA',
      displayName: 'Outside Team',
      participantType: 'team',
      sport: 'NBA',
      league: 'NBA',
      metadata: {},
    });
    await h.raw.gradeResults.insert({
      eventId: event.id,
      participantId: kind === 'participant' ? outsider.id : null,
      marketKey: kind === 'unexpected_key' ? '1p_total_ou' : 'game_total_ou',
      actualValue: kind === 'value' ? 999 : 216,
      source: 'odds-api',
      sourcedAt:
        kind === 'timestamp' ? '2026-11-08T03:00:00Z' : input.last_update!,
    });
    const before = await h.raw.gradeResults.listByEvent(event.id);
    h.resetWrites();
    const summary = await run(h, [input], 'NBA');
    assert.deepEqual(summary.skipped, [
      { eventId: input.id, reason: 'conflicting_results' },
    ]);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(await h.raw.events.findById(event.id), event);
    assert.deepEqual(await h.raw.gradeResults.listByEvent(event.id), before);
    assert.notEqual(event.status, 'completed');
  });
}

test('step 13: a mismatched insert return never publishes completion proof', async () => {
  const input = firstEvent('nba-final');
  for (const field of [
    'source',
    'actual_value',
    'sourced_at',
    'participant_id',
    'market_key',
    'event_id',
  ] as const) {
    const h = await createHarness(teamsOf(input, 'NBA'));
    const bundle = {
      ...h.repositories,
      gradeResults: {
        listByEvent: (id: string) =>
          h.repositories.gradeResults.listByEvent(id),
        findResult: (
          criteria: Parameters<
            typeof h.repositories.gradeResults.findResult
          >[0],
        ) => h.repositories.gradeResults.findResult(criteria),
        insert: async (
          value: Parameters<typeof h.repositories.gradeResults.insert>[0],
        ) => {
          const row = await h.repositories.gradeResults.insert(value);
          return {
            ...row,
            [field]: field === 'actual_value' ? 999 : 'conflicting-return',
          };
        },
      },
    };
    const summary = await run({ ...h, repositories: bundle }, [input], 'NBA');
    assert.deepEqual(summary.skipped, [
      { eventId: input.id, reason: 'conflicting_results' },
    ]);
    const event = await h.raw.events.findByExternalId(input.id);
    assert.notEqual(event?.status, 'completed');
    assert.equal(event?.metadata['resultsProof'], undefined);
  }
});
