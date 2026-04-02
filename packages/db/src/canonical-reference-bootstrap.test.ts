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
