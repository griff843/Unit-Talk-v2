import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseClientFromConnection,
  createServiceRoleDatabaseConnectionConfig,
  summarizeCanonicalBootstrapSource,
  type BootstrapEventParticipantSource,
  type BootstrapEventSource,
  type BootstrapParticipantSource,
} from '@unit-talk/db';

const EXPECTED_LEAGUES = ['NBA', 'NFL', 'MLB', 'NHL', 'NCAAB', 'NCAAF', 'Soccer', 'MMA', 'Tennis'];

async function main() {
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  const client = createDatabaseClientFromConnection(connection);

  const [participantsResult, eventsResult, eventParticipantsResult] = await Promise.all([
    client
      .from('participants')
      .select('id,participant_type,sport,league,display_name,external_id,metadata,created_at')
      .limit(5000),
    client.from('events').select('id,metadata').limit(5000),
    client.from('event_participants').select('event_id,participant_id,role').limit(5000),
  ]);

  if (participantsResult.error) {
    throw new Error(`Failed to load participants for bootstrap report: ${participantsResult.error.message}`);
  }
  if (eventsResult.error) {
    throw new Error(`Failed to load events for bootstrap report: ${eventsResult.error.message}`);
  }
  if (eventParticipantsResult.error) {
    throw new Error(`Failed to load event participants for bootstrap report: ${eventParticipantsResult.error.message}`);
  }

  const participants: BootstrapParticipantSource[] = (participantsResult.data ?? []).map((row) => ({
    id: row.id as string,
    participantType: row.participant_type as string,
    sport: (row.sport as string | null) ?? null,
    league: (row.league as string | null) ?? null,
    displayName: row.display_name as string,
    externalId: (row.external_id as string | null) ?? null,
    metadata: toObject(row.metadata),
    createdAt: row.created_at as string,
  }));

  const events: BootstrapEventSource[] = (eventsResult.data ?? []).map((row) => ({
    id: row.id as string,
    metadata: toObject(row.metadata),
  }));

  const eventParticipants: BootstrapEventParticipantSource[] = (
    eventParticipantsResult.data ?? []
  ).map((row) => ({
    eventId: row.event_id as string,
    participantId: row.participant_id as string,
    role: row.role as string,
  }));

  const summary = summarizeCanonicalBootstrapSource({
    participants,
    events,
    eventParticipants,
    expectedLeagueIds: EXPECTED_LEAGUES,
  });

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10);
  const outputPath = path.join(
    process.cwd(),
    'out',
    'ops',
    `canonical_reference_bootstrap_report_${dateStamp}.md`,
  );

  const markdown = buildMarkdown({
    generatedAt: now.toISOString(),
    sourceCounts: {
      participants: participants.length,
      events: events.length,
      eventParticipants: eventParticipants.length,
    },
    summary,
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, markdown, 'utf8');

  console.log(outputPath);
}

function buildMarkdown(input: {
  generatedAt: string;
  sourceCounts: { participants: number; events: number; eventParticipants: number };
  summary: ReturnType<typeof summarizeCanonicalBootstrapSource>;
}) {
  const gapRows = input.summary.byLeague.filter(
    (row) => row.teams === 0 || row.players === 0 || row.unassignedPlayers > 0,
  );

  return [
    '# Canonical Reference Bootstrap Report',
    '',
    `Generated: ${input.generatedAt}`,
    '',
    '## Source Snapshot',
    '',
    `- participants scanned: ${input.sourceCounts.participants}`,
    `- events scanned: ${input.sourceCounts.events}`,
    `- event_participants scanned: ${input.sourceCounts.eventParticipants}`,
    '',
    '## Summary',
    '',
    `- canonical teams derivable: ${input.summary.totalTeams}`,
    `- canonical players derivable: ${input.summary.totalPlayers}`,
    `- current player-team assignments derivable: ${input.summary.totalAssignedPlayers}`,
    `- players still unresolved to a team alias: ${input.summary.totalUnassignedPlayers}`,
    `- SGO team aliases derivable from event links: ${input.summary.teamAliasCount}`,
    `- SGO player aliases derivable from participant external ids: ${input.summary.playerAliasCount}`,
    `- distinct unresolved SGO team keys: ${input.summary.unresolvedTeamAliasCount}`,
    '',
    '## By League',
    '',
    '| League | Sport | Teams | Players | Assigned Players | Unassigned Players |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...input.summary.byLeague.map(
      (row) =>
        `| ${row.leagueId} | ${row.sportId} | ${row.teams} | ${row.players} | ${row.assignedPlayers} | ${row.unassignedPlayers} |`,
    ),
    '',
    '## Explicit Gaps',
    '',
    ...(gapRows.length === 0
      ? ['- None']
      : gapRows.map((row) => {
          const gaps = [];
          if (row.teams === 0) gaps.push('no canonical teams derivable');
          if (row.players === 0) gaps.push('no canonical players derivable');
          if (row.unassignedPlayers > 0) gaps.push(`${row.unassignedPlayers} players missing team alias resolution`);
          return `- ${row.leagueId}: ${gaps.join('; ')}`;
        })),
    '',
  ].join('\n');
}

function toObject(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Failed to generate canonical reference bootstrap report',
  );
  process.exitCode = 1;
});
