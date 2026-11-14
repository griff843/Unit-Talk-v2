import assert from 'node:assert/strict';
import test from 'node:test';
import { participantResolutionSummary } from '../components/GovernedPickTruth';

// WORK-2026110802 (Codex High re-review): the governed pick view presented a structured pick
// whose player is an unverified manual identity as wholly "Canonical" and omitted the player.

const side = (participantId: string, displayName: string) => ({ participantId, displayName, participantType: 'team' });

function manualPlayerMetadata(playerProvenance: string | undefined, withManualPlayer = true): Record<string, unknown> {
  return {
    ...(playerProvenance ? { playerProvenance } : {}),
    participantResolution: {
      resolution: 'canonical',
      sportId: 'NBA',
      eventId: null,
      away: side('team-bos', 'Boston Celtics'),
      home: side('team-nyk', 'New York Knicks'),
      team: side('team-bos', 'Boston Celtics'),
      player: null,
      ...(withManualPlayer
        ? { manualPlayer: { displayName: 'L Doncix', canonicalParticipantId: null, reason: 'unverified-identity' } }
        : {}),
    },
  };
}

test('an unverified manual player is shown, labeled unverified, and never as wholly canonical', () => {
  for (const provenance of ['manual-unverified-identity', 'manual-coverage-gap', undefined]) {
    const summary = participantResolutionSummary(manualPlayerMetadata(provenance));
    assert.doesNotMatch(summary, /^Canonical:/, `provenance=${provenance}`);
    assert.match(summary, /player: L Doncix/);
    assert.match(summary, /unverified identity/);
    assert.match(summary, /not proof of catalog absence/);
    assert.match(summary, /Canonical teams: away: Boston Celtics/);
  }
});

test('a provenance marker alone (legacy row without manualPlayer) is still labeled unverified', () => {
  const summary = participantResolutionSummary(manualPlayerMetadata('manual-coverage-gap', false));
  assert.doesNotMatch(summary, /^Canonical:/);
  assert.match(summary, /player: not recorded \(unverified identity/);
});

test('a canonical pick with a canonical player is unchanged', () => {
  const summary = participantResolutionSummary({
    participantResolution: {
      resolution: 'canonical',
      away: side('team-bos', 'Boston Celtics'),
      home: side('team-nyk', 'New York Knicks'),
      team: side('team-bos', 'Boston Celtics'),
      player: { participantId: 'player-tatum', displayName: 'Jayson Tatum', participantType: 'player' },
    },
  });
  assert.equal(
    summary,
    'Canonical: away: Boston Celtics • home: New York Knicks • team: Boston Celtics • player: Jayson Tatum',
  );
});

test('the pre-existing whole-manual resolution summary is unchanged', () => {
  const summary = participantResolutionSummary({
    participantResolution: {
      resolution: 'manual',
      reason: 'canonical-coverage-gap',
      enteredParticipants: [{ role: 'away', displayName: 'Las Vegas Aces' }],
    },
  });
  assert.equal(summary, 'Manual — canonical-coverage-gap: away: Las Vegas Aces');
});
