import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeCorrelationPenalty,
  detectCorrelatedPicks,
  extractEventKey,
} from './correlation-detection.js';
import type { CanonicalPick } from '@unit-talk/contracts';

function makePick(overrides: Partial<CanonicalPick> & { id: string }): CanonicalPick {
  return {
    submissionId: 'sub-1',
    market: 'spread',
    selection: 'over',
    source: 'analyst-1',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'validated',
    metadata: {},
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

test('detectCorrelatedPicks: no correlation when no shared event', () => {
  const newPick = makePick({
    id: 'pick-new',
    metadata: { eventName: 'LAL vs BOS 2026-01-15' },
  });
  const openPicks = [
    makePick({
      id: 'pick-1',
      metadata: { eventName: 'NYK vs MIA 2026-01-15' },
    }),
  ];

  const result = detectCorrelatedPicks(newPick, openPicks);
  assert.equal(result.hasCorrelation, false);
  assert.equal(result.matches.length, 0);
  assert.equal(result.maxStrength, 0);
});

test('detectCorrelatedPicks: no correlation when no event metadata', () => {
  const newPick = makePick({ id: 'pick-new', metadata: {} });
  const openPicks = [
    makePick({ id: 'pick-1', metadata: {} }),
  ];

  const result = detectCorrelatedPicks(newPick, openPicks);
  assert.equal(result.hasCorrelation, false);
});

test('detectCorrelatedPicks: same-side correlation (same market, same selection)', () => {
  const newPick = makePick({
    id: 'pick-new',
    market: 'total_points',
    selection: 'over',
    metadata: { eventName: 'LAL vs BOS 2026-01-15' },
  });
  const openPicks = [
    makePick({
      id: 'pick-existing',
      market: 'total_points',
      selection: 'over',
      metadata: { eventName: 'LAL vs BOS 2026-01-15' },
    }),
  ];

  const result = detectCorrelatedPicks(newPick, openPicks);
  assert.equal(result.hasCorrelation, true);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]!.correlationType, 'same-side');
  assert.equal(result.matches[0]!.strength, 1.0);
  assert.equal(result.maxStrength, 1.0);
  assert.equal(result.correlatedCount, 1);
});

test('detectCorrelatedPicks: opposite-side has zero strength', () => {
  const newPick = makePick({
    id: 'pick-new',
    market: 'total_points',
    selection: 'over',
    metadata: { eventName: 'LAL vs BOS 2026-01-15' },
  });
  const openPicks = [
    makePick({
      id: 'pick-existing',
      market: 'total_points',
      selection: 'under',
      metadata: { eventName: 'LAL vs BOS 2026-01-15' },
    }),
  ];

  const result = detectCorrelatedPicks(newPick, openPicks);
  // Opposite-side has strength 0, so hasCorrelation should be false
  assert.equal(result.hasCorrelation, false);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]!.correlationType, 'opposite-side');
  assert.equal(result.maxStrength, 0);
});

test('detectCorrelatedPicks: same-game-different-market', () => {
  const newPick = makePick({
    id: 'pick-new',
    market: 'moneyline',
    selection: 'LAL',
    metadata: { eventName: 'LAL vs BOS 2026-01-15' },
  });
  const openPicks = [
    makePick({
      id: 'pick-existing',
      market: 'spread',
      selection: 'LAL -3.5',
      metadata: { eventName: 'LAL vs BOS 2026-01-15' },
    }),
  ];

  const result = detectCorrelatedPicks(newPick, openPicks);
  assert.equal(result.hasCorrelation, true);
  assert.equal(result.matches[0]!.correlationType, 'same-game-different-market');
  assert.equal(result.matches[0]!.strength, 0.4);
});

test('detectCorrelatedPicks: skips picks from different sources', () => {
  const newPick = makePick({
    id: 'pick-new',
    source: 'analyst-1',
    metadata: { eventName: 'LAL vs BOS 2026-01-15' },
  });
  const openPicks = [
    makePick({
      id: 'pick-existing',
      source: 'analyst-2',
      metadata: { eventName: 'LAL vs BOS 2026-01-15' },
    }),
  ];

  const result = detectCorrelatedPicks(newPick, openPicks);
  assert.equal(result.hasCorrelation, false);
});

test('detectCorrelatedPicks: skips self', () => {
  const pick = makePick({
    id: 'pick-1',
    metadata: { eventName: 'LAL vs BOS 2026-01-15' },
  });

  const result = detectCorrelatedPicks(pick, [pick]);
  assert.equal(result.hasCorrelation, false);
  assert.equal(result.matches.length, 0);
});

test('detectCorrelatedPicks: event key normalization (case insensitive)', () => {
  const newPick = makePick({
    id: 'pick-new',
    market: 'spread',
    selection: 'over',
    metadata: { eventName: 'LAL vs BOS 2026-01-15' },
  });
  const openPicks = [
    makePick({
      id: 'pick-existing',
      market: 'spread',
      selection: 'over',
      metadata: { eventName: 'lal vs bos 2026-01-15' },
    }),
  ];

  const result = detectCorrelatedPicks(newPick, openPicks);
  assert.equal(result.hasCorrelation, true);
});

test('detectCorrelatedPicks: uses metadata.event fallback', () => {
  const newPick = makePick({
    id: 'pick-new',
    market: 'spread',
    selection: 'over',
    metadata: { event: 'LAL vs BOS 2026-01-15' },
  });
  const openPicks = [
    makePick({
      id: 'pick-existing',
      market: 'spread',
      selection: 'over',
      metadata: { event: 'LAL vs BOS 2026-01-15' },
    }),
  ];

  const result = detectCorrelatedPicks(newPick, openPicks);
  assert.equal(result.hasCorrelation, true);
});

test('detectCorrelatedPicks: uses metadata.gameId fallback', () => {
  const newPick = makePick({
    id: 'pick-new',
    market: 'spread',
    selection: 'over',
    metadata: { gameId: 'game-123' },
  });
  const openPicks = [
    makePick({
      id: 'pick-existing',
      market: 'spread',
      selection: 'over',
      metadata: { gameId: 'game-123' },
    }),
  ];

  const result = detectCorrelatedPicks(newPick, openPicks);
  assert.equal(result.hasCorrelation, true);
});

test('detectCorrelatedPicks: multiple correlated picks on same event', () => {
  const newPick = makePick({
    id: 'pick-new',
    market: 'total_points',
    selection: 'over',
    metadata: { eventName: 'LAL vs BOS 2026-01-15' },
  });
  const openPicks = [
    makePick({
      id: 'pick-1',
      market: 'total_points',
      selection: 'over',
      metadata: { eventName: 'LAL vs BOS 2026-01-15' },
    }),
    makePick({
      id: 'pick-2',
      market: 'spread',
      selection: 'LAL -3.5',
      metadata: { eventName: 'LAL vs BOS 2026-01-15' },
    }),
  ];

  const result = detectCorrelatedPicks(newPick, openPicks);
  assert.equal(result.hasCorrelation, true);
  assert.equal(result.matches.length, 2);
  assert.equal(result.maxStrength, 1.0);
  assert.equal(result.correlatedCount, 2);
});

// --- computeCorrelationPenalty ---

test('computeCorrelationPenalty: no correlation → 0', () => {
  const penalty = computeCorrelationPenalty({
    hasCorrelation: false,
    matches: [],
    maxStrength: 0,
    correlatedCount: 0,
  });
  assert.equal(penalty, 0);
});

test('computeCorrelationPenalty: single same-side → -15', () => {
  const penalty = computeCorrelationPenalty({
    hasCorrelation: true,
    matches: [{
      existingPickId: 'p1',
      correlationType: 'same-side',
      eventKey: 'event',
      strength: 1.0,
    }],
    maxStrength: 1.0,
    correlatedCount: 1,
  });
  assert.equal(penalty, -15);
});

test('computeCorrelationPenalty: two same-side → -18', () => {
  const penalty = computeCorrelationPenalty({
    hasCorrelation: true,
    matches: [
      { existingPickId: 'p1', correlationType: 'same-side', eventKey: 'event', strength: 1.0 },
      { existingPickId: 'p2', correlationType: 'same-side', eventKey: 'event', strength: 1.0 },
    ],
    maxStrength: 1.0,
    correlatedCount: 2,
  });
  assert.equal(penalty, -18);
});

test('computeCorrelationPenalty: three same-side capped at -20', () => {
  const penalty = computeCorrelationPenalty({
    hasCorrelation: true,
    matches: [
      { existingPickId: 'p1', correlationType: 'same-side', eventKey: 'event', strength: 1.0 },
      { existingPickId: 'p2', correlationType: 'same-side', eventKey: 'event', strength: 1.0 },
      { existingPickId: 'p3', correlationType: 'same-side', eventKey: 'event', strength: 1.0 },
    ],
    maxStrength: 1.0,
    correlatedCount: 3,
  });
  assert.equal(penalty, -20);
});

test('computeCorrelationPenalty: single same-game-different-market → -6', () => {
  const penalty = computeCorrelationPenalty({
    hasCorrelation: true,
    matches: [{
      existingPickId: 'p1',
      correlationType: 'same-game-different-market',
      eventKey: 'event',
      strength: 0.4,
    }],
    maxStrength: 0.4,
    correlatedCount: 1,
  });
  assert.equal(penalty, -6);
});

test('computeCorrelationPenalty: two same-game-different-market → -9', () => {
  const penalty = computeCorrelationPenalty({
    hasCorrelation: true,
    matches: [
      { existingPickId: 'p1', correlationType: 'same-game-different-market', eventKey: 'event', strength: 0.4 },
      { existingPickId: 'p2', correlationType: 'same-game-different-market', eventKey: 'event', strength: 0.4 },
    ],
    maxStrength: 0.4,
    correlatedCount: 2,
  });
  assert.equal(penalty, -9);
});

// --- extractEventKey ---

test('extractEventKey: returns null when no event metadata', () => {
  const pick = makePick({ id: 'p1', metadata: {} });
  assert.equal(extractEventKey(pick), null);
});

test('extractEventKey: reads eventName first', () => {
  const pick = makePick({
    id: 'p1',
    metadata: { eventName: 'LAL vs BOS', event: 'other', gameId: 'g1' },
  });
  assert.equal(extractEventKey(pick), 'lal vs bos');
});

test('extractEventKey: falls back to event', () => {
  const pick = makePick({
    id: 'p1',
    metadata: { event: 'NYK vs MIA', gameId: 'g1' },
  });
  assert.equal(extractEventKey(pick), 'nyk vs mia');
});

test('extractEventKey: falls back to gameId', () => {
  const pick = makePick({
    id: 'p1',
    metadata: { gameId: 'GAME-456' },
  });
  assert.equal(extractEventKey(pick), 'game-456');
});
