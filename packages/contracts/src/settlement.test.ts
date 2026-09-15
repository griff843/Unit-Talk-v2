import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  settlementSources,
  settlementStatuses,
  settlementResults,
  settlementConfidences,
  validateSettlementRequest,
  validateOperatorGradingContext,
  type OperatorGradingContext,
  type SettlementRequest,
} from './settlement.js';

describe('settlement source contract', () => {
  test('settlementSources includes all required values', () => {
    const required = ['operator', 'api', 'feed', 'grading'] as const;
    for (const source of required) {
      assert.ok(
        settlementSources.includes(source),
        `'${source}' must be a valid settlement source`,
      );
    }
  });

  test('settlementSources has no unexpected values', () => {
    const allowed = new Set(['operator', 'api', 'feed', 'grading']);
    for (const source of settlementSources) {
      assert.ok(allowed.has(source), `unexpected settlement source: '${source}'`);
    }
  });

  test('all settlement source values are non-empty strings', () => {
    for (const source of settlementSources) {
      assert.ok(source.length > 0, 'settlement source must be non-empty');
    }
  });
});

describe('validateSettlementRequest', () => {
  const validRequest: SettlementRequest = {
    status: 'settled',
    result: 'win',
    source: 'operator',
    confidence: 'confirmed',
    evidenceRef: 'proof://test',
    settledBy: 'test-operator',
  };

  test('accepts valid settlement request for each source', () => {
    for (const source of settlementSources) {
      const result = validateSettlementRequest({ ...validRequest, source });
      assert.ok(result.ok, `source '${source}' should be valid: ${result.errors.join(', ')}`);
    }
  });

  test('rejects unknown source', () => {
    const result = validateSettlementRequest({
      ...validRequest,
      source: 'unknown' as SettlementRequest['source'],
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((e) => e.includes('source')));
  });

  test('accepts all valid statuses', () => {
    for (const status of settlementStatuses) {
      const req: SettlementRequest =
        status === 'manual_review'
          ? { ...validRequest, status, result: undefined, reviewReason: 'needs review' }
          : { ...validRequest, status };
      const result = validateSettlementRequest(req);
      assert.ok(result.ok, `status '${status}' should be valid: ${result.errors.join(', ')}`);
    }
  });

  test('accepts all valid results for settled status', () => {
    for (const resultVal of settlementResults) {
      const result = validateSettlementRequest({ ...validRequest, result: resultVal });
      assert.ok(result.ok, `result '${resultVal}' should be valid: ${result.errors.join(', ')}`);
    }
  });

  test('accepts all valid confidences', () => {
    for (const confidence of settlementConfidences) {
      const result = validateSettlementRequest({ ...validRequest, confidence });
      assert.ok(result.ok, `confidence '${confidence}' should be valid: ${result.errors.join(', ')}`);
    }
  });
});

describe('operator grading context contract', () => {
  const validContext: OperatorGradingContext = {
    outcomeBasis: 'Final box score, Lions 24 - Bears 17',
    resultSourceUrl: 'https://www.nfl.com/games/lions-at-bears',
    observedAt: '2026-09-14T18:30:00.000Z',
  };

  test('accepts a fully attested context', () => {
    assert.deepEqual(validateOperatorGradingContext(validContext), []);
  });

  for (const field of ['outcomeBasis', 'resultSourceUrl', 'observedAt'] as const) {
    test(`refuses a missing ${field}`, () => {
      const errors = validateOperatorGradingContext({
        ...validContext,
        [field]: '',
      });
      assert.ok(
        errors.some((e) => e.includes(field)),
        `expected an error naming ${field}, got: ${errors.join(', ')}`,
      );
    });

    // Whitespace is the interesting case: `!''` and `!'   '` differ, and a
    // context whose basis is three spaces attests to nothing.
    test(`refuses a whitespace-only ${field}`, () => {
      const errors = validateOperatorGradingContext({
        ...validContext,
        [field]: '   ',
      });
      assert.ok(
        errors.some((e) => e.includes(field)),
        `expected an error naming ${field}, got: ${errors.join(', ')}`,
      );
    });
  }

  test('refuses an observedAt that is not a parseable instant', () => {
    const errors = validateOperatorGradingContext({
      ...validContext,
      observedAt: 'last tuesday',
    });
    assert.ok(errors.some((e) => e.includes('ISO-8601')));
  });

  test('a settlement request without the context is still valid', () => {
    // Load-bearing: the field is optional on the shared request shape, because
    // the posted/settled paths resolve provenance from the pick's own history.
    // If this ever became required, every existing caller would break.
    const result = validateSettlementRequest({
      status: 'settled',
      result: 'win',
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: 'manual:box-score',
      settledBy: 'griff843',
    });
    assert.ok(result.ok, result.errors.join(', '));
  });

  test('a malformed context fails the whole settlement request', () => {
    const result = validateSettlementRequest({
      status: 'settled',
      result: 'win',
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: 'manual:box-score',
      settledBy: 'griff843',
      operatorGradingContext: { ...validContext, resultSourceUrl: '' },
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((e) => e.includes('resultSourceUrl')));
  });
});
