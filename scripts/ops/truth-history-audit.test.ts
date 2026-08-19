import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FABRICATED_REPAIR_RUNNER,
  auditManifests,
  classifyHistoryEntry,
  readManifestsForAudit,
} from './truth-history-audit.js';
import { MANIFEST_DIR, type LaneManifest, type TruthCheckHistoryEntry } from './shared.js';

function entry(overrides: Partial<TruthCheckHistoryEntry> = {}): TruthCheckHistoryEntry {
  return {
    checked_at: '2026-07-01T00:00:00.000Z',
    verdict: 'pass',
    merge_sha: 'abc123',
    failures: [],
    runner: 'ops:lane-close',
    ...overrides,
  };
}

function manifest(issueId: string, history: TruthCheckHistoryEntry[]): LaneManifest {
  return {
    schema_version: 1,
    issue_id: issueId,
    lane_type: 'governance',
    tier: 'T1',
    worktree_path: '.',
    branch: `claude/${issueId.toLowerCase()}-x`,
    base_branch: 'main',
    commit_sha: null,
    pr_url: null,
    files_changed: [],
    file_scope_lock: ['scripts/ops/lane-close.ts'],
    expected_proof_paths: [],
    status: 'done',
    started_at: '2026-07-01T00:00:00.000Z',
    heartbeat_at: '2026-07-01T00:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: 'dispatch-auto',
    created_by: 'claude',
    truth_check_history: history,
    reopen_history: [],
  };
}

test('a genuine canonical entry produces no finding', () => {
  for (const runner of ['ops:lane-close', 'ops:reconcile', 'manual'] as const) {
    assert.strictEqual(classifyHistoryEntry(entry({ runner })), null);
  }
});

test('the fabricated repair runner is classified, and a fabricated pass is called out separately', () => {
  assert.strictEqual(
    classifyHistoryEntry(
      entry({ runner: FABRICATED_REPAIR_RUNNER as TruthCheckHistoryEntry['runner'], verdict: 'pass' }),
    ),
    'fabricated_repair_pass',
  );
  assert.strictEqual(
    classifyHistoryEntry(
      entry({ runner: FABRICATED_REPAIR_RUNNER as TruthCheckHistoryEntry['runner'], verdict: 'fail' }),
    ),
    'fabricated_repair_entry',
  );
});

test('any other non-canonical runner is reported rather than ignored', () => {
  assert.strictEqual(
    classifyHistoryEntry(entry({ runner: 'some-future-tool' as TruthCheckHistoryEntry['runner'] })),
    'non_canonical_runner',
  );
});

test('the audit counts affected manifests and fabricated passes without mutating anything', () => {
  const report = auditManifests([
    manifest('UTV2-1000', [entry()]),
    manifest('UTV2-1001', [
      entry({ runner: FABRICATED_REPAIR_RUNNER as TruthCheckHistoryEntry['runner'] }),
      entry({ runner: FABRICATED_REPAIR_RUNNER as TruthCheckHistoryEntry['runner'] }),
    ]),
    manifest('UTV2-1002', [
      entry({
        runner: FABRICATED_REPAIR_RUNNER as TruthCheckHistoryEntry['runner'],
        verdict: 'fail',
      }),
    ]),
  ]);

  assert.strictEqual(report.scanned_manifests, 3);
  assert.strictEqual(report.affected_manifests, 2);
  assert.strictEqual(report.findings.length, 3);
  assert.strictEqual(report.fabricated_pass_count, 2);
  assert.deepStrictEqual(
    report.findings.map((finding) => finding.entry_index),
    [0, 1, 0],
  );
});

test('a manifest with no history is clean', () => {
  const report = auditManifests([manifest('UTV2-1000', [])]);
  assert.strictEqual(report.findings.length, 0);
  assert.strictEqual(report.affected_manifests, 0);
});

test('malformed manifest files are skipped rather than hiding the rest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1613-audit-'));
  try {
    fs.writeFileSync(path.join(dir, 'UTV2-1000.json'), '{ not json');
    fs.writeFileSync(
      path.join(dir, 'UTV2-1001.json'),
      JSON.stringify(
        manifest('UTV2-1001', [
          entry({ runner: FABRICATED_REPAIR_RUNNER as TruthCheckHistoryEntry['runner'] }),
        ]),
      ),
    );
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');

    const report = auditManifests(readManifestsForAudit(dir));
    assert.strictEqual(report.scanned_manifests, 1);
    assert.strictEqual(report.fabricated_pass_count, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the real repository inventory is non-empty and every finding names a real manifest', () => {
  // This is the live inventory the UTV2-1613 report cites. It is deliberately
  // not asserted to be zero: those entries must be corrected by governed PRs,
  // not silently deleted, so the count stays positive until that work lands.
  const report = auditManifests(readManifestsForAudit(MANIFEST_DIR));
  assert.ok(report.scanned_manifests > 0, 'the repo must have lane manifests to audit');
  for (const finding of report.findings) {
    assert.match(finding.issue_id, /^(UTV2|UNI)-\d+$/);
    assert.ok(finding.entry_index >= 0);
  }
  // Every fabricated pass carries the repair runner by construction -- if this
  // ever fails, some other writer has started fabricating passes too.
  for (const finding of report.findings) {
    if (finding.kind === 'fabricated_repair_pass') {
      assert.strictEqual(finding.runner, FABRICATED_REPAIR_RUNNER);
      assert.strictEqual(finding.verdict, 'pass');
    }
  }
});
