import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateBackupFinding, parseBackupThresholdHours } from './backup-alert-check.js';

test('parseBackupThresholdHours rejects zero, negative, and non-numeric values', () => {
  assert.equal(parseBackupThresholdHours('0', 25), 25);
  assert.equal(parseBackupThresholdHours('-5', 25), 25);
  assert.equal(parseBackupThresholdHours('abc', 25), 25);
  assert.equal(parseBackupThresholdHours(undefined, 25), 25);
});

test('parseBackupThresholdHours accepts valid positive numbers including decimals', () => {
  assert.equal(parseBackupThresholdHours('30', 25), 30);
  assert.equal(parseBackupThresholdHours('1.5', 25), 1.5);
  assert.equal(parseBackupThresholdHours('0.5', 25), 0.5);
});

test('evaluateBackupFinding returns OK for a backup within threshold', () => {
  const now = new Date('2026-04-30T12:00:00.000Z');
  const finding = evaluateBackupFinding('2026-04-30T10:00:00.000Z', 25, now);
  assert.equal(finding.level, 'OK');
  assert.equal(finding.ageHours, 2);
  assert.match(finding.message, /threshold: 25h/);
});

test('evaluateBackupFinding returns CRITICAL when backup exceeds threshold', () => {
  const now = new Date('2026-04-30T12:00:00.000Z');
  // 26 hours ago, threshold 25h
  const finding = evaluateBackupFinding('2026-04-29T10:00:00.000Z', 25, now);
  assert.equal(finding.level, 'CRITICAL');
  assert.equal(finding.ageHours, 26);
  assert.match(finding.message, /26h old/);
  assert.match(finding.message, /threshold: 25h/);
});

test('evaluateBackupFinding returns CRITICAL when no backup record exists', () => {
  const finding = evaluateBackupFinding(null, 25);
  assert.equal(finding.level, 'CRITICAL');
  assert.equal(finding.ageHours, null);
  assert.match(finding.message, /never run/);
});

test('evaluateBackupFinding treats age exactly equal to threshold as OK', () => {
  const now = new Date('2026-04-30T12:00:00.000Z');
  // exactly 25 hours ago — not over threshold, should be OK
  const finding = evaluateBackupFinding('2026-04-29T11:00:00.000Z', 25, now);
  assert.equal(finding.level, 'OK');
  assert.equal(finding.ageHours, 25);
});

test('evaluateBackupFinding rounds age to one decimal place', () => {
  const now = new Date('2026-04-30T12:00:00.000Z');
  // 2h 15m = 2.25h → rounds to 2.3
  const finding = evaluateBackupFinding('2026-04-30T09:45:00.000Z', 25, now);
  assert.equal(finding.level, 'OK');
  assert.equal(finding.ageHours, 2.3);
});
