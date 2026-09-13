import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveMatchupTeamChoices, isMissingQaIdentity } from '../lib/team-choice';

const matchup = { manualIdentity: false, awayName: 'Saints', homeName: 'Lions', awayId: 'team-saints', homeId: 'team-lions' };

test('structured matchup choices preserve the exact selected canonical side IDs', () => {
  assert.deepEqual(deriveMatchupTeamChoices(matchup), [
    { key: 'away', label: 'Saints', participantId: 'team-saints', role: 'away' },
    { key: 'home', label: 'Lions', participantId: 'team-lions', role: 'home' },
  ]);
});

test('unresolved or duplicate canonical sides do not create choice buttons', () => {
  assert.deepEqual(deriveMatchupTeamChoices({ ...matchup, homeId: null }), []);
  assert.deepEqual(deriveMatchupTeamChoices({ ...matchup, homeId: matchup.awayId }), []);
  assert.deepEqual(deriveMatchupTeamChoices({ ...matchup, homeName: ' saints ' }), []);
  assert.deepEqual(deriveMatchupTeamChoices({ ...matchup, awayName: '' }), []);
});

test('explicit manual coverage-gap choices strip IDs and retain entered names', () => {
  assert.deepEqual(deriveMatchupTeamChoices({ ...matchup, manualIdentity: true }), [
    { key: 'away', label: 'Saints', participantId: null, role: 'away' },
    { key: 'home', label: 'Lions', participantId: null, role: 'home' },
  ]);
});

test('a changed matchup replaces the previous home choice and preserves the away identity', () => {
  assert.deepEqual(deriveMatchupTeamChoices({ ...matchup, homeName: 'Bills', homeId: 'team-bills' }), [
    { key: 'away', label: 'Saints', participantId: 'team-saints', role: 'away' },
    { key: 'home', label: 'Bills', participantId: 'team-bills', role: 'home' },
  ]);
});

test('only QA with a missing explicit identity is blocked by the QA safeguard', () => {
  assert.equal(isMissingQaIdentity(true, null), true);
  assert.equal(isMissingQaIdentity(true, '  '), true);
  assert.equal(isMissingQaIdentity(true, 'griff843'), false);
  assert.equal(isMissingQaIdentity(false, null), false);
});
