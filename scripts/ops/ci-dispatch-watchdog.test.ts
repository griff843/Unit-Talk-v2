import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyPrs, DEFAULT_THRESHOLD_MINUTES, type OpenPr } from './ci-dispatch-watchdog.js';

const NOW = new Date('2026-07-10T15:00:00.000Z');

function pr(overrides: Partial<OpenPr> = {}): OpenPr {
  return {
    number: 1182,
    headRefName: 'codex/utv2-1495-hard-file-scope-lock-enforcement',
    headRefOid: 'abc123def456',
    updatedAt: '2026-07-10T14:00:00.000Z', // 60 minutes before NOW
    ...overrides,
  };
}

test('flags a PR with zero runs past the threshold as stalled', () => {
  const { stalled, ok } = classifyPrs([pr()], new Map([['abc123def456', 0]]), NOW);
  assert.equal(ok.length, 0);
  assert.equal(stalled.length, 1);
  assert.equal(stalled[0].issueId, 'UTV2-1495');
  assert.equal(Math.round(stalled[0].minutesSinceUpdate), 60);
});

test('does not flag a PR with at least one run', () => {
  const { stalled, ok } = classifyPrs([pr()], new Map([['abc123def456', 3]]), NOW);
  assert.equal(stalled.length, 0);
  assert.equal(ok.length, 1);
});

test('does not flag a PR still within the threshold window even with zero runs', () => {
  const recent = pr({ updatedAt: '2026-07-10T14:58:00.000Z' }); // 2 minutes ago
  const { stalled, ok } = classifyPrs([recent], new Map([['abc123def456', 0]]), NOW);
  assert.equal(stalled.length, 0);
  assert.equal(ok.length, 1);
});

test('flags exactly at the default threshold boundary as not-yet-stalled, one minute past as stalled', () => {
  const atBoundary = pr({ updatedAt: new Date(NOW.getTime() - DEFAULT_THRESHOLD_MINUTES * 60_000).toISOString() });
  const pastBoundary = pr({
    updatedAt: new Date(NOW.getTime() - (DEFAULT_THRESHOLD_MINUTES + 1) * 60_000).toISOString(),
  });

  const atResult = classifyPrs([atBoundary], new Map([['abc123def456', 0]]), NOW);
  assert.equal(atResult.stalled.length, 0, 'exactly at threshold should not yet flag (strictly greater-than)');

  const pastResult = classifyPrs([pastBoundary], new Map([['abc123def456', 0]]), NOW);
  assert.equal(pastResult.stalled.length, 1);
});

test('respects a custom threshold', () => {
  const p = pr({ updatedAt: '2026-07-10T14:50:00.000Z' }); // 10 minutes ago
  const withDefault = classifyPrs([p], new Map([['abc123def456', 0]]), NOW, 15);
  assert.equal(withDefault.stalled.length, 0);

  const withTighter = classifyPrs([p], new Map([['abc123def456', 0]]), NOW, 5);
  assert.equal(withTighter.stalled.length, 1);
});

test('parses UTV2-### from various branch name shapes', () => {
  const shapes = [
    'codex/utv2-1495-hard-file-scope-lock-enforcement',
    'claude/UTV2-1517-ci-dispatch-watchdog',
    'griffadavi/utv2-1516-throttle-concurrent-full-verify-lanes',
  ];
  for (const headRefName of shapes) {
    const { stalled } = classifyPrs([pr({ headRefName })], new Map([['abc123def456', 0]]), NOW);
    assert.ok(stalled[0].issueId?.match(/^UTV2-\d+$/), `expected a UTV2-### match for ${headRefName}`);
  }
});

test('returns null issueId for a branch with no UTV2-### reference', () => {
  const { stalled } = classifyPrs(
    [pr({ headRefName: 'dependabot/npm_and_yarn/some-package-1.0.0' })],
    new Map([['abc123def456', 0]]),
    NOW,
  );
  assert.equal(stalled[0].issueId, null);
});

test('treats an absent run-count entry the same as zero runs', () => {
  const { stalled } = classifyPrs([pr()], new Map(), NOW);
  assert.equal(stalled.length, 1);
});

test('handles multiple PRs independently', () => {
  const stalledPr = pr({ number: 1, headRefOid: 'sha-stalled' });
  const okPr = pr({ number: 2, headRefOid: 'sha-ok' });
  const { stalled, ok } = classifyPrs(
    [stalledPr, okPr],
    new Map([
      ['sha-stalled', 0],
      ['sha-ok', 5],
    ]),
    NOW,
  );
  assert.equal(stalled.length, 1);
  assert.equal(stalled[0].number, 1);
  assert.equal(ok.length, 1);
  assert.equal(ok[0].number, 2);
});
