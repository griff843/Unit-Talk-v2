import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_PICK_BUILDER_INPUT,
  buildSubmissionDraft,
  computePickReadiness,
  type PickBuilderInput,
} from './pick-builder-model.js';

function filled(overrides: Partial<PickBuilderInput> = {}): PickBuilderInput {
  return {
    ...EMPTY_PICK_BUILDER_INPUT,
    sport: 'Baseball',
    league: 'MLB',
    event: 'NYY @ BOS',
    market: 'total_runs',
    selection: 'Over',
    line: '8.5',
    odds: '-110',
    book: 'DraftKings',
    confidence: '0.72',
    tierDestination: 'gold',
    riskRating: 'medium',
    reasoning: 'Bullpen fatigue on both sides.',
    dispatchTarget: 'discord',
    ...overrides,
  };
}

test('empty input reports all required fields missing and is not valid', () => {
  const r = computePickReadiness(EMPTY_PICK_BUILDER_INPUT);
  assert.equal(r.valid, false);
  assert.equal(r.dispatchReady, false);
  assert.ok(r.missingFields.includes('Sport'));
  assert.ok(r.missingFields.includes('Reasoning'));
  assert.equal(r.approvalRequired, true);
});

test('fully filled input is valid and dispatch ready; approval always required', () => {
  const r = computePickReadiness(filled());
  assert.deepEqual(r.missingFields, []);
  assert.deepEqual(r.fieldErrors, {});
  assert.equal(r.valid, true);
  assert.equal(r.dispatchReady, true);
  assert.equal(r.approvalRequired, true);
});

test('valid but no book/dispatch target is valid yet not dispatch ready', () => {
  const r = computePickReadiness(filled({ book: '', dispatchTarget: '' }));
  assert.equal(r.valid, true);
  assert.equal(r.dispatchReady, false);
});

test('rejects malformed numerics and out-of-range values', () => {
  const r = computePickReadiness(
    filled({ line: 'abc', odds: '-50', confidence: '1.5', scheduledTime: 'not-a-date' }),
  );
  assert.equal(r.valid, false);
  assert.match(r.fieldErrors['line'] ?? '', /numeric/);
  assert.match(r.fieldErrors['odds'] ?? '', /American/);
  assert.match(r.fieldErrors['confidence'] ?? '', /between 0 and 1/);
  assert.match(r.fieldErrors['scheduledTime'] ?? '', /valid date/);
});

test('rejects unknown tier and risk rating', () => {
  const r = computePickReadiness(filled({ tierDestination: 'diamond', riskRating: 'extreme' }));
  assert.equal(r.valid, false);
  assert.ok(r.fieldErrors['tierDestination']);
  assert.ok(r.fieldErrors['riskRating']);
});

test('buildSubmissionDraft maps to SubmissionPayload contract shape', () => {
  const d = buildSubmissionDraft(filled({ injuryNotes: 'SS questionable' }));
  assert.equal(d.source, 'api');
  assert.equal(d.market, 'total_runs');
  assert.equal(d.selection, 'Over');
  assert.equal(d.line, 8.5);
  assert.equal(d.odds, -110);
  assert.equal(d.confidence, 0.72);
  assert.equal(d.eventName, 'NYY @ BOS');
  assert.equal(d.thesis, 'Bullpen fatigue on both sides.');
  assert.equal(d.metadata['tierDestination'], 'gold');
  assert.equal(d.metadata['injuryNotes'], 'SS questionable');
  assert.equal(d.metadata['composer'], 'command-center-pick-builder');
  assert.ok(!('movementNotes' in d.metadata), 'empty optional fields omitted from metadata');
});

test('buildSubmissionDraft omits optional numerics when blank', () => {
  const d = buildSubmissionDraft(filled({ line: '', confidence: '' }));
  assert.ok(!('line' in d));
  assert.ok(!('confidence' in d));
});
