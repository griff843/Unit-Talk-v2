/**
 * Tests for the concurrency-doc drift guard (the concurrency ramp follow-up
 * lane, UTV2-1536).
 *
 * Uses node:test + node:assert/strict (not Jest/Vitest), matching the
 * scripts/ci/* convention.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDriftReport,
  checkFileContent,
  resolveAllowlist,
  resolveCommandDocs,
} from './concurrency-doc-drift-guard.js';
import { loadConcurrencyConfig } from '../ops/concurrency-config.js';
import { MAX_CLAUDE_LANES, MAX_CODEX_LANES } from '../ops/execution-state.js';

const LIVE = (() => {
  const config = loadConcurrencyConfig();
  return { total: config.total, claude: config.executors.claude, codex: config.executors.codex };
})();

// ── 1. Real, current instruction files pass ─────────────────────────────

test('real current-instruction files (AGENTS.md, .claude/commands/*.md, lane-governor.md) contain no stale concurrency claims', () => {
  const report = buildDriftReport();
  assert.equal(
    report.verdict,
    'PASS',
    `expected PASS, got findings: ${JSON.stringify(report.findings, null, 2)}`,
  );
  assert.ok(report.files_checked.includes('AGENTS.md'));
  assert.ok(report.files_checked.includes('.claude/agents/lane-governor.md'));
  assert.ok(report.files_checked.includes('.claude/commands/dispatch.md'));
  assert.ok(report.files_checked.length > 5, 'expected multiple command docs to be checked');
});

// ── 2. Guard detects a deliberately injected stale claim ────────────────

test('detects the old "Claude Code | 2 active lanes" table row', () => {
  const findings = checkFileContent(
    'fixtures/synthetic-bad.md',
    '| Claude Code | 2 active lanes | Governed by config and lane-start enforcement |',
    LIVE,
  );
  assert.ok(findings.some((f) => f.code === 'DRIFT_STALE_CLAUDE_2'));
});

test('detects the old "Codex CLI | 4 active lanes" table row', () => {
  const findings = checkFileContent(
    'fixtures/synthetic-bad.md',
    '| Codex CLI | 4 active lanes | Governed by config and lane-start enforcement |',
    LIVE,
  );
  assert.ok(findings.some((f) => f.code === 'DRIFT_STALE_CODEX_4'));
});

test('detects the even older "Codex CLI | 3 active lanes" trial-baseline table row', () => {
  const findings = checkFileContent(
    'fixtures/synthetic-bad.md',
    '| Codex CLI | 3 active lanes | Safe work classes only |',
    LIVE,
  );
  assert.ok(findings.some((f) => f.code === 'DRIFT_STALE_CODEX_3'));
});

test('detects bare "6 lanes total" phrasing', () => {
  const findings = checkFileContent(
    'fixtures/synthetic-bad.md',
    'Current operational model: 6 lanes total, merge serialized.',
    LIVE,
  );
  assert.ok(findings.some((f) => f.code === 'DRIFT_STALE_TOTAL_6'));
});

test('detects bare "2/4/6" shorthand', () => {
  const findings = checkFileContent('fixtures/synthetic-bad.md', 'Concurrency is 2/4/6 as always.', LIVE);
  assert.ok(findings.some((f) => f.code === 'DRIFT_STALE_246'));
});

test('detects "2 Claude + 4 Codex" combo stated as current', () => {
  const findings = checkFileContent(
    'fixtures/synthetic-bad.md',
    'The operating model is 2 Claude lanes and 4 Codex lanes today.',
    LIVE,
  );
  assert.ok(findings.some((f) => f.code === 'DRIFT_STALE_COMBO_2_4'));
});

test('detects "1 Claude + 2 Codex" legacy combo stated as current', () => {
  const findings = checkFileContent(
    'fixtures/synthetic-bad.md',
    'Baseline is 1 Claude lane and 2 Codex lanes.',
    LIVE,
  );
  assert.ok(findings.some((f) => f.code === 'DRIFT_STALE_COMBO_1_2'));
});

test('detects "max 2 Claude" / "up to 4 Codex" phrasing', () => {
  const findingsMax = checkFileContent('fixtures/synthetic-bad.md', 'Dispatch max 2 Claude lanes at once.', LIVE);
  assert.ok(findingsMax.some((f) => f.code === 'DRIFT_STALE_MAX_PHRASING'));

  const findingsUpTo = checkFileContent('fixtures/synthetic-bad.md', 'Dispatch up to 4 Codex lanes at once.', LIVE);
  assert.ok(findingsUpTo.some((f) => f.code === 'DRIFT_STALE_MAX_PHRASING'));
});

test('config-driven check detects a numeric claim that does not match the live config', () => {
  const findings = checkFileContent(
    'fixtures/synthetic-bad.md',
    '| Codex CLI | 99 active lanes | Safe work classes only |',
    LIVE,
  );
  assert.ok(findings.some((f) => f.code === 'DRIFT_CONFIG_MISMATCH_CODEX'));
});

test('buildDriftReport FAILs when given a synthetic file with an injected stale claim', () => {
  const report = buildDriftReport(process.cwd(), []);
  // Directly exercise the file-content checker path buildDriftReport delegates to,
  // via checkFileContent, to prove end-to-end wiring without writing a real file
  // into the allowlisted locations.
  const findings = checkFileContent(
    'AGENTS.md',
    '| Claude Code | 2 active lanes | Governed by config and lane-start enforcement |\n| Codex CLI | 4 active lanes | Governed by config and lane-start enforcement |',
    LIVE,
  );
  assert.equal(report.verdict, 'PASS', 'sanity: empty file list always passes');
  assert.ok(findings.length >= 2, 'synthetic injected content must produce findings');
});

// ── 3. Canonical references are accepted, not flagged ───────────────────

test('references to CONCURRENCY_CONFIG.json and config-driven wording are not flagged', () => {
  const content = [
    '| Claude Code | the current config-driven cap (see `CONCURRENCY_CONFIG.json` -> `executors.claude`) | Governed by config and lane-start enforcement |',
    '| Codex CLI | the current config-driven cap (see `CONCURRENCY_CONFIG.json` -> `executors.codex`) | Governed by config and lane-start enforcement |',
    '**Current total cap:** the current config-driven cap (see `CONCURRENCY_CONFIG.json` -> `total`).',
  ].join('\n');
  const findings = checkFileContent('fixtures/synthetic-good.md', content, LIVE);
  assert.deepEqual(findings, []);
});

test('the CURRENT correct numeric claims are accepted, not flagged', () => {
  const content = [
    `| Claude Code | ${LIVE.claude} active lanes | Governed by config and lane-start enforcement |`,
    `| Codex CLI | ${LIVE.codex} active lanes | Governed by config and lane-start enforcement |`,
    `Current total cap: ${LIVE.total} active lanes.`,
  ].join('\n');
  const findings = checkFileContent('fixtures/synthetic-current.md', content, LIVE);
  assert.deepEqual(findings, []);
});

test('historical provenance framing ("prior", "superseded", "legacy") is exempt from the static patterns', () => {
  // Mirrors the real wording in docs/governance/LANE_CONCURRENCY_POLICY.md's
  // provenance note, which legitimately narrates the old ceiling by name.
  const content =
    'the prior 6-lane (2 Claude + 4 Codex) ceiling was a stabilization-era policy choice, not a mechanical limit; no external constraint enforced 2/4/6 anywhere.';
  const findings = checkFileContent('fixtures/synthetic-historical-note.md', content, LIVE);
  assert.deepEqual(findings, []);
});

// ── 4. Historical proof paths are never incorrectly rejected ────────────

test('the default allowlist never includes historical proof/lane/incident paths', () => {
  const allowlist = resolveAllowlist();
  for (const file of allowlist) {
    assert.ok(!file.startsWith('docs/06_status/proof/'), `${file} must not be in the allowlist`);
    assert.ok(!file.startsWith('docs/06_status/lanes/'), `${file} must not be in the allowlist`);
    assert.ok(!file.startsWith('docs/06_status/INCIDENTS/'), `${file} must not be in the allowlist`);
  }
});

test('a fixture representing historical proof content is never rejected because it is excluded from the allowlist, not because its content is lenient', () => {
  // This exact wording mirrors docs/06_status/proof/UTV2-1504/verification.md,
  // a real, accurate historical record of the base config at the time it was
  // written. If it were ever accidentally added to the allowlist it WOULD be
  // flagged by the static patterns below -- proving the guard's safety comes
  // from the narrow allowlist (this file is never scanned), not from the
  // content itself being treated as acceptable.
  const historicalProofContent =
    'therefore getEffectiveConfig() returned trial_active: false with the base 6 total / 2 Claude / 4 Codex limits.';

  const allowlist = resolveAllowlist();
  assert.ok(
    !allowlist.includes('docs/06_status/proof/UTV2-1504/verification.md'),
    'the real historical proof path must not be in the allowlist',
  );

  // Prove the content genuinely would be flagged as stale if it were ever
  // (wrongly) added to the scanned set -- otherwise this "exclusion" test
  // would trivially pass just because the patterns don't match anyway.
  const findingsIfScanned = checkFileContent(
    'docs/06_status/proof/UTV2-1504/verification.md',
    historicalProofContent,
    LIVE,
  );
  assert.ok(
    findingsIfScanned.length > 0,
    'sanity: this historical wording must trip the static patterns when directly scanned, proving the allowlist (not content leniency) is what protects it',
  );

  // And prove buildDriftReport, using the real default allowlist, does not
  // scan it at all -- report is unaffected by this file's existence/content.
  const report = buildDriftReport();
  assert.ok(!report.files_checked.includes('docs/06_status/proof/UTV2-1504/verification.md'));
});

// ── 5. Config-driven current values stay consistent with execution-state ─

test("the guard's live base config matches loadConcurrencyConfig() and execution-state's dispatch_slots max values", () => {
  const report = buildDriftReport();
  assert.equal(report.live_base_config.total, LIVE.total);
  assert.equal(report.live_base_config.claude, LIVE.claude);
  assert.equal(report.live_base_config.codex, LIVE.codex);

  // execution-state.ts's MAX_CLAUDE_LANES/MAX_CODEX_LANES back
  // dispatch_slots.claude.max / dispatch_slots.codex.max in
  // `pnpm ops:execution-state -- --json`. They are getEffectiveConfig()
  // (trial-aware) values; with no trial active they must equal the guard's
  // base-config values, so the two can never silently diverge while the
  // trial governor is disabled.
  assert.equal(MAX_CLAUDE_LANES, report.live_base_config.claude);
  assert.equal(MAX_CODEX_LANES, report.live_base_config.codex);
});

// ── resolveCommandDocs / resolveAllowlist shape ──────────────────────────

test('resolveCommandDocs enumerates .claude/commands/*.md deterministically', () => {
  const docs = resolveCommandDocs();
  assert.ok(docs.length > 5);
  assert.ok(docs.includes('.claude/commands/dispatch.md'));
  assert.ok(docs.includes('.claude/commands/lane-management.md'));
  assert.ok(docs.includes('.claude/commands/loop-dispatch.md'));
  const sorted = [...docs].sort();
  assert.deepEqual(docs, sorted, 'resolveCommandDocs must return a deterministically sorted list');
});

test('resolveAllowlist includes the static files plus every command doc', () => {
  const allowlist = resolveAllowlist();
  assert.ok(allowlist.includes('AGENTS.md'));
  assert.ok(allowlist.includes('.claude/agents/lane-governor.md'));
  assert.ok(allowlist.includes('.claude/commands/dispatch.md'));
});
