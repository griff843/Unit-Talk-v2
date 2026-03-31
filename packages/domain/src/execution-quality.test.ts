import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeExecutionQuality,
  type ExecutionQualityPick,
  type ExecutionQualityReceipt,
} from './execution-quality.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePick(overrides?: Partial<ExecutionQualityPick>): ExecutionQualityPick {
  return {
    created_at: '2026-03-30T18:00:00.000Z',
    odds: -110,
    ...overrides,
  };
}

function makeReceipt(overrides?: Partial<ExecutionQualityReceipt>): ExecutionQualityReceipt {
  return {
    recorded_at: '2026-03-30T18:02:00.000Z', // 2 minutes after submission
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Basic latency
// ---------------------------------------------------------------------------

test('computes submission-to-delivery latency in ms', () => {
  const result = computeExecutionQuality(makePick(), makeReceipt());
  assert.equal(result.submissionToDeliveryMs, 2 * 60 * 1000);
});

test('handles zero latency', () => {
  const pick = makePick({ created_at: '2026-03-30T18:00:00.000Z' });
  const receipt = makeReceipt({ recorded_at: '2026-03-30T18:00:00.000Z' });
  const result = computeExecutionQuality(pick, receipt);
  assert.equal(result.submissionToDeliveryMs, 0);
  assert.equal(result.freshness, 'fresh');
});

// ---------------------------------------------------------------------------
// Game-start comparison
// ---------------------------------------------------------------------------

test('deliveredBeforeGameStart is true when delivery is before game start', () => {
  const result = computeExecutionQuality(makePick(), makeReceipt(), {
    gameStartTime: '2026-03-30T19:00:00.000Z',
  });
  assert.equal(result.deliveredBeforeGameStart, true);
  assert.equal(result.freshness, 'fresh');
});

test('deliveredBeforeGameStart is false when delivery is after game start', () => {
  const result = computeExecutionQuality(makePick(), makeReceipt(), {
    gameStartTime: '2026-03-30T18:01:00.000Z', // game started before delivery
  });
  assert.equal(result.deliveredBeforeGameStart, false);
  assert.equal(result.freshness, 'stale');
});

test('deliveredBeforeGameStart is null when no game start provided', () => {
  const result = computeExecutionQuality(makePick(), makeReceipt());
  assert.equal(result.deliveredBeforeGameStart, null);
});

// ---------------------------------------------------------------------------
// Line movement
// ---------------------------------------------------------------------------

test('computes line movement from submission odds to delivery-time odds', () => {
  const result = computeExecutionQuality(makePick({ odds: -110 }), makeReceipt(), {
    deliveryTimeOdds: -130,
  });
  assert.equal(result.lineMovement, 20);
});

test('lineMovement is null when submission odds are missing', () => {
  const result = computeExecutionQuality(
    makePick({ odds: null }),
    makeReceipt(),
    { deliveryTimeOdds: -130 },
  );
  assert.equal(result.lineMovement, null);
});

test('lineMovement is null when delivery-time odds are missing', () => {
  const result = computeExecutionQuality(makePick({ odds: -110 }), makeReceipt());
  assert.equal(result.lineMovement, null);
});

test('lineMovement is absolute (no negative values)', () => {
  const result = computeExecutionQuality(makePick({ odds: -130 }), makeReceipt(), {
    deliveryTimeOdds: -110,
  });
  assert.equal(result.lineMovement, 20);
});

// ---------------------------------------------------------------------------
// Freshness classification
// ---------------------------------------------------------------------------

test('freshness is fresh for low-latency, pre-game delivery with small line movement', () => {
  const result = computeExecutionQuality(makePick({ odds: -110 }), makeReceipt(), {
    gameStartTime: '2026-03-30T19:00:00.000Z',
    deliveryTimeOdds: -115,
  });
  assert.equal(result.freshness, 'fresh');
});

test('freshness is stale when delivered after game start', () => {
  const result = computeExecutionQuality(makePick(), makeReceipt(), {
    gameStartTime: '2026-03-30T18:01:00.000Z',
  });
  assert.equal(result.freshness, 'stale');
});

test('freshness is stale when latency exceeds 15 minutes', () => {
  const pick = makePick({ created_at: '2026-03-30T17:00:00.000Z' });
  const receipt = makeReceipt({ recorded_at: '2026-03-30T17:20:00.000Z' }); // 20 min
  const result = computeExecutionQuality(pick, receipt);
  assert.equal(result.freshness, 'stale');
});

test('freshness is stale when line movement exceeds 20 points', () => {
  const result = computeExecutionQuality(makePick({ odds: -110 }), makeReceipt(), {
    deliveryTimeOdds: -140, // 30 points movement
  });
  assert.equal(result.freshness, 'stale');
});

test('freshness is fresh when line movement is exactly 20 points', () => {
  const result = computeExecutionQuality(makePick({ odds: -110 }), makeReceipt(), {
    deliveryTimeOdds: -130, // exactly 20 points
  });
  assert.equal(result.freshness, 'fresh');
});

test('freshness is unknown when delivery time is before submission (anomalous)', () => {
  const pick = makePick({ created_at: '2026-03-30T18:05:00.000Z' });
  const receipt = makeReceipt({ recorded_at: '2026-03-30T18:00:00.000Z' });
  const result = computeExecutionQuality(pick, receipt);
  assert.equal(result.freshness, 'unknown');
  assert.ok(result.submissionToDeliveryMs < 0);
});

test('freshness is fresh with minimal context (just timestamps, within threshold)', () => {
  const result = computeExecutionQuality(makePick({ odds: null }), makeReceipt());
  assert.equal(result.freshness, 'fresh');
  assert.equal(result.lineMovement, null);
  assert.equal(result.deliveredBeforeGameStart, null);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test('handles exactly 15-minute latency as fresh (threshold is exclusive)', () => {
  const pick = makePick({ created_at: '2026-03-30T18:00:00.000Z' });
  const receipt = makeReceipt({ recorded_at: '2026-03-30T18:15:00.000Z' }); // exactly 15 min
  const result = computeExecutionQuality(pick, receipt);
  assert.equal(result.submissionToDeliveryMs, 15 * 60 * 1000);
  assert.equal(result.freshness, 'fresh');
});

test('stale from post-game trumps fresh latency and line movement', () => {
  const result = computeExecutionQuality(makePick({ odds: -110 }), makeReceipt(), {
    gameStartTime: '2026-03-30T18:01:30.000Z', // game started between submission and delivery
    deliveryTimeOdds: -112, // minimal movement
  });
  assert.equal(result.freshness, 'stale');
  assert.equal(result.deliveredBeforeGameStart, false);
});
