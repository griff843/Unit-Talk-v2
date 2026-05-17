import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseSubmissionPayload,
  validateSubmissionPayload,
  pickSources,
  type SubmissionPayload,
  type ParseSubmissionResult,
} from './submission.js';

test('parseSubmissionPayload accepts a minimal valid payload', () => {
  const result = parseSubmissionPayload({ source: 'api', market: 'NBA - Lakers vs Celtics', selection: 'Lakers -4.5' });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error();
  assert.equal(result.data.source, 'api');
  assert.equal(result.data.market, 'NBA - Lakers vs Celtics');
  assert.equal(result.data.selection, 'Lakers -4.5');
});

test('parseSubmissionPayload accepts all optional fields', () => {
  const raw = {
    source: 'smart-form',
    market: 'NFL - Chiefs vs Bills',
    selection: 'Chiefs ML',
    submittedBy: 'user123',
    line: -3.5,
    odds: -110,
    stakeUnits: 1.5,
    confidence: 0.75,
    eventName: 'Chiefs vs Bills',
    thesis: 'Chiefs at home strong',
    metadata: { league: 'AFC' },
  };
  const result = parseSubmissionPayload(raw);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error();
  assert.equal(result.data.confidence, 0.75);
  assert.deepEqual(result.data.metadata, { league: 'AFC' });
});

test('parseSubmissionPayload rejects non-object input', () => {
  for (const bad of [null, 'string', 42, [], true]) {
    const r = parseSubmissionPayload(bad);
    assert.equal(r.ok, false);
    if (r.ok) throw new Error();
    assert.ok(r.errors.length > 0);
  }
});

test('parseSubmissionPayload rejects invalid source enum', () => {
  const result = parseSubmissionPayload({ source: 'unknown-source', market: 'NBA', selection: 'Lakers' });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error();
  assert.ok(result.errors.some(e => e.includes('source must be one of')));
});

test('parseSubmissionPayload rejects missing required fields', () => {
  const noMarket = parseSubmissionPayload({ source: 'api', selection: 'Lakers' });
  assert.equal(noMarket.ok, false);

  const noSelection = parseSubmissionPayload({ source: 'api', market: 'NBA' });
  assert.equal(noSelection.ok, false);

  const emptyMarket = parseSubmissionPayload({ source: 'api', market: '  ', selection: 'Lakers' });
  assert.equal(emptyMarket.ok, false);
});

test('parseSubmissionPayload rejects confidence out of [0, 1]', () => {
  const tooHigh = parseSubmissionPayload({ source: 'api', market: 'NBA', selection: 'Lakers', confidence: 1.5 });
  assert.equal(tooHigh.ok, false);
  if (tooHigh.ok) throw new Error();
  assert.ok(tooHigh.errors.some(e => e.includes('confidence must be between 0 and 1')));

  const negative = parseSubmissionPayload({ source: 'api', market: 'NBA', selection: 'Lakers', confidence: -0.1 });
  assert.equal(negative.ok, false);
});

test('parseSubmissionPayload rejects wrong-typed optional fields', () => {
  const badLine = parseSubmissionPayload({ source: 'api', market: 'NBA', selection: 'Lakers', line: 'three' });
  assert.equal(badLine.ok, false);

  const badMeta = parseSubmissionPayload({ source: 'api', market: 'NBA', selection: 'Lakers', metadata: [1, 2, 3] });
  assert.equal(badMeta.ok, false);
});

test('parseSubmissionPayload covers all pickSources', () => {
  for (const source of pickSources) {
    const r = parseSubmissionPayload({ source, market: 'NBA', selection: 'Lakers' });
    assert.equal(r.ok, true, `source "${source}" should be valid`);
  }
});

test('validateSubmissionPayload passes a typed SubmissionPayload', () => {
  const validPayload: SubmissionPayload = { source: 'api', market: 'NBA', selection: 'Lakers' };
  const r = validateSubmissionPayload(validPayload);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('ParseSubmissionResult ok:true carries SubmissionPayload type', () => {
  const result: ParseSubmissionResult = parseSubmissionPayload({ source: 'api', market: 'NBA', selection: 'Lakers' });
  if (!result.ok) throw new Error('expected ok');
  const payload: SubmissionPayload = result.data;
  assert.equal(payload.source, 'api');
});

test('parseSubmissionPayload and validateSubmissionPayload agree on valid typed payloads', () => {
  const payload: SubmissionPayload = {
    source: 'smart-form',
    market: 'MLB - Yankees vs Red Sox',
    selection: 'Yankees -1.5',
    odds: -130,
    stakeUnits: 2,
  };
  const parse = parseSubmissionPayload(payload);
  const validate = validateSubmissionPayload(payload);
  assert.equal(parse.ok, true);
  assert.equal(validate.ok, true);
});
