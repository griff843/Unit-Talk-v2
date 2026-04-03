import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCanonicalTeamId,
  normalizeCanonicalLeagueId,
  slugifyCanonicalSegment,
  splitDisplayName,
  summarizeCanonicalBootstrapSource,
} from './canonical-reference-bootstrap.js';

test('normalizeCanonicalLeagueId lowercases and trims league identifiers', () => {
  assert.equal(normalizeCanonicalLeagueId(' NBA '), 'nba');
  assert.equal(normalizeCanonicalLeagueId('Soccer'), 'soccer');
  assert.equal(normalizeCanonicalLeagueId(null), null);
});

test('buildCanonicalTeamId derives stable ids from league and display name', () => {
  assert.equal(buildCanonicalTeamId('NBA', 'Trail Blazers'), 'nba:trail-blazers');
  assert.equal(buildCanonicalTeamId('NHL', 'Maple Leafs'), 'nhl:maple-leafs');
});

test('splitDisplayName separates first and last names conservatively', () => {
  assert.deepEqual(splitDisplayName('Jamal Murray'), {
    firstName: 'Jamal',
    lastName: 'Murray',
  });
  assert.deepEqual(splitDisplayName('Pelé'), {
    firstName: 'Pelé',
    lastName: null,
  });
});

test('slugifyCanonicalSegment collapses punctuation and spacing', () => {
  assert.equal(slugifyCanonicalSegment('Los Angeles Clippers'), 'los-angeles-clippers');
  assert.equal(slugifyCanonicalSegment('Points + Assists'), 'points-assists');
});

// UTV2-306: Regression coverage for duplicate-heavy source data that broke live bootstrap.
// Same provider alias key appearing across multiple events must not inflate teamAliasCount.
test('summarizeCanonicalBootstrapSource deduplicates repeated provider alias keys across multiple events', () => {
  const nuggets = {
    id: 'team-nuggets',
    participantType: 'team',
    sport: 'NBA',
    league: 'NBA',
    displayName: 'Nuggets',
    externalId: 'DENVER_NUGGETS_NBA',
    metadata: {},
    createdAt: '2026-04-02T00:00:00.000Z',
  };
  const jazz = {
    id: 'team-jazz',
    participantType: 'team',
    sport: 'NBA',
    league: 'NBA',
    displayName: 'Jazz',
    externalId: 'UTAH_JAZZ_NBA',
    metadata: {},
    createdAt: '2026-04-02T00:00:00.000Z',
  };

  // Same DENVER_NUGGETS_NBA alias key appears in 5 different game events.
  const events = [
    { id: 'game-1', metadata: { away_team_external_id: 'DENVER_NUGGETS_NBA', home_team_external_id: 'UTAH_JAZZ_NBA' } },
    { id: 'game-2', metadata: { away_team_external_id: 'DENVER_NUGGETS_NBA', home_team_external_id: 'UTAH_JAZZ_NBA' } },
    { id: 'game-3', metadata: { away_team_external_id: 'DENVER_NUGGETS_NBA', home_team_external_id: 'UTAH_JAZZ_NBA' } },
    { id: 'game-4', metadata: { away_team_external_id: 'DENVER_NUGGETS_NBA', home_team_external_id: 'UTAH_JAZZ_NBA' } },
    { id: 'game-5', metadata: { away_team_external_id: 'DENVER_NUGGETS_NBA', home_team_external_id: 'UTAH_JAZZ_NBA' } },
  ];
  const eventParticipants = events.flatMap((e) => [
    { eventId: e.id, participantId: 'team-nuggets', role: 'away' },
    { eventId: e.id, participantId: 'team-jazz', role: 'home' },
  ]);

  const summary = summarizeCanonicalBootstrapSource({
    participants: [nuggets, jazz],
    events,
    eventParticipants,
  });

  // 2 unique alias keys (DENVER_NUGGETS_NBA + UTAH_JAZZ_NBA), not 10
  assert.equal(summary.teamAliasCount, 2, 'alias count must be deduplicated to unique keys');
  assert.equal(summary.totalTeams, 2);
});

test('summarizeCanonicalBootstrapSource handles duplicate participant rows with same externalId', () => {
  // Same team row appearing multiple times in source data (real bootstrap duplication scenario).
  const makeNuggets = (id: string) => ({
    id,
    participantType: 'team',
    sport: 'NBA',
    league: 'NBA',
    displayName: 'Nuggets',
    externalId: 'DENVER_NUGGETS_NBA',
    metadata: {},
    createdAt: '2026-04-02T00:00:00.000Z',
  });

  const summary = summarizeCanonicalBootstrapSource({
    participants: [makeNuggets('team-1'), makeNuggets('team-2'), makeNuggets('team-3')],
    events: [],
    eventParticipants: [],
  });

  // All 3 are counted as teams (bootstrap source counts rows, dedupe happens at DB layer).
  assert.equal(summary.totalTeams, 3);
  // alias count: 0 because no events provided alias keys
  assert.equal(summary.teamAliasCount, 0);
});

test('summarizeCanonicalBootstrapSource correctly resolves players when same provider key spans many games', () => {
  const nuggets = {
    id: 'team-nuggets',
    participantType: 'team',
    sport: 'NBA',
    league: 'NBA',
    displayName: 'Nuggets',
    externalId: 'DENVER_NUGGETS_NBA',
    metadata: {},
    createdAt: '2026-04-02T00:00:00.000Z',
  };
  const player = {
    id: 'player-murray',
    participantType: 'player',
    sport: 'NBA',
    league: 'NBA',
    displayName: 'Jamal Murray',
    externalId: 'JAMAL_MURRAY_NBA',
    metadata: { team_external_id: 'DENVER_NUGGETS_NBA' },
    createdAt: '2026-04-02T00:00:00.000Z',
  };

  // DENVER_NUGGETS_NBA alias built from 50 games
  const events = Array.from({ length: 50 }, (_, i) => ({
    id: `game-${i}`,
    metadata: { away_team_external_id: 'DENVER_NUGGETS_NBA', home_team_external_id: 'TEAM_OTHER' },
  }));
  const eventParticipants = events.map((e) => ({
    eventId: e.id,
    participantId: 'team-nuggets',
    role: 'away',
  }));

  const summary = summarizeCanonicalBootstrapSource({
    participants: [nuggets, player],
    events,
    eventParticipants,
  });

  // Player is assigned even though alias key appeared 50 times across events
  assert.equal(summary.totalAssignedPlayers, 1);
  assert.equal(summary.totalUnassignedPlayers, 0);
  // Team alias count is still 1 (DENVER_NUGGETS_NBA is unique)
  assert.equal(summary.teamAliasCount, 1);
});

test('summarizeCanonicalBootstrapSource counts teams, players, aliases, and gaps by league', () => {
  const summary = summarizeCanonicalBootstrapSource({
    expectedLeagueIds: ['NBA', 'NFL'],
    participants: [
      {
        id: 'team-nuggets',
        participantType: 'team',
        sport: 'NBA',
        league: 'NBA',
        displayName: 'Nuggets',
        externalId: 'team:NBA:Nuggets',
        metadata: {},
        createdAt: '2026-04-02T00:00:00.000Z',
      },
      {
        id: 'team-jazz',
        participantType: 'team',
        sport: 'NBA',
        league: 'NBA',
        displayName: 'Jazz',
        externalId: 'team:NBA:Jazz',
        metadata: {},
        createdAt: '2026-04-02T00:00:00.000Z',
      },
      {
        id: 'player-murray',
        participantType: 'player',
        sport: 'NBA',
        league: 'NBA',
        displayName: 'Jamal Murray',
        externalId: 'JAMAL_MURRAY_1_NBA',
        metadata: {
          team_external_id: 'DENVER_NUGGETS_NBA',
        },
        createdAt: '2026-04-02T00:00:00.000Z',
      },
      {
        id: 'player-unknown',
        participantType: 'player',
        sport: 'NBA',
        league: 'NBA',
        displayName: 'Unknown Guard',
        externalId: 'UNKNOWN_GUARD_99_NBA',
        metadata: {
          team_external_id: 'MISSING_TEAM_KEY',
        },
        createdAt: '2026-04-02T00:00:00.000Z',
      },
    ],
    events: [
      {
        id: 'event-1',
        metadata: {
          home_team_external_id: 'UTAH_JAZZ_NBA',
          away_team_external_id: 'DENVER_NUGGETS_NBA',
        },
      },
    ],
    eventParticipants: [
      { eventId: 'event-1', participantId: 'team-jazz', role: 'home' },
      { eventId: 'event-1', participantId: 'team-nuggets', role: 'away' },
    ],
  });

  assert.equal(summary.totalTeams, 2);
  assert.equal(summary.totalPlayers, 2);
  assert.equal(summary.totalAssignedPlayers, 1);
  assert.equal(summary.totalUnassignedPlayers, 1);
  assert.equal(summary.teamAliasCount, 2);
  assert.equal(summary.playerAliasCount, 2);
  assert.equal(summary.unresolvedTeamAliasCount, 1);
  assert.deepEqual(summary.byLeague, [
    {
      leagueId: 'nba',
      sportId: 'NBA',
      teams: 2,
      players: 2,
      assignedPlayers: 1,
      unassignedPlayers: 1,
    },
    {
      leagueId: 'nfl',
      sportId: 'NFL',
      teams: 0,
      players: 0,
      assignedPlayers: 0,
      unassignedPlayers: 0,
    },
  ]);
});
