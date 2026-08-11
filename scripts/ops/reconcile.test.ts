import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileManifest, selectReconcilableManifests } from './reconcile.js';
import type { LaneManifest } from './shared.js';

const STALE_MS = 4 * 60 * 60 * 1000;
const STRANDED_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-05-17T12:00:00.000Z');

function classifyAge(ageMs: number): 'clean' | 'stale' | 'stranded' {
  if (ageMs > STRANDED_MS) return 'stranded';
  if (ageMs > STALE_MS) return 'stale';
  return 'clean';
}

function manifestWithHeartbeat(heartbeatAt: string): LaneManifest {
  return {
    schema_version: 1,
    issue_id: 'UTV2-1003',
    lane_type: 'codex-cli',
    executor: 'codex-cli',
    tier: 'T3',
    worktree_path: 'C:/Dev/Unit-Talk-v2-main',
    branch: 'codex/utv2-1003-opsreconcile-dry-run-default',
    base_branch: 'main',
    commit_sha: null,
    pr_url: null,
    files_changed: [],
    file_scope_lock: ['scripts/ops/reconcile.ts'],
    expected_proof_paths: [],
    status: 'in_progress',
    started_at: '2026-05-17T10:00:00.000Z',
    heartbeat_at: heartbeatAt,
    closed_at: null,
    blocked_by: [],
    preflight_token: 'test-token',
    created_by: 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
  };
}

test('ops:reconcile threshold logic classifies fresh heartbeat as clean', () => {
  assert.equal(classifyAge(1 * 60 * 60 * 1000), 'clean');
});

test('ops:reconcile threshold logic classifies 4h+ as stale', () => {
  assert.equal(classifyAge(5 * 60 * 60 * 1000), 'stale');
});

test('ops:reconcile threshold logic classifies 24h+ as stranded', () => {
  assert.equal(classifyAge(25 * 60 * 60 * 1000), 'stranded');
});

test('ops:reconcile threshold boundary just under stale threshold is clean', () => {
  assert.equal(classifyAge(STALE_MS - 1), 'clean');
});

test('ops:reconcile threshold boundary just over stale threshold is stale', () => {
  assert.equal(classifyAge(STALE_MS + 1), 'stale');
});

test('ops:reconcile threshold boundary just over stranded threshold is stranded', () => {
  assert.equal(classifyAge(STRANDED_MS + 1), 'stranded');
});

test('ops:reconcile default dry-run does not write stranded manifest changes', () => {
  let writes = 0;
  const entry = reconcileManifest(manifestWithHeartbeat('2026-05-16T10:00:00.000Z'), {
    apply: false,
    now: NOW,
    branchExists: () => true,
    resolveMergedPr: () => null,
    writeManifest: () => {
      writes += 1;
    },
  });

  assert.equal(entry.verdict, 'stranded');
  assert.equal(entry.action_taken, 'DRY-RUN - WOULD status -> blocked, truth_check_history appended');
  assert.equal(entry.planned_mutation, 'status -> blocked, truth_check_history appended');
  assert.equal(writes, 0);
});

test('ops:reconcile --apply writes stranded manifest changes', () => {
  let written: LaneManifest | null = null;
  const entry = reconcileManifest(manifestWithHeartbeat('2026-05-16T10:00:00.000Z'), {
    apply: true,
    now: NOW,
    branchExists: () => true,
    resolveMergedPr: () => null,
    writeManifest: (manifest) => {
      written = manifest;
    },
  });

  assert.equal(entry.verdict, 'stranded');
  assert.equal(entry.action_taken, 'status -> blocked, truth_check_history appended');
  assert.equal(written?.status, 'blocked');
  assert.equal(written?.truth_check_history.length, 1);
});


// ── UTV2-1613: automatic ghost-lock release ───────────────────────────────────

const MERGE_SHA = '965872d378caa3e88ef4987f8bbb0bab0214856e';
const PR_URL = 'https://github.com/griff843/Unit-Talk-v2/pull/1322';

function ghostManifest(status: LaneManifest['status']): LaneManifest {
  return {
    ...manifestWithHeartbeat('2026-05-17T11:30:00.000Z'),
    issue_id: 'UTV2-1553',
    branch: 'claude/utv2-1553-release-merged-lane-lock',
    status,
    file_scope_lock: ['docs/06_status/lanes/UTV2-1553.json', 'package.json'],
  };
}

test('UTV2-1613: an active manifest whose PR is merged is reconciled to merged and releases its locks', () => {
  let written: LaneManifest | null = null;
  const entry = reconcileManifest(ghostManifest('started'), {
    apply: true,
    now: NOW,
    branchExists: () => true,
    resolveMergedPr: () => ({ url: PR_URL, mergeSha: MERGE_SHA }),
    writeManifest: (manifest) => {
      written = manifest;
    },
  });

  assert.equal(entry.verdict, 'ghost_merged');
  const result = written as LaneManifest | null;
  assert.equal(result?.status, 'merged');
  assert.equal(result?.commit_sha, MERGE_SHA);
  assert.equal(result?.pr_url, PR_URL);
  // `merged` is outside ACTIVE_LOCK_STATUSES and the file-scope guard's
  // LOCK_CONFLICT_STATUSES, which is what actually releases the ghost lock.
  assert.notEqual(result?.status, 'started');
});

test('UTV2-1613: ghost reconciliation stops at merged and never certifies done', () => {
  let written: LaneManifest | null = null;
  reconcileManifest(ghostManifest('in_review'), {
    apply: true,
    now: NOW,
    branchExists: () => true,
    resolveMergedPr: () => ({ url: PR_URL, mergeSha: MERGE_SHA }),
    writeManifest: (manifest) => {
      written = manifest;
    },
  });

  const result = written as LaneManifest | null;
  assert.notEqual(result?.status, 'done', 'done is a governance verdict this reconciler never grants');
  assert.equal(result?.closed_at, null);
});

test('UTV2-1613: ghost reconciliation records a canonical fail entry, never a pass', () => {
  let written: LaneManifest | null = null;
  reconcileManifest(ghostManifest('started'), {
    apply: true,
    now: NOW,
    branchExists: () => true,
    resolveMergedPr: () => ({ url: PR_URL, mergeSha: MERGE_SHA }),
    writeManifest: (manifest) => {
      written = manifest;
    },
  });

  const result = written as LaneManifest | null;
  const history = result?.truth_check_history ?? [];
  assert.equal(history.length, 1);
  assert.equal(history[0]?.verdict, 'fail');
  assert.equal(history[0]?.runner, 'ops:reconcile');
  assert.equal(history[0]?.merge_sha, MERGE_SHA);
  assert.match(history[0]?.failures[0] ?? '', /ghost lane/);
  assert.match(history[0]?.failures[0] ?? '', /NOT closed/);
});

test('UTV2-1613: ghost reconciliation is a dry-run no-op without --apply', () => {
  let writes = 0;
  const entry = reconcileManifest(ghostManifest('started'), {
    apply: false,
    now: NOW,
    branchExists: () => true,
    resolveMergedPr: () => ({ url: PR_URL, mergeSha: MERGE_SHA }),
    writeManifest: () => {
      writes += 1;
    },
  });

  assert.equal(entry.verdict, 'ghost_merged');
  assert.match(entry.action_taken, /^DRY-RUN - WOULD/);
  assert.equal(writes, 0);
});

test('UTV2-1613: ghost detection outranks the orphaned-branch verdict', () => {
  // A merged lane's branch is normally deleted afterwards. Before this change
  // the deleted branch made the lane "orphaned — manual close required", which
  // logged it forever and never released its locks.
  const entry = reconcileManifest(ghostManifest('started'), {
    apply: false,
    now: NOW,
    branchExists: () => false,
    resolveMergedPr: () => ({ url: PR_URL, mergeSha: MERGE_SHA }),
    writeManifest: () => {},
  });
  assert.equal(entry.verdict, 'ghost_merged');
});

test('UTV2-1613: an unresolvable or non-merged PR is never treated as a ghost', () => {
  for (const resolver of [
    () => null,
    () => ({ url: PR_URL, mergeSha: null }),
  ] as const) {
    const entry = reconcileManifest(ghostManifest('started'), {
      apply: false,
      now: NOW,
      branchExists: () => true,
      resolveMergedPr: resolver,
      writeManifest: () => {},
    });
    assert.notEqual(entry.verdict, 'ghost_merged');
  }
});

test('UTV2-1613 adversarial review fix: a reopened lane is never eligible for the ghost rule', () => {
  // A manifest reaches `reopened` only when ops:truth-check detects a genuine
  // regression on a previously-done lane -- it therefore already has a merged
  // pr_url from its first close, and would otherwise deterministically match
  // this ghost rule. Silently rewriting it back to a generic `merged` status
  // on an unattended schedule would erase the "needs urgent re-verification"
  // signal with no human in the loop. `reopened` is in ACTIVE_LOCK_STATUSES
  // (so it still gets ordinary stale/stranded heartbeat handling) but must
  // never be ghost-eligible.
  let resolveCalled = false;
  const entry = reconcileManifest(ghostManifest('reopened'), {
    apply: true,
    now: NOW,
    branchExists: () => true,
    resolveMergedPr: () => {
      resolveCalled = true;
      return { url: PR_URL, mergeSha: MERGE_SHA };
    },
    writeManifest: () => {
      throw new Error('a reopened lane must never be written by the ghost rule');
    },
  });

  assert.strictEqual(resolveCalled, false, 'resolveMergedPr must not even be called for reopened');
  assert.notEqual(entry.verdict, 'ghost_merged');
});


// ── UTV2-1619: reconcile candidate selection ─────────────────────────────────
//
// The scheduled reconciler is an unattended writer to `main`. What it may
// TOUCH matters as much as what it decides once it has: a candidate filter
// that admits terminal lanes turns a maintenance job into a corruption job.
// These lock the selection boundary itself, not the verdicts downstream.

function manifestWithStatus(issueId: string, status: LaneManifest['status']): LaneManifest {
  return { ...manifestWithHeartbeat('2026-05-16T10:00:00.000Z'), issue_id: issueId, status };
}

// `closed` is not a member of LaneManifestStatus -- it is a legacy on-disk
// value on 28 manifests written before the enum existed. The cast is the
// point of the test: reconcile reads real files, and real files carry values
// the type says are impossible.
const LEGACY_CLOSED = 'closed' as LaneManifest['status'];

test('UTV2-1619: a merged lane is never a reconcile candidate', () => {
  const selected = selectReconcilableManifests([manifestWithStatus('UTV2-1001', 'merged')]);
  assert.deepEqual(selected, [], 'merged is terminal — it must stay merged');
});

test('UTV2-1619: a done lane is never a reconcile candidate', () => {
  const selected = selectReconcilableManifests([manifestWithStatus('UTV2-1002', 'done')]);
  assert.deepEqual(selected, [], 'done is terminal — it must stay done');
});

test('UTV2-1619: legacy `closed` manifests are never reconciled into blocked', () => {
  // The regression this lane exists for. Under the old two-value denylist
  // these fell through as "active", were classified stranded on a ~3-month-old
  // heartbeat, and would have been rewritten to `blocked` -- a status that
  // consumes both total and type capacity.
  const closed = [
    manifestWithStatus('UTV2-619', LEGACY_CLOSED),
    manifestWithStatus('UTV2-1017', LEGACY_CLOSED),
    manifestWithStatus('UTV2-1043', LEGACY_CLOSED),
  ];

  assert.deepEqual(selectReconcilableManifests(closed), [], 'legacy closed must never be selected');

  // And prove the consequence, not just the filter: were one to reach
  // reconcileManifest it WOULD be mutated. The filter is the only thing
  // standing between dead history and a capacity-consuming rewrite.
  let written: LaneManifest | null = null;
  const entry = reconcileManifest(closed[0]!, {
    apply: true,
    now: NOW,
    branchExists: () => true,
    resolveMergedPr: () => null,
    writeManifest: (manifest) => {
      written = manifest;
    },
  });
  assert.equal(entry.verdict, 'stranded');
  assert.equal(written?.status, 'blocked');
});

test('UTV2-1619: every terminal status is excluded, not just done and merged', () => {
  const terminal: Array<LaneManifest['status']> = [
    'merged',
    'done',
    'failed',
    'superseded',
    'cancelled',
  ];
  for (const status of terminal) {
    assert.deepEqual(
      selectReconcilableManifests([manifestWithStatus('UTV2-1004', status)]),
      [],
      `${status} is terminal and must never be a reconcile candidate`,
    );
  }
});

test('UTV2-1619: an unrecognised status fails closed rather than being swept', () => {
  const unknown = 'archived_by_some_future_writer' as LaneManifest['status'];
  assert.deepEqual(
    selectReconcilableManifests([manifestWithStatus('UTV2-1005', unknown)]),
    [],
    'an allowlist must exclude what it does not recognise',
  );
});

test('UTV2-1619: genuinely active lanes remain candidates and are left untouched when healthy', () => {
  const active: Array<LaneManifest['status']> = [
    'started',
    'in_progress',
    'in_review',
    'blocked',
    'parked',
    'reopened',
  ];
  for (const status of active) {
    assert.equal(
      selectReconcilableManifests([manifestWithStatus('UTV2-1006', status)]).length,
      1,
      `${status} is active and must remain visible to reconcile`,
    );
  }

  // Selected is not the same as mutated: a healthy active lane with a fresh
  // heartbeat and no merged PR is `clean` and never written.
  const healthy = { ...manifestWithHeartbeat('2026-05-17T11:30:00.000Z'), status: 'in_progress' as const };
  const entry = reconcileManifest(healthy, {
    apply: true,
    now: NOW,
    branchExists: () => true,
    resolveMergedPr: () => null,
    writeManifest: () => {
      throw new Error('a healthy active lane must never be written');
    },
  });
  assert.equal(entry.verdict, 'clean');
  assert.equal(entry.planned_mutation, null);
});

test('UTV2-1619: --issue narrows the candidate set to exactly the named lanes', () => {
  const manifests = [
    manifestWithStatus('UTV2-1627', 'in_review'),
    manifestWithStatus('UTV2-1684', 'started'),
    manifestWithStatus('UTV2-1398', 'started'),
    manifestWithStatus('UTV2-619', LEGACY_CLOSED),
  ];

  const selected = selectReconcilableManifests(manifests, new Set(['UTV2-1627', 'UTV2-1684']));
  assert.deepEqual(
    selected.map((m) => m.issue_id),
    ['UTV2-1627', 'UTV2-1684'],
    'targeted reconciliation must not touch unrelated lanes',
  );
});
