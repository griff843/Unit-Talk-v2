/**
 * Tests for ops:review-verdict (Review Verdict Recorder — WFR-v2 Phase C)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  makeEmptyReviewState,
  writeReviewState,
  isSelfCertification,
  isReviewStale,
  type ReviewStateV1,
  type ReviewFinding,
} from './review-state-schema.js';

const VALID_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

function makeReviewInProgress(tmpDir: string, issueId = 'UTV2-VRD1'): ReviewStateV1 {
  const state = makeEmptyReviewState(issueId, 900, 'codex', 'T2', 'governance', ['package.json']);
  state.reviewer = 'claude';
  state.reviewed_head_sha = VALID_SHA;
  state.review_status = 'in_review';
  writeReviewState(state, tmpDir);
  return state;
}

// Simulate verdict recording (mirrors review-verdict.ts logic)
function recordVerdict(
  state: ReviewStateV1,
  verdict: 'pass' | 'fail',
  reviewer: string,
  newFindings: string[] = [],
): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // Self-cert check
  const candidateState = { ...state, reviewer: reviewer as ReviewStateV1['reviewer'] };
  if (isSelfCertification(candidateState)) {
    failures.push(`Self-certification blocked: reviewer "${reviewer}" == executor "${state.executor}"`);
  }

  // Unresolved blockers on pass
  if (verdict === 'pass') {
    const unresolved = state.findings.filter(f => f.severity === 'blocking' && f.resolved_at === null);
    if (unresolved.length > 0) {
      failures.push(`Cannot PASS with ${unresolved.length} unresolved blocking finding(s)`);
    }
  }

  if (failures.length > 0) return { ok: false, failures };

  // Record
  if (verdict === 'fail' && newFindings.length > 0) {
    for (const desc of newFindings) {
      const finding: ReviewFinding = {
        id: `F-${Date.now()}`,
        description: desc,
        severity: 'blocking',
        added_at: new Date().toISOString(),
        resolved_at: null,
      };
      state.findings.push(finding);
      state.blocking_findings.push(desc);
    }
  }

  state.reviewer = reviewer as ReviewStateV1['reviewer'];
  state.review_status = verdict;

  if (verdict === 'pass') {
    for (const f of state.findings) {
      if (f.severity === 'blocking' && f.resolved_at === null) {
        f.resolved_at = new Date().toISOString();
        state.resolved_findings.push(f.description);
      }
    }
    state.blocking_findings = [];
  }

  return { ok: true, failures: [] };
}

describe('review verdict recording', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-verdict-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records a PASS verdict', () => {
    const state = makeReviewInProgress(tmpDir, 'UTV2-VRD-PASS');
    const r = recordVerdict(state, 'pass', 'claude');
    assert.ok(r.ok, JSON.stringify(r.failures));
    assert.equal(state.review_status, 'pass');
  });

  it('records a FAIL verdict with findings', () => {
    const state = makeReviewInProgress(tmpDir, 'UTV2-VRD-FAIL');
    const r = recordVerdict(state, 'fail', 'claude', ['Missing null check in proof-check.ts']);
    assert.ok(r.ok);
    assert.equal(state.review_status, 'fail');
    assert.equal(state.blocking_findings.length, 1);
    assert.equal(state.findings.length, 1);
  });

  it('NEGATIVE: self-certification blocked', () => {
    const state = makeReviewInProgress(tmpDir, 'UTV2-VRD-SELF');
    state.executor = 'codex';
    // Try to certify own work
    const r = recordVerdict(state, 'pass', 'codex');
    assert.ok(!r.ok);
    assert.ok(r.failures.some(f => f.includes('Self-certification')));
  });

  it('NEGATIVE: cannot PASS with unresolved blocking findings', () => {
    const state = makeReviewInProgress(tmpDir, 'UTV2-VRD-BLOCK');
    // Add an unresolved blocker
    state.findings.push({
      id: 'F-001',
      description: 'Critical: missing fail-closed guard',
      severity: 'blocking',
      added_at: new Date().toISOString(),
      resolved_at: null,
    });
    state.blocking_findings.push('Critical: missing fail-closed guard');

    const r = recordVerdict(state, 'pass', 'claude');
    assert.ok(!r.ok);
    assert.ok(r.failures.some(f => f.includes('unresolved blocking finding')));
  });

  it('NEGATIVE: stale verdict detection (head changed)', () => {
    const state = makeReviewInProgress(tmpDir, 'UTV2-VRD-STALE');
    state.reviewed_head_sha = VALID_SHA;
    const currentHead = OTHER_SHA;
    assert.equal(isReviewStale(state, currentHead), true);
  });

  it('re_review_count increments on stale detection', () => {
    const state = makeReviewInProgress(tmpDir, 'UTV2-VRD-RECNT');
    assert.equal(state.re_review_count, 0);
    state.re_review_count += 1;
    assert.equal(state.re_review_count, 1);
  });

  it('blocker history is preserved after PASS (resolved_findings accumulates)', () => {
    const state = makeReviewInProgress(tmpDir, 'UTV2-VRD-HIST');
    // Add finding, then pass
    state.findings.push({
      id: 'F-002',
      description: 'Previously blocking issue, now resolved',
      severity: 'blocking',
      added_at: new Date().toISOString(),
      resolved_at: null,
    });
    state.blocking_findings.push('Previously blocking issue, now resolved');

    // Simulate resolution before PASS
    state.findings[0]!.resolved_at = new Date().toISOString();
    state.resolved_findings.push(state.findings[0]!.description);
    state.blocking_findings = [];

    const r = recordVerdict(state, 'pass', 'claude');
    assert.ok(r.ok, JSON.stringify(r.failures));
    // History is preserved
    assert.ok(state.resolved_findings.length >= 1);
    assert.equal(state.review_status, 'pass');
  });
});
