import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validateDualAuthorization,
  validateSettlementCorrectionInput,
  buildCorrectionLineage,
  type DualAuthorization,
  type SettlementCorrectionInput,
} from './settlement-correction.js';

const AUTH_OK: DualAuthorization = {
  authorizer_1: 'user-a',
  authorizer_2: 'user-b',
  justification: 'Manual correction for data entry error',
};

const CORRECTION_INPUT_OK: SettlementCorrectionInput = {
  prior_record_id: 'prior-uuid',
  pick_id: 'pick-uuid',
  result: 'win',
  source: 'manual',
  confidence: 'confirmed',
  evidence_ref: 'ref-001',
  settled_by: 'user-a',
  settled_at: '2026-05-31T00:00:00Z',
  authorization: AUTH_OK,
};

// ── validateDualAuthorization ─────────────────────────────────────────────────

test('validateDualAuthorization — passes with two distinct authorizers', () => {
  const result = validateDualAuthorization(AUTH_OK);
  assert.ok(result.ok);
});

test('validateDualAuthorization — rejects missing authorizer_1', () => {
  const result = validateDualAuthorization({ ...AUTH_OK, authorizer_1: '' });
  assert.ok(!result.ok);
  assert.ok(result.errors.some((e) => e.includes('DUAL_AUTH_MISSING_AUTHORIZER_1')));
});

test('validateDualAuthorization — rejects missing authorizer_2', () => {
  const result = validateDualAuthorization({ ...AUTH_OK, authorizer_2: '' });
  assert.ok(!result.ok);
  assert.ok(result.errors.some((e) => e.includes('DUAL_AUTH_MISSING_AUTHORIZER_2')));
});

test('validateDualAuthorization — rejects same identity', () => {
  const result = validateDualAuthorization({
    ...AUTH_OK,
    authorizer_1: 'same-user',
    authorizer_2: 'same-user',
  });
  assert.ok(!result.ok);
  assert.ok(result.errors.some((e) => e.includes('DUAL_AUTH_SAME_IDENTITY')));
});

test('validateDualAuthorization — rejects whitespace-only identity as same', () => {
  const result = validateDualAuthorization({
    ...AUTH_OK,
    authorizer_1: '  user-x  ',
    authorizer_2: 'user-x',
  });
  assert.ok(!result.ok);
  assert.ok(result.errors.some((e) => e.includes('DUAL_AUTH_SAME_IDENTITY')));
});

test('validateDualAuthorization — rejects missing justification', () => {
  const result = validateDualAuthorization({ ...AUTH_OK, justification: '' });
  assert.ok(!result.ok);
  assert.ok(result.errors.some((e) => e.includes('DUAL_AUTH_MISSING_JUSTIFICATION')));
});

test('validateDualAuthorization — accumulates multiple errors', () => {
  const result = validateDualAuthorization({
    authorizer_1: '',
    authorizer_2: '',
    justification: '',
  });
  assert.ok(!result.ok);
  assert.ok(result.errors.length >= 2);
});

// ── validateSettlementCorrectionInput ────────────────────────────────────────

test('validateSettlementCorrectionInput — passes with valid input', () => {
  const result = validateSettlementCorrectionInput(CORRECTION_INPUT_OK);
  assert.ok(result.ok);
});

test('validateSettlementCorrectionInput — rejects missing prior_record_id', () => {
  const result = validateSettlementCorrectionInput({
    ...CORRECTION_INPUT_OK,
    prior_record_id: '',
  });
  assert.ok(!result.ok);
  assert.ok(result.errors.some((e) => e.includes('CORRECTION_MISSING_PRIOR_RECORD_ID')));
});

test('validateSettlementCorrectionInput — rejects missing pick_id', () => {
  const result = validateSettlementCorrectionInput({
    ...CORRECTION_INPUT_OK,
    pick_id: '',
  });
  assert.ok(!result.ok);
  assert.ok(result.errors.some((e) => e.includes('CORRECTION_MISSING_PICK_ID')));
});

test('validateSettlementCorrectionInput — propagates dual-auth errors', () => {
  const result = validateSettlementCorrectionInput({
    ...CORRECTION_INPUT_OK,
    authorization: { ...AUTH_OK, authorizer_1: 'same', authorizer_2: 'same' },
  });
  assert.ok(!result.ok);
  assert.ok(result.errors.some((e) => e.includes('DUAL_AUTH_SAME_IDENTITY')));
});

// ── buildCorrectionLineage ────────────────────────────────────────────────────

test('buildCorrectionLineage — includes all required fields', () => {
  const lineage = buildCorrectionLineage(CORRECTION_INPUT_OK, 'new-record-uuid');
  const parsed = JSON.parse(lineage) as Record<string, unknown>;
  assert.equal(parsed.correction_id, 'new-record-uuid');
  assert.equal(parsed.prior_record_id, 'prior-uuid');
  assert.equal(parsed.pick_id, 'pick-uuid');
  assert.equal(parsed.authorizer_1, 'user-a');
  assert.equal(parsed.authorizer_2, 'user-b');
  assert.ok(typeof parsed.justification === 'string' && parsed.justification.length > 0);
});
