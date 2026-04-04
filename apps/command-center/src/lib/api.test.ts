import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveSignals, mapPickRows, resolveLaneHealth } from './api.js';

test('mapPickRows surfaces smart form truth for submitter, delivery, and intelligence', () => {
  const rows = mapPickRows(
    [
      {
        id: 'pick-1',
        created_at: '2026-04-03T12:00:00.000Z',
        status: 'posted',
        source: 'smart-form',
        market: 'points-all-game-ou',
        selection: 'Over 24.5',
        line: 24.5,
        odds: -110,
        stake_units: 1.5,
        promotion_status: 'qualified',
        promotion_target: 'best-bets',
        promotion_score: 81.2,
        promotion_reason: null,
        metadata: {
          submittedBy: 'griff843',
          sport: 'NBA',
          domainAnalysis: {
            realEdge: 0.08,
            realEdgeSource: 'pinnacle',
          },
          deviggingResult: {
            impliedProbability: 0.54,
          },
          kellySizing: {
            fraction: 0.03,
          },
        },
      },
    ],
    [
      {
        id: 'pick-1',
        settlementResult: 'win',
      },
    ],
    [
      {
        id: 'outbox-1',
        pick_id: 'pick-1',
        status: 'sent',
      },
    ],
    [
      {
        id: 'settlement-1',
        pick_id: 'pick-1',
        status: 'settled',
        payload: {
          clvRaw: 0.14,
        },
      },
    ],
    [
      {
        id: 'receipt-1',
        outbox_id: 'outbox-1',
        channel: 'discord:best-bets',
        status: 'sent',
      },
    ],
  );

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    id: 'pick-1',
    submittedAt: '2026-04-03T12:00:00.000Z',
    submitter: 'griff843',
    source: 'smart-form',
    sport: 'NBA',
    pickDetails: {
      market: 'points-all-game-ou',
      selection: 'Over 24.5',
      line: 24.5,
      odds: -110,
    },
    unitSize: 1.5,
    score: 81.2,
    lifecycleStatus: 'posted',
    promotionStatus: 'qualified',
    promotionReason: null,
    promotionTarget: 'best-bets',
    deliveryStatus: 'delivered',
    receiptStatus: 'sent',
    receiptChannel: 'discord:best-bets',
    settlementStatus: 'settled',
    result: 'win',
    intelligence: {
      domainAnalysis: true,
      deviggingResult: true,
      kellySizing: true,
      realEdge: true,
      edgeSource: 'pinnacle',
      clv: true,
    },
  });
});

test('deriveSignals treats zero settled picks as working during an active slate', () => {
  const signals = deriveSignals(
    {
      data: {
        counts: {
          deadLetterOutbox: 0,
          failedOutbox: 0,
          pendingManualReview: 0,
        },
        recentPicks: [
          {
            id: 'pick-1',
            promotion_score: 81,
            promotion_status: 'qualified',
          },
        ],
        recentReceipts: [{ id: 'receipt-1' }],
        recentSettlements: [],
      },
    },
    {
      data: {
        by_result: {},
        total_picks: 0,
      },
    },
    {
      data: {
        counts: {
          settled: 0,
        },
      },
    },
  );

  const settlement = signals.find((signal) => signal.signal === 'settlement');
  assert.deepEqual(settlement, {
    signal: 'settlement',
    status: 'WORKING',
    detail: 'No settled picks yet',
  });
});

test('resolveLaneHealth falls back to failure-free activation lanes when snapshot booleans are absent', () => {
  assert.equal(
    resolveLaneHealth(
      {
        recentSentCount: 0,
        recentFailureCount: 0,
        recentDeadLetterCount: 0,
      },
      'activation',
    ),
    true,
  );

  assert.equal(
    resolveLaneHealth(
      {
        recentSentCount: 0,
        recentFailureCount: 1,
        recentDeadLetterCount: 0,
      },
      'activation',
    ),
    false,
  );

  assert.equal(
    resolveLaneHealth(
      {
        recentSentCount: 0,
        recentFailureCount: 0,
        recentDeadLetterCount: 0,
      },
      'canary',
    ),
    false,
  );
});
