import type { IngestorRepositoryBundle } from '@unit-talk/db';

import type { ParsedScore, ScoresLeague } from './odds-api-scores-parser.js';
import { ODDS_API_SCORES_TEAM_MAP } from './odds-api-scores-team-map.js';

const RESULT_KEYS = [
  'game_total_ou',
  'team_total_ou',
  'game_spread_margin',
  'game_moneyline_win',
];
export interface ScoresContext {
  fetchedAt: string;
  payloadKind: 'live' | 'fixture-doc-derived' | 'fixture-recorded';
}
/** Two-phase writes count each event once and only missing result inserts. */
export interface ScoresResolveSummary {
  eventsUpserted: number;
  resultsInserted: number;
  skipped: Array<{ eventId: string | null; reason: string }>;
}

/** Stage without completion proof, reconcile durable results, then publish completion. */
export async function resolveOddsApiScores(
  parsed: ParsedScore[],
  league: ScoresLeague,
  runId: string,
  repositories: Pick<
    IngestorRepositoryBundle,
    'participants' | 'events' | 'eventParticipants' | 'gradeResults'
  >,
  context: ScoresContext,
): Promise<ScoresResolveSummary> {
  const summary: ScoresResolveSummary = {
    eventsUpserted: 0,
    resultsInserted: 0,
    skipped: [],
  };
  const teams = await repositories.participants.listByType('team', league);
  for (const outcome of parsed) {
    const skip = (reason: string) =>
      summary.skipped.push({ eventId: outcome.eventId, reason });
    if (outcome.status === 'rejected') {
      skip(outcome.reason);
      continue;
    }
    const input = outcome.event;
    const lookup = (name: string) => {
      const externalId = Object.hasOwn(ODDS_API_SCORES_TEAM_MAP[league], name)
        ? ODDS_API_SCORES_TEAM_MAP[league][name]
        : undefined;
      return externalId
        ? teams.filter(
            (t) =>
              t.external_id === externalId &&
              t.participant_type === 'team' &&
              t.sport === league,
          )
        : [];
    };
    const homes = lookup(input.home_team),
      aways = lookup(input.away_team);
    if (
      homes.length !== 1 ||
      aways.length !== 1 ||
      homes[0]!.id === aways[0]!.id
    ) {
      skip('team_unmapped');
      continue;
    }
    const home = homes[0]!,
      away = aways[0]!;
    const date = new Date(input.commence_time).toLocaleDateString('en-CA', {
      timeZone: 'America/New_York',
    });
    const existing = await repositories.events.findByExternalId(input.id);
    const homeLinks = await repositories.eventParticipants.listByParticipant(
      home.id,
    );
    const awayLinks = await repositories.eventParticipants.listByParticipant(
      away.id,
    );
    const common = new Set(awayLinks.map((link) => link.event_id));
    const owned = (metadata: Record<string, unknown>) =>
      metadata['providerKey'] === 'odds-api' &&
      metadata['source'] === 'odds-api';
    let foreign = existing !== null && !owned(existing.metadata);
    // Name matching also catches foreign rows whose participant links are absent.
    const named = [
      ...(await repositories.events.listByName(
        `${away.display_name} @ ${home.display_name}`,
      )),
      ...(await repositories.events.listByName(
        `${home.display_name} @ ${away.display_name}`,
      )),
    ];
    if (
      named.some(
        (candidate) =>
          candidate.event_date === date && !owned(candidate.metadata),
      )
    )
      foreign = true;
    for (const link of homeLinks) {
      if (!common.has(link.event_id)) continue;
      const candidate = await repositories.events.findById(link.event_id);
      if (
        candidate &&
        candidate.event_date === date &&
        !owned(candidate.metadata)
      )
        foreign = true;
    }
    if (foreign) {
      skip('ambiguous_existing_event');
      continue;
    }
    if (existing) {
      if (
        (existing.metadata['home_team_name'] &&
          existing.metadata['home_team_name'] !== input.home_team) ||
        (existing.metadata['away_team_name'] &&
          existing.metadata['away_team_name'] !== input.away_team)
      ) {
        skip('ambiguous_existing_event');
        continue;
      }
      const storedStart = Date.parse(String(existing.metadata['starts_at']));
      if (
        !Number.isFinite(storedStart) ||
        Math.abs(storedStart - Date.parse(input.commence_time)) >
          6 * 60 * 60_000
      ) {
        skip('commence_time_changed');
        continue;
      }
    }
    const expected: Array<{
      participantId: string | null;
      marketKey: string;
      actualValue: number;
    }> = [];
    if (outcome.status === 'final') {
      expected.push({
        participantId: null,
        marketKey: 'game_total_ou',
        actualValue: outcome.homeScore + outcome.awayScore,
      });
      for (const [participant, own, opponent] of [
        [home, outcome.homeScore, outcome.awayScore],
        [away, outcome.awayScore, outcome.homeScore],
      ] as const) {
        expected.push(
          {
            participantId: participant.id,
            marketKey: 'team_total_ou',
            actualValue: own,
          },
          {
            participantId: participant.id,
            marketKey: 'game_spread_margin',
            actualValue: own - opponent,
          },
          {
            participantId: participant.id,
            marketKey: 'game_moneyline_win',
            actualValue: own === opponent ? 0.5 : own > opponent ? 1 : 0,
          },
        );
      }
    }
    const key = (participantId: string | null, marketKey: string) =>
      JSON.stringify([participantId, marketKey]);
    type ResultRow = Awaited<
      ReturnType<typeof repositories.gradeResults.insert>
    >;
    const matches = (row: ResultRow, target: (typeof expected)[number]) =>
      row.participant_id === target.participantId &&
      row.market_key === target.marketKey &&
      row.source === 'odds-api' &&
      Number(row.actual_value) === target.actualValue &&
      outcome.status === 'final' &&
      Date.parse(row.sourced_at) === Date.parse(outcome.lastUpdate);
    const rows = existing
      ? await repositories.gradeResults.listByEvent(existing.id)
      : [];
    const relevantRows = rows.filter((row) =>
      RESULT_KEYS.includes(row.market_key),
    );
    if (
      relevantRows.some((row) => row.source !== 'odds-api') ||
      (outcome.status !== 'final' && relevantRows.length > 0)
    ) {
      skip('results_already_present');
      continue;
    }
    if (existing?.status === 'completed' && outcome.status !== 'final') {
      skip(outcome.reason);
      continue;
    }
    const matched = new Set<string>();
    let conflict = false;
    if (outcome.status === 'final') {
      for (const row of rows.filter((row) => row.source === 'odds-api')) {
        const target = expected.find(
          (candidate) =>
            key(candidate.participantId, candidate.marketKey) ===
            key(row.participant_id, row.market_key),
        );
        if (!target || !matches(row, target)) {
          conflict = true;
          break;
        }
        matched.add(key(target.participantId, target.marketKey));
      }
      if (conflict) {
        skip('conflicting_results');
        continue;
      }
      const proof = existing?.metadata['resultsProof'];
      if (
        matched.size === expected.length &&
        existing?.status === 'completed' &&
        typeof proof === 'object' &&
        proof !== null &&
        'completedObserved' in proof &&
        proof.completedObserved === true &&
        'providerEventId' in proof &&
        proof.providerEventId === input.id
      ) {
        skip('results_already_present');
        continue;
      }
    }
    const metadata = {
      source: 'odds-api',
      providerKey: 'odds-api',
      ingestionSource: 'odds-api-scores.operator-run',
      ingestionCycleRunId: runId,
      starts_at: input.commence_time,
      sport_key: input.sport_key,
      home_team_name: input.home_team,
      away_team_name: input.away_team,
    };
    const completedMetadata = {
      ...metadata,
      ...(outcome.status === 'final'
        ? {
            resultsProof: {
              matchMethod: 'static-team-map',
              providerEventId: input.id,
              providerLastUpdate: outcome.lastUpdate,
              fetchedAt: context.fetchedAt,
              completedObserved: true,
              payloadKind: context.payloadKind,
            },
          }
        : {}),
    };
    const event = await repositories.events.upsertByExternalId({
      externalId: input.id,
      sportId: league,
      eventName: `${away.display_name} @ ${home.display_name}`,
      eventDate: date,
      status: 'scheduled',
      metadata,
    });
    summary.eventsUpserted++;
    for (const [participant, role] of [
      [home, 'home'],
      [away, 'away'],
    ] as const) {
      await repositories.eventParticipants.upsert({
        eventId: event.id,
        participantId: participant.id,
        role,
      });
    }
    if (outcome.status !== 'final') {
      skip(outcome.reason);
      continue;
    }
    for (const target of expected) {
      const resultKey = key(target.participantId, target.marketKey);
      if (matched.has(resultKey)) continue;
      const row = await repositories.gradeResults.insert({
        eventId: event.id,
        ...target,
        source: 'odds-api',
        sourcedAt: outcome.lastUpdate,
      });
      if (row.event_id !== event.id || !matches(row, target)) {
        conflict = true;
        break;
      }
      summary.resultsInserted++;
      matched.add(resultKey);
    }
    if (conflict) {
      skip('conflicting_results');
      continue;
    }
    if (matched.size !== expected.length) {
      skip('results_incomplete');
      continue;
    }
    await repositories.events.upsertByExternalId({
      externalId: input.id,
      sportId: league,
      eventName: event.event_name,
      eventDate: date,
      status: 'completed',
      metadata: completedMetadata,
    });
  }
  return summary;
}
