import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalTables } from './index.js';
import { canonicalSchema } from './schema.js';

test('canonical table registry includes canonical reference backbone tables', () => {
  for (const table of ['leagues', 'teams', 'players', 'player_team_assignments']) {
    assert.ok(canonicalTables.includes(table as (typeof canonicalTables)[number]));
  }
});

test('canonical schema metadata includes expected owners for backbone tables', () => {
  const leagues = canonicalSchema.find((row) => row.name === 'leagues');
  const teams = canonicalSchema.find((row) => row.name === 'teams');
  const players = canonicalSchema.find((row) => row.name === 'players');
  const assignments = canonicalSchema.find((row) => row.name === 'player_team_assignments');

  assert.ok(leagues);
  assert.equal(leagues.owner, 'platform');
  assert.ok(teams);
  assert.equal(teams.owner, 'platform');
  assert.ok(players);
  assert.equal(players.owner, 'platform');
  assert.ok(assignments);
  assert.equal(assignments.owner, 'api');
});
