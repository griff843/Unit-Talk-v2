/**
 * UTV2-1613 — the repair packet must never carry an unmeasured pass.
 *
 * The acceptance tests below are numbered to match the acceptance criteria on
 * the Linear issue, so a failure names the criterion it violates.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CANONICAL_TRUTH_CHECK_RUNNERS,
  NonCanonicalRunnerError,
  REPAIR_PACKET_SCHEMA_VERSION,
  applyRepairPacket,
  assertCanonicalRunner,
  buildRepairPacket,
  hashState,
  isCanonicalRunner,
  isMeasuredPass,
  measuredTruthCheckReceipt,
  readRepairPacket,
  stableStringify,
  truthHistoryEntryForMeasuredReceipt,
  unexecutedTruthCheckReceipt,
  validateRepairPacket,
  writeRepairPacket,
  type LaneCloseRepairPacket,
  type MergeBindingInference,
} from './lane-close-repair-packet.js';
import type { LaneManifest, TruthCheckResult } from './shared.js';

const MERGE_SHA = '965872d378caa3e88ef4987f8bbb0bab0214856e';

function createManifest(overrides: Partial<LaneManifest> = {}): LaneManifest {
  return {
    schema_version: 1,
    issue_id: 'UTV2-1592',
    lane_type: 'governance',
    executor: 'claude',
    tier: 'T1',
    worktree_path: '.',
    branch: 'claude/utv2-1592-merge-execution-fail-closed',
    base_branch: 'main',
    commit_sha: null,
    pr_url: null,
    files_changed: [],
    file_scope_lock: ['scripts/ops/lane-close.ts'],
    expected_proof_paths: ['docs/06_status/proof/UTV2-1592/verification.md'],
    status: 'in_review',
    started_at: '2026-07-20T09:00:00.000Z',
    heartbeat_at: '2026-07-20T09:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: 'dispatch-auto',
    created_by: 'claude',
    truth_check_history: [],
    reopen_history: [],
    ...overrides,
  };
}

function createTruthCheckResult(overrides: Partial<TruthCheckResult> = {}): TruthCheckResult {
  return {
    schema_version: 1,
    issue_id: 'UTV2-1592',
    tier: 'T1',
    verdict: 'pass',
    exit_code: 0,
    merge_sha: MERGE_SHA,
    pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1312',
    checked_at: '2026-07-27T10:00:00.000Z',
    checks: [
      { id: 'M1', status: 'pass', detail: 'manifest present' },
      { id: 'P1', status: 'pass', detail: 'proof present' },
    ],
    failures: [],
    reopen_reasons: [],
    manifest_path: 'docs/06_status/lanes/UTV2-1592.json',
    ...overrides,
  };
}

function createMergeBinding(
  overrides: Partial<MergeBindingInference> = {},
): MergeBindingInference {
  return {
    source: 'github_pull_request',
    repository: 'griff843/Unit-Talk-v2',
    pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1312',
    pr_number: 1312,
    head_ref: 'claude/utv2-1592-merge-execution-fail-closed',
    merge_sha: MERGE_SHA,
    inferred_at: '2026-07-27T09:59:00.000Z',
    selected_by: 'manifest_pr_url',
    ...overrides,
  };
}

function createPacket(
  overrides: Partial<LaneCloseRepairPacket> = {},
): LaneCloseRepairPacket {
  const inputManifest = createManifest();
  const proposedManifest = createManifest({ status: 'merged', commit_sha: MERGE_SHA });
  const packet = buildRepairPacket({
    issueId: 'UTV2-1592',
    command: 'ops:lane-close UTV2-1592 --repair-merged',
    inputManifest,
    proposedManifest,
    changedFields: ['status', 'commit_sha'],
    mergeBinding: createMergeBinding(),
    truthCheck: unexecutedTruthCheckReceipt({
      command: 'ops:lane-close UTV2-1592 --repair-merged',
      mergeSha: MERGE_SHA,
    }),
    now: new Date('2026-07-27T10:00:00.000Z'),
  });
  return { ...packet, ...overrides };
}

function withTempDir(run: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1613-packet-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── Criterion 5: runner union ─────────────────────────────────────────────────

test('AC5: the exact runner the old repair path wrote is rejected by the canonical union', () => {
  // This is the literal string lane-close.ts used to persist. It never was a
  // canonical runner, and the type system did not stop it because the object
  // was built inline without annotation.
  assert.strictEqual(isCanonicalRunner('ops:lane-close --repair-merged'), false);
  assert.throws(
    () => assertCanonicalRunner('ops:lane-close --repair-merged'),
    (error: unknown) =>
      error instanceof NonCanonicalRunnerError &&
      /ops:lane-close --repair-merged/.test(error.message),
  );
});

test('AC5: every canonical runner is accepted, and nothing else is', () => {
  for (const runner of CANONICAL_TRUTH_CHECK_RUNNERS) {
    assert.strictEqual(assertCanonicalRunner(runner), runner);
  }
  for (const bogus of ['', 'ops:reconcile --apply', 'automation', null, undefined, 42, {}]) {
    assert.strictEqual(isCanonicalRunner(bogus), false);
  }
});

// ── Criteria 1 & 3: no execution, no pass ─────────────────────────────────────

test('AC1: an unexecuted receipt records no verdict and yields no history entry', () => {
  const receipt = unexecutedTruthCheckReceipt({
    command: 'ops:lane-close UTV2-1592 --repair-merged',
    mergeSha: MERGE_SHA,
  });

  assert.strictEqual(receipt.executed, false);
  assert.strictEqual(receipt.verdict, null);
  assert.strictEqual(receipt.exit_code, null);
  assert.strictEqual(isMeasuredPass(receipt), false);
  // The critical assertion: no history entry exists to be written at all.
  assert.strictEqual(truthHistoryEntryForMeasuredReceipt(receipt), null);
});

test('AC3: a measured FAILURE records the real failures and never a pass', () => {
  const receipt = measuredTruthCheckReceipt({
    command: 'ops:truth-check UTV2-1592',
    runner: 'ops:lane-close',
    result: createTruthCheckResult({
      verdict: 'fail',
      exit_code: 1,
      failures: ['P3', 'C4'],
      checks: [
        { id: 'P3', status: 'fail', detail: 'proof does not reference merge sha' },
        { id: 'C4', status: 'fail', detail: 'evidence bundle stale' },
      ],
    }),
    evaluatedStateHash: hashState(createManifest()),
  });

  assert.strictEqual(isMeasuredPass(receipt), false);
  const entry = truthHistoryEntryForMeasuredReceipt(receipt);
  assert.ok(entry);
  assert.strictEqual(entry?.verdict, 'fail');
  assert.deepStrictEqual(entry?.failures, ['P3', 'C4']);
  assert.strictEqual(entry?.runner, 'ops:lane-close');
  assert.deepStrictEqual(receipt.check_ids, ['P3', 'C4']);
});

test('AC3: an infra_error truth-check records a failure, never a pass', () => {
  const receipt = measuredTruthCheckReceipt({
    command: 'ops:truth-check UTV2-1592',
    runner: 'ops:lane-close',
    result: createTruthCheckResult({ verdict: 'infra_error', exit_code: 3, failures: ['INFRA'] }),
    evaluatedStateHash: null,
  });
  assert.strictEqual(isMeasuredPass(receipt), false);
  assert.strictEqual(truthHistoryEntryForMeasuredReceipt(receipt)?.verdict, 'fail');
});

test('AC4: a genuine pass is recorded only when the run executed AND exited 0', () => {
  const passing = measuredTruthCheckReceipt({
    command: 'ops:truth-check UTV2-1592',
    runner: 'ops:lane-close',
    result: createTruthCheckResult(),
    evaluatedStateHash: hashState(createManifest({ status: 'merged', commit_sha: MERGE_SHA })),
  });
  assert.strictEqual(isMeasuredPass(passing), true);
  const entry = truthHistoryEntryForMeasuredReceipt(passing);
  assert.strictEqual(entry?.verdict, 'pass');
  assert.strictEqual(entry?.merge_sha, MERGE_SHA);
  assert.deepStrictEqual(entry?.failures, []);

  // A verdict of 'pass' with a non-zero exit code is incoherent; treat it as
  // not-a-pass rather than trusting the verdict field alone.
  const contradictory = { ...passing, exit_code: 1 };
  assert.strictEqual(isMeasuredPass(contradictory), false);
  assert.strictEqual(truthHistoryEntryForMeasuredReceipt(contradictory)?.verdict, 'fail');
});

// ── Criterion 6: packet hashes prevent stale application ──────────────────────

test('stableStringify is key-order independent so re-serialisation is not tampering', () => {
  assert.strictEqual(stableStringify({ a: 1, b: [2, { d: 4, c: 3 }] }), stableStringify({ b: [2, { c: 3, d: 4 }], a: 1 }));
  assert.strictEqual(hashState({ a: 1, b: 2 }), hashState({ b: 2, a: 1 }));
  assert.notStrictEqual(hashState({ a: 1 }), hashState({ a: 2 }));
});

test('AC6: a packet records the command, timestamp, both hashes, and the selected authority', () => {
  const packet = createPacket();
  assert.strictEqual(packet.schema_version, REPAIR_PACKET_SCHEMA_VERSION);
  assert.strictEqual(packet.command, 'ops:lane-close UTV2-1592 --repair-merged');
  assert.strictEqual(packet.generated_at, '2026-07-27T10:00:00.000Z');
  assert.match(packet.input_manifest_hash, /^sha256:[0-9a-f]{64}$/);
  assert.match(packet.candidate_manifest_hash, /^sha256:[0-9a-f]{64}$/);
  assert.notStrictEqual(packet.input_manifest_hash, packet.candidate_manifest_hash);
  assert.strictEqual(packet.merge_binding?.pr_number, 1312);
  assert.strictEqual(packet.merge_binding?.merge_sha, MERGE_SHA);
  assert.strictEqual(packet.merge_binding?.head_ref, 'claude/utv2-1592-merge-execution-fail-closed');
  assert.deepStrictEqual(validateRepairPacket(packet), []);
});

test('AC6: applying against a manifest that moved since generation fails closed', () => {
  const packet = createPacket();
  const written: LaneManifest[] = [];
  const result = applyRepairPacket(packet, {
    readCurrentManifest: () => createManifest({ heartbeat_at: '2026-07-28T00:00:00.000Z' }),
    write: (manifest) => written.push(manifest),
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'repair_packet_input_drift');
  assert.strictEqual(written.length, 0, 'a refused apply must write nothing');
});

test('AC6: a packet whose proposed_manifest was edited after generation fails closed', () => {
  const packet = createPacket();
  const tampered: LaneCloseRepairPacket = {
    ...packet,
    proposed_manifest: { ...packet.proposed_manifest, status: 'done' },
  };
  const written: LaneManifest[] = [];
  const result = applyRepairPacket(tampered, {
    readCurrentManifest: () => createManifest(),
    write: (manifest) => written.push(manifest),
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'repair_packet_candidate_tampered');
  assert.strictEqual(written.length, 0);
});

test('AC6: a packet whose GitHub merge authority moved fails closed', () => {
  const packet = createPacket();
  const written: LaneManifest[] = [];
  const result = applyRepairPacket(packet, {
    readCurrentManifest: () => createManifest(),
    fetchMergeAuthority: () => ({
      pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1312',
      merge_sha: 'ffffffffffffffffffffffffffffffffffffffff',
      head_ref: 'claude/utv2-1592-merge-execution-fail-closed',
    }),
    write: (manifest) => written.push(manifest),
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'repair_packet_authority_changed');
  assert.strictEqual(written.length, 0);
});

test('AC6: an unresolvable PR is treated as changed authority, not as agreement', () => {
  const result = applyRepairPacket(createPacket(), {
    readCurrentManifest: () => createManifest(),
    fetchMergeAuthority: () => null,
    write: () => {},
  });
  assert.strictEqual(result.code, 'repair_packet_authority_changed');
});

test('AC6: a packet applies when every hash and the live authority still agree', () => {
  const packet = createPacket();
  const written: LaneManifest[] = [];
  const result = applyRepairPacket(packet, {
    readCurrentManifest: () => createManifest(),
    fetchMergeAuthority: () => ({
      pr_url: packet.merge_binding?.pr_url ?? '',
      merge_sha: MERGE_SHA,
      head_ref: 'claude/utv2-1592-merge-execution-fail-closed',
    }),
    write: (manifest) => written.push(manifest),
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, 'repair_packet_applied');
  assert.strictEqual(written.length, 1);
  assert.strictEqual(written[0]?.status, 'merged');
  assert.strictEqual(written[0]?.commit_sha, MERGE_SHA);
  // The applied manifest carries no truth-check history: applying a binding is
  // not a governance outcome.
  assert.deepStrictEqual(written[0]?.truth_check_history, []);
});

test('a packet for a different issue is refused', () => {
  const result = applyRepairPacket(createPacket(), {
    issueId: 'UTV2-1585',
    readCurrentManifest: () => createManifest(),
    write: () => {},
  });
  assert.strictEqual(result.code, 'repair_packet_issue_mismatch');
});

// ── Criteria 2, 7 & 8: the UTV2-1592 regression fixture ───────────────────────

test('AC2/AC7: UTV2-1592 regression fixture — an invalid proof bundle cannot receive a pass', () => {
  // Reconstructs PR #1312 / UTV2-1592: the manifest was repaired from
  // authoritative GitHub merge state while the proof bundle was still invalid.
  // The old code path wrote { verdict: 'pass', failures: [] } at exactly this
  // point. The measured receipt for the same situation is a failure, and the
  // only history entry derivable from it is a failure.
  const invalidProofResult = createTruthCheckResult({
    verdict: 'fail',
    exit_code: 1,
    failures: ['P3', 'C4', 'C6'],
    checks: [
      { id: 'P3', status: 'fail', detail: 'proof files do not reference the merge SHA' },
      { id: 'C4', status: 'fail', detail: 'evidence bundle predates merge commit' },
      { id: 'C6', status: 'fail', detail: 'runtime proof required for T1' },
    ],
  });
  const receipt = measuredTruthCheckReceipt({
    command: 'ops:truth-check UTV2-1592',
    runner: 'ops:lane-close',
    result: invalidProofResult,
    evaluatedStateHash: hashState(createManifest({ status: 'merged', commit_sha: MERGE_SHA })),
  });

  const packet = buildRepairPacket({
    issueId: 'UTV2-1592',
    command: 'ops:lane-close UTV2-1592 --repair-merged',
    inputManifest: createManifest(),
    proposedManifest: createManifest({ status: 'merged', commit_sha: MERGE_SHA }),
    changedFields: ['status', 'commit_sha'],
    mergeBinding: createMergeBinding(),
    truthCheck: receipt,
  });

  // The merge binding is present and correct -- GitHub really did merge it.
  assert.strictEqual(packet.merge_binding?.merge_sha, MERGE_SHA);
  // And yet nothing anywhere in this packet claims a pass.
  assert.strictEqual(isMeasuredPass(packet.truth_check), false);
  assert.strictEqual(truthHistoryEntryForMeasuredReceipt(packet.truth_check)?.verdict, 'fail');
  assert.deepStrictEqual(validateRepairPacket(packet), []);

  const stringified = JSON.stringify(packet);
  assert.strictEqual(
    /"verdict":\s*"pass"/.test(stringified),
    false,
    'no part of a blocked repair packet may serialise a passing verdict',
  );
  assert.strictEqual(
    /ops:lane-close --repair-merged/.test(JSON.stringify(packet.truth_check)),
    false,
    'the receipt runner must be canonical, not the repair command line',
  );
});

test('AC8: a historical-certification packet cannot inherit a pass from a prior run', () => {
  // UTV2-1585 / UTV2-1590 flow: the repair machinery is reused to certify an
  // already-merged historical lane. A packet built for that flow with no
  // truth-check execution must be applicable (it fixes the binding) while
  // still contributing no pass.
  const inputManifest = createManifest({ issue_id: 'UTV2-1590', status: 'in_review' });
  const proposedManifest = createManifest({
    issue_id: 'UTV2-1590',
    status: 'merged',
    commit_sha: MERGE_SHA,
  });
  const packet = buildRepairPacket({
    issueId: 'UTV2-1590',
    command: 'ops:lane-close UTV2-1590 --repair-merged',
    inputManifest,
    proposedManifest,
    changedFields: ['status', 'commit_sha'],
    mergeBinding: createMergeBinding({ selected_by: 'branch_merged_head' }),
    truthCheck: unexecutedTruthCheckReceipt({
      command: 'ops:lane-close UTV2-1590 --repair-merged',
      mergeSha: MERGE_SHA,
    }),
  });

  const written: LaneManifest[] = [];
  const result = applyRepairPacket(packet, {
    readCurrentManifest: () => inputManifest,
    write: (manifest) => written.push(manifest),
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(written[0]?.status, 'merged', 'the binding is repaired');
  assert.notStrictEqual(written[0]?.status, 'done', 'but the lane is NOT certified done');
  assert.deepStrictEqual(written[0]?.truth_check_history, []);
});

test('a packet that hand-claims a pass without executing is refused at apply time', () => {
  // Defense in depth: even a packet forged by hand, with a passing verdict and
  // executed:false, cannot be applied.
  const forged: LaneCloseRepairPacket = {
    ...createPacket(),
    truth_check: {
      ...unexecutedTruthCheckReceipt({ command: 'forged' }),
      verdict: 'pass',
    },
  };
  const result = applyRepairPacket(forged, {
    readCurrentManifest: () => createManifest(),
    write: () => {},
  });
  // Schema validation catches it first (executed:false with a verdict is
  // incoherent), which is itself the refusal.
  assert.strictEqual(result.ok, false);
  assert.ok(
    result.code === 'repair_packet_schema_invalid' || result.code === 'repair_packet_unmeasured_pass',
    `expected a refusal code, got ${result.code}`,
  );
});

test('a packet with a non-canonical runner fails schema validation', () => {
  const packet = createPacket();
  const errors = validateRepairPacket({
    ...packet,
    truth_check: { ...packet.truth_check, runner: 'ops:lane-close --repair-merged' },
  });
  assert.ok(errors.some((error) => error.includes('truth_check.runner')));
});

test('packets round-trip through disk unchanged', () => {
  withTempDir((dir) => {
    const packet = createPacket();
    const packetPath = writeRepairPacket(packet, { artifactRoot: dir });
    assert.ok(fs.existsSync(packetPath));
    assert.match(packetPath, /UTV2-1592\.repair-packet\.json$/);
    const round = readRepairPacket(packetPath);
    assert.deepStrictEqual(round, packet);
    assert.deepStrictEqual(validateRepairPacket(round), []);
  });
});
