import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseShadowModeEnv,
  isShadowEnabled,
  buildShadowRunResult,
} from './shadow-mode.js';

// --- parseShadowModeEnv ---

test('parseShadowModeEnv returns empty set for undefined', () => {
  const config = parseShadowModeEnv(undefined);
  assert.equal(config.enabledSubsystems.size, 0);
});

test('parseShadowModeEnv returns empty set for empty string', () => {
  const config = parseShadowModeEnv('');
  assert.equal(config.enabledSubsystems.size, 0);
});

test('parseShadowModeEnv returns empty set for whitespace-only', () => {
  const config = parseShadowModeEnv('   ');
  assert.equal(config.enabledSubsystems.size, 0);
});

test('parseShadowModeEnv parses a single valid subsystem', () => {
  const config = parseShadowModeEnv('grading');
  assert.equal(config.enabledSubsystems.size, 1);
  assert.ok(config.enabledSubsystems.has('grading'));
});

test('parseShadowModeEnv parses multiple valid subsystems', () => {
  const config = parseShadowModeEnv('grading,scoring,routing');
  assert.equal(config.enabledSubsystems.size, 3);
  assert.ok(config.enabledSubsystems.has('grading'));
  assert.ok(config.enabledSubsystems.has('scoring'));
  assert.ok(config.enabledSubsystems.has('routing'));
});

test('parseShadowModeEnv ignores unknown subsystem names', () => {
  const config = parseShadowModeEnv('grading,unknown,scoring');
  assert.equal(config.enabledSubsystems.size, 2);
  assert.ok(config.enabledSubsystems.has('grading'));
  assert.ok(config.enabledSubsystems.has('scoring'));
  assert.ok(!config.enabledSubsystems.has('unknown' as never));
});

test('parseShadowModeEnv trims whitespace around tokens', () => {
  const config = parseShadowModeEnv(' grading , scoring ');
  assert.equal(config.enabledSubsystems.size, 2);
  assert.ok(config.enabledSubsystems.has('grading'));
  assert.ok(config.enabledSubsystems.has('scoring'));
});

test('parseShadowModeEnv normalises to lowercase', () => {
  const config = parseShadowModeEnv('Grading,SCORING');
  assert.equal(config.enabledSubsystems.size, 2);
  assert.ok(config.enabledSubsystems.has('grading'));
  assert.ok(config.enabledSubsystems.has('scoring'));
});

test('parseShadowModeEnv deduplicates repeated subsystems', () => {
  const config = parseShadowModeEnv('grading,grading,grading');
  assert.equal(config.enabledSubsystems.size, 1);
  assert.ok(config.enabledSubsystems.has('grading'));
});

// --- isShadowEnabled ---

test('isShadowEnabled returns true for an enabled subsystem', () => {
  const config = parseShadowModeEnv('grading,scoring');
  assert.equal(isShadowEnabled(config, 'grading'), true);
  assert.equal(isShadowEnabled(config, 'scoring'), true);
});

test('isShadowEnabled returns false for a disabled subsystem', () => {
  const config = parseShadowModeEnv('grading');
  assert.equal(isShadowEnabled(config, 'scoring'), false);
  assert.equal(isShadowEnabled(config, 'routing'), false);
});

test('isShadowEnabled returns false when no subsystems are enabled', () => {
  const config = parseShadowModeEnv(undefined);
  assert.equal(isShadowEnabled(config, 'grading'), false);
  assert.equal(isShadowEnabled(config, 'scoring'), false);
  assert.equal(isShadowEnabled(config, 'routing'), false);
});

// --- buildShadowRunResult ---

test('buildShadowRunResult produces a well-formed result', () => {
  const result = buildShadowRunResult({
    subsystem: 'grading',
    input: { pickId: 'pick-1', grade: 'A' },
    output: { score: 95 },
    durationMs: 12,
  });

  assert.equal(result.subsystem, 'grading');
  assert.deepEqual(result.input, { pickId: 'pick-1', grade: 'A' });
  assert.deepEqual(result.output, { score: 95 });
  assert.equal(result.durationMs, 12);
  assert.equal(result.notes, undefined);
  // executedAt should be a valid ISO-8601 string
  assert.ok(!Number.isNaN(Date.parse(result.executedAt)));
});

test('buildShadowRunResult includes notes when provided', () => {
  const result = buildShadowRunResult({
    subsystem: 'routing',
    input: { target: 'best-bets' },
    output: { routed: false },
    durationMs: 3,
    notes: ['target suppressed in shadow mode'],
  });

  assert.deepEqual(result.notes, ['target suppressed in shadow mode']);
});
