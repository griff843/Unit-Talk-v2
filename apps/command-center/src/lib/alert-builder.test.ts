import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyAlertDefinition,
  parseSavedAlertDefinitions,
  validateAlertDefinition,
  type AlertDefinition,
} from './alert-builder';

function validDef(): AlertDefinition {
  return {
    ...createEmptyAlertDefinition(),
    sport: 'baseball',
    league: 'MLB',
    market: 'pitching_strikeouts-all-game-ou',
    book: 'draftkings',
    evThreshold: 3,
    startWindow: 24,
  };
}

test('empty definition has locked governance flags and fails validation', () => {
  const def = createEmptyAlertDefinition();
  assert.equal(def.destination, 'internal');
  assert.equal(def.internalOnly, true);
  assert.equal(def.requiresApprovalBeforeDispatch, true);
  const res = validateAlertDefinition(def);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes('sport')));
  assert.ok(res.errors.some((e) => e.includes('market')));
  assert.ok(res.errors.some((e) => e.includes('trigger')));
});

test('valid definition passes', () => {
  const res = validateAlertDefinition(validDef());
  assert.deepEqual(res, { valid: true, errors: [] });
});

test('requires at least one trigger', () => {
  const def = { ...validDef(), oddsThreshold: null, evThreshold: null, lineMoveThreshold: null };
  const res = validateAlertDefinition(def);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes('trigger')));
});

test('oddsThreshold must be valid American odds', () => {
  assert.equal(validateAlertDefinition({ ...validDef(), oddsThreshold: 0 }).valid, false);
  assert.equal(validateAlertDefinition({ ...validDef(), oddsThreshold: 50 }).valid, false);
  assert.equal(validateAlertDefinition({ ...validDef(), oddsThreshold: -110 }).valid, true);
  assert.equal(validateAlertDefinition({ ...validDef(), oddsThreshold: 150 }).valid, true);
});

test('evThreshold bounds 0..100', () => {
  assert.equal(validateAlertDefinition({ ...validDef(), evThreshold: -1 }).valid, false);
  assert.equal(validateAlertDefinition({ ...validDef(), evThreshold: 101 }).valid, false);
  assert.equal(validateAlertDefinition({ ...validDef(), evThreshold: 0 }).valid, true);
});

test('lineMoveThreshold must be positive', () => {
  assert.equal(
    validateAlertDefinition({ ...validDef(), evThreshold: null, lineMoveThreshold: 0 }).valid,
    false,
  );
  assert.equal(
    validateAlertDefinition({ ...validDef(), evThreshold: null, lineMoveThreshold: 1.5 }).valid,
    true,
  );
});

test('startWindow must be integer 1..168', () => {
  assert.equal(validateAlertDefinition({ ...validDef(), startWindow: 0 }).valid, false);
  assert.equal(validateAlertDefinition({ ...validDef(), startWindow: 169 }).valid, false);
  assert.equal(validateAlertDefinition({ ...validDef(), startWindow: 2.5 }).valid, false);
  assert.equal(validateAlertDefinition({ ...validDef(), startWindow: 168 }).valid, true);
  assert.equal(validateAlertDefinition({ ...validDef(), startWindow: null }).valid, true);
});

test('tampered governance flags fail closed', () => {
  const tampered = { ...validDef(), internalOnly: false } as unknown as AlertDefinition;
  const res = validateAlertDefinition(tampered);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes('internalOnly')));

  const tampered2 = {
    ...validDef(),
    requiresApprovalBeforeDispatch: false,
  } as unknown as AlertDefinition;
  assert.equal(validateAlertDefinition(tampered2).valid, false);

  const tampered3 = { ...validDef(), destination: 'discord' } as unknown as AlertDefinition;
  assert.equal(validateAlertDefinition(tampered3).valid, false);
});

test('parses valid locally saved definitions and discards malformed or tampered entries', () => {
  const valid = { id: 'saved-1', savedAt: '2026-07-14T12:00:00.000Z', definition: validDef() };
  const tampered = {
    id: 'saved-2',
    savedAt: '2026-07-14T12:00:00.000Z',
    definition: { ...validDef(), destination: 'discord' },
  };

  const result = parseSavedAlertDefinitions(JSON.stringify([valid, tampered, { nope: true }]));
  assert.deepEqual(result, [valid]);
});

test('returns no saved definitions for unavailable or invalid browser storage', () => {
  assert.deepEqual(parseSavedAlertDefinitions(null), []);
  assert.deepEqual(parseSavedAlertDefinitions('{invalid'), []);
  assert.deepEqual(parseSavedAlertDefinitions(JSON.stringify({ definitions: [] })), []);
});
