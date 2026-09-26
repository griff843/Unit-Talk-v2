import test from 'node:test';
import assert from 'node:assert/strict';
import { humanCapperDeliveryAuthorizationVersion } from '@unit-talk/contracts';
import { buildPromotionPresentation, readRealEdgePresence } from './promotion-presentation';
import { buildScoreInsight } from './score-insight';

const authorized = {
  deliveryAuthorization: {
    version: humanCapperDeliveryAuthorizationVersion,
    decision: 'authorized',
    authority: 'server-allowlist',
    capperId: 'griff843',
    decidedAt: '2026-09-19T02:00:00.000Z',
  },
};

// Shaped like the 2cc92f4b observation (2026-09-19): explicit hasRealEdge:false
// beside a numeric realEdge. The numeric value here is illustrative.
const observed = {
  ...authorized,
  band: 'SUPPRESS',
  hasRealEdge: false,
  realEdge: 0.012,
  realEdgeSource: 'confidence-delta',
};

test('UTV2-1902: a human capper delivery pick with no board target renders the absence, not a lane', () => {
  const view = buildPromotionPresentation({
    promotionStatus: 'suppressed',
    promotionTarget: null,
    promotionScore: 32.75,
    promotionReason: 'score 32.75 below minimum 70',
    metadata: observed,
    promotionHistory: [{ overrideAction: null }],
  });
  assert.equal(view.boardLabel, 'No board target (human capper delivery)');
  assert.match(view.qualificationNote, /for information only/);
  assert.doesNotMatch(view.boardLabel, /best-bets/);
  assert.equal(view.qualificationBasis, 'none');
  assert.equal(view.band, 'SUPPRESS');
  assert.equal(view.reason, 'score 32.75 below minimum 70');
  assert.equal(view.humanCapperDelivery, true);
  assert.equal(view.boardOverrideAvailable, false);
});

test('UTV2-1902: a force_promote history row reads as an override, never as score qualification', () => {
  const view = buildPromotionPresentation({
    promotionStatus: 'qualified',
    promotionTarget: 'best-bets',
    promotionScore: 32.75,
    promotionReason: 'smart-form submissions route directly to best-bets',
    metadata: {},
    promotionHistory: [{ overrideAction: 'force_promote' }, { overrideAction: null }],
  });
  assert.equal(view.qualificationBasis, 'override');
  assert.match(view.qualificationNote, /not by score/);
  assert.equal(view.boardOverrideAvailable, true);
});

test('UTV2-1902: a legacy force-promoted pick reads as an override when a tied non-winner row sorts first', () => {
  // The pre-UTV2-1902 Smart Form path wrote the best-bets winner and the
  // suppressed non-winner rows with one decided_at, so the loader's order among
  // them is arbitrary. The winner is the row for the persisted target.
  const view = buildPromotionPresentation({
    promotionStatus: 'qualified',
    promotionTarget: 'best-bets',
    promotionScore: 32.75,
    promotionReason: 'smart-form submissions route directly to best-bets',
    metadata: {},
    promotionHistory: [
      { target: 'trader-insights', overrideAction: null },
      { target: 'best-bets', overrideAction: 'force_promote' },
      { target: 'exclusive-insights', overrideAction: null },
    ],
  });
  assert.equal(view.qualificationBasis, 'override');
  assert.doesNotMatch(view.qualificationNote, /^Qualified for/);
});

test('UTV2-1902: score-qualified picks say so', () => {
  const view = buildPromotionPresentation({
    promotionStatus: 'qualified',
    promotionTarget: 'best-bets',
    promotionScore: 76.2,
    promotionReason: null,
    metadata: {},
    promotionHistory: [{ overrideAction: null }],
  });
  assert.equal(view.qualificationBasis, 'score');
  assert.equal(view.boardLabel, 'best-bets');
});

test('UTV2-1902: explicit hasRealEdge:false wins over a numeric realEdge', () => {
  assert.equal(readRealEdgePresence(observed), 'absent');
  assert.equal(readRealEdgePresence({ domainAnalysis: { hasRealEdge: false, realEdge: 0.05 } }), 'absent');
  assert.equal(readRealEdgePresence({ hasRealEdge: true, realEdge: 0.05 }), 'present');
  assert.equal(readRealEdgePresence({ realEdge: 0.05 }), 'present');
  assert.equal(readRealEdgePresence({}), 'missing');
});

test('UTV2-1902: the canonical top-level realEdgeSource is the edge source shown', () => {
  assert.equal(buildScoreInsight(observed).edgeSource, 'confidence-delta');
});

test('UTV2-1902: a high-scoring human capper pick is described as information, not qualification', () => {
  const view = buildPromotionPresentation({
    promotionStatus: 'suppressed',
    promotionTarget: null,
    promotionScore: 81.4,
    promotionReason: 'human capper delivery pick: board promotion not applicable (delivered via official-picks authorization)',
    metadata: authorized,
    promotionHistory: [{ overrideAction: null }],
  });
  assert.equal(view.qualificationBasis, 'none');
  assert.match(view.qualificationNote, /Scored 81\.4 for information only/);
  assert.doesNotMatch(view.boardLabel, /best-bets|qualified/);
});

test('UTV2-1902: a non-human pick with no target reports its own status', () => {
  const view = buildPromotionPresentation({
    promotionStatus: 'not_eligible',
    promotionTarget: null,
    promotionScore: 40,
    promotionReason: null,
    metadata: {},
    promotionHistory: [],
  });
  assert.equal(view.boardLabel, 'No board target (not_eligible)');
  assert.equal(view.humanCapperDelivery, false);
});
