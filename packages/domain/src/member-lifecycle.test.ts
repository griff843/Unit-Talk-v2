import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateTierTransition,
  classifyTransition,
  getValidTransitions,
  hasAccess,
} from './member-lifecycle.js';

// ── evaluateTierTransition ─────────────────────────────────────────

test('free → trial is allowed (trial_start)', () => {
  const result = evaluateTierTransition('free', 'trial');
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'trial_start');
});

test('trial → free is allowed (trial_expired)', () => {
  const result = evaluateTierTransition('trial', 'free');
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'trial_expired');
});

test('trial → vip is allowed (trial_converted)', () => {
  const result = evaluateTierTransition('trial', 'vip');
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'trial_converted');
});

test('vip → vip-plus is allowed (upgrade)', () => {
  const result = evaluateTierTransition('vip', 'vip-plus');
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'upgrade');
});

test('free → capper is NOT allowed (must go through intermediate tiers)', () => {
  const result = evaluateTierTransition('free', 'capper');
  assert.equal(result.allowed, false);
  assert.ok(result.rejection);
});

test('free → vip-plus is NOT allowed', () => {
  const result = evaluateTierTransition('free', 'vip-plus');
  assert.equal(result.allowed, false);
});

test('same tier transition is rejected', () => {
  const result = evaluateTierTransition('vip', 'vip');
  assert.equal(result.allowed, false);
  assert.ok(result.rejection?.includes('Same tier'));
});

test('any tier → operator is allowed (role_granted)', () => {
  for (const from of ['free', 'trial', 'vip', 'vip-plus', 'capper'] as const) {
    const result = evaluateTierTransition(from, 'operator');
    assert.equal(result.allowed, true, `${from} → operator should be allowed`);
    assert.equal(result.reason, 'role_granted');
  }
});

test('operator → free is allowed (role_removed)', () => {
  const result = evaluateTierTransition('operator', 'free');
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'role_removed');
});

// ── classifyTransition ─────────────────────────────────────────────

test('free → vip is an upgrade', () => {
  assert.equal(classifyTransition('free', 'vip'), 'upgrade');
});

test('vip → free is a downgrade', () => {
  assert.equal(classifyTransition('vip', 'free'), 'downgrade');
});

test('vip → vip is lateral', () => {
  assert.equal(classifyTransition('vip', 'vip'), 'lateral');
});

// ── getValidTransitions ────────────────────────────────────────────

test('free has 3 valid transitions', () => {
  const transitions = getValidTransitions('free');
  assert.equal(transitions.length, 3);
  const targets = transitions.map((t) => t.to);
  assert.ok(targets.includes('trial'));
  assert.ok(targets.includes('vip'));
  assert.ok(targets.includes('operator'));
});

// ── hasAccess ──────────────────────────────────────────────────────

test('free can access recaps only', () => {
  assert.equal(hasAccess('free', 'recaps'), true);
  assert.equal(hasAccess('free', 'best-bets'), false);
  assert.equal(hasAccess('free', 'trader-insights'), false);
});

test('trial has full VIP surface set', () => {
  assert.equal(hasAccess('trial', 'recaps'), true);
  assert.equal(hasAccess('trial', 'best-bets'), true);
  assert.equal(hasAccess('trial', 'trader-insights'), true);
  assert.equal(hasAccess('trial', 'exclusive-insights'), false);
});

test('operator has all access', () => {
  assert.equal(hasAccess('operator', 'recaps'), true);
  assert.equal(hasAccess('operator', 'best-bets'), true);
  assert.equal(hasAccess('operator', 'trader-insights'), true);
  assert.equal(hasAccess('operator', 'exclusive-insights'), true);
  assert.equal(hasAccess('operator', 'submission'), true);
  assert.equal(hasAccess('operator', 'operator-tools'), true);
});

test('capper has submission but not operator-tools', () => {
  assert.equal(hasAccess('capper', 'submission'), true);
  assert.equal(hasAccess('capper', 'operator-tools'), false);
});
