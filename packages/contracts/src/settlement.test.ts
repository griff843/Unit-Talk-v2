import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  settlementSources,
  settlementStatuses,
  settlementResults,
  settlementConfidences,
  validateSettlementRequest,
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
