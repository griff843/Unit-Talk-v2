/**
 * Tests for ops:pm-verdict (PM Verdict Validator — WFR-v2 Phase D)
 *
 * Exercises all fail-closed conditions without hitting gh CLI or filesystem.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  makeEmptyReviewState,
  type ReviewStateV1,
  type ReviewFinding,
} from './review-state-schema.js';

const AUTHORIZED_ACTORS = new Set(['griff843', 'pm', 'griffadavi']);
const VALID_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

// ---------------------------------------------------------------------------
// Inline PM verdict readiness logic for unit testing
// ---------------------------------------------------------------------------

interface ReadinessInput {
  reviewState: ReviewStateV1 | null;
  currentHead: string | null;
  hasProof: boolean;
  manifestTier: string | null;
  ciGreen: boolean | null;
  actor: string | null;
  approve: boolean;
}

interface ReadinessResult {
  failures: string[];
  warnings: string[];
  ready: boolean;
}

function checkReadiness(input: ReadinessInput): ReadinessResult {
  const failures: string[] = [];
  const warnings: string[] = [];

  // Actor authorization
  if (input.approve && input.actor && !AUTHORIZED_ACTORS.has(input.actor)) {
    failures.push(`PM actor "${input.actor}" is not authorized`);
  }

  // CI
  if (input.ciGreen === false) {
    failures.push('CI is not green');
  } else if (input.ciGreen === null) {
    warnings.push('CI status unknown');
  }

  // Review state
  if (!input.reviewState) {
    failures.push('Review state missing — run ops:review and ops:review-verdict first');
  } else {
    const r = input.reviewState;

    // Self-cert
    if (r.reviewer !== null && r.reviewer === r.executor) {
      failures.push(`Self-certification: reviewer "${r.reviewer}" == executor "${r.executor}"`);
    }

    // Review status
    if (r.review_status !== 'pass') {
      failures.push(`Review status is "${r.review_status}" (must be pass)`);
    }

    // Stale review
    if (input.currentHead && r.reviewed_head_sha && r.reviewed_head_sha !== input.currentHead) {
      failures.push(`Review stale: reviewed=${r.reviewed_head_sha}, current=${input.currentHead}`);
    }

    // Unresolved blockers
    const unresolved = r.findings.filter(f => f.severity === 'blocking' && f.resolved_at === null);
    if (unresolved.length > 0) {
      failures.push(`${unresolved.length} unresolved blocking finding(s)`);
    }

    // Tier consistency
    if (input.manifestTier && r.tier !== input.manifestTier) {
      failures.push(`Review tier (${r.tier}) != manifest tier (${input.manifestTier})`);
    }
  }

  // Proof
  if (!input.hasProof) {
    failures.push('Proof file missing');
  }

  return { failures, warnings, ready: failures.length === 0 };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pm-verdict readiness gates', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-verdict-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makePassedReview(): ReviewStateV1 {
    const state = makeEmptyReviewState('UTV2-PMV', 900, 'codex', 'T2', 'governance', []);
    state.reviewer = 'claude';
    state.reviewed_head_sha = VALID_SHA;
    state.review_status = 'pass';
    return state;
  }

  it('PASS: all gates satisfied → ready', () => {
    const r = checkReadiness({
      reviewState: makePassedReview(),
      currentHead: VALID_SHA,
      hasProof: true,
      manifestTier: 'T2',
      ciGreen: true,
      actor: 'griff843',
      approve: true,
    });
    assert.ok(r.ready, JSON.stringify(r.failures));
  });

  it('NEGATIVE: CI not green → NOT_READY', () => {
    const r = checkReadiness({
      reviewState: makePassedReview(),
      currentHead: VALID_SHA,
      hasProof: true,
      manifestTier: 'T2',
      ciGreen: false,
      actor: 'griff843',
      approve: true,
    });
    assert.ok(!r.ready);
    assert.ok(r.failures.some(f => f.includes('CI is not green')));
  });

  it('NEGATIVE: review status not pass → NOT_READY', () => {
    const state = makePassedReview();
    state.review_status = 'fail';
    const r = checkReadiness({
      reviewState: state,
      currentHead: VALID_SHA,
      hasProof: true,
      manifestTier: 'T2',
      ciGreen: true,
      actor: 'griff843',
      approve: true,
    });
    assert.ok(!r.ready);
    assert.ok(r.failures.some(f => f.includes('fail')));
  });

  it('NEGATIVE: proof missing → NOT_READY', () => {
    const r = checkReadiness({
      reviewState: makePassedReview(),
      currentHead: VALID_SHA,
      hasProof: false,
      manifestTier: 'T2',
      ciGreen: true,
      actor: 'griff843',
      approve: true,
    });
    assert.ok(!r.ready);
    assert.ok(r.failures.some(f => f.includes('Proof')));
  });

  it('NEGATIVE: stale review (head changed) → NOT_READY', () => {
    const state = makePassedReview();
    state.reviewed_head_sha = VALID_SHA;
    const r = checkReadiness({
      reviewState: state,
      currentHead: OTHER_SHA,
      hasProof: true,
      manifestTier: 'T2',
      ciGreen: true,
      actor: 'griff843',
      approve: true,
    });
    assert.ok(!r.ready);
    assert.ok(r.failures.some(f => f.includes('stale')));
  });

  it('NEGATIVE: unresolved blocking findings → NOT_READY', () => {
    const state = makePassedReview();
    state.review_status = 'pass';
    const finding: ReviewFinding = {
      id: 'F-001',
      description: 'Missing null guard',
      severity: 'blocking',
      added_at: new Date().toISOString(),
      resolved_at: null,
    };
    state.findings.push(finding);
    const r = checkReadiness({
      reviewState: state,
      currentHead: VALID_SHA,
      hasProof: true,
      manifestTier: 'T2',
      ciGreen: true,
      actor: 'griff843',
      approve: true,
    });
    assert.ok(!r.ready);
    assert.ok(r.failures.some(f => f.includes('blocking finding')));
  });

  it('NEGATIVE: tier mismatch → NOT_READY', () => {
    const state = makePassedReview();
    state.tier = 'T1';
    const r = checkReadiness({
      reviewState: state,
      currentHead: VALID_SHA,
      hasProof: true,
      manifestTier: 'T2',
      ciGreen: true,
      actor: 'griff843',
      approve: true,
    });
    assert.ok(!r.ready);
    assert.ok(r.failures.some(f => f.includes('tier')));
  });

  it('NEGATIVE: self-certification in review state → NOT_READY', () => {
    const state = makePassedReview();
    state.executor = 'codex';
    state.reviewer = 'codex';
    const r = checkReadiness({
      reviewState: state,
      currentHead: VALID_SHA,
      hasProof: true,
      manifestTier: 'T2',
      ciGreen: true,
      actor: 'griff843',
      approve: true,
    });
    assert.ok(!r.ready);
    assert.ok(r.failures.some(f => f.includes('Self-certification')));
  });

  it('NEGATIVE: unauthorized PM actor → NOT_READY', () => {
    const r = checkReadiness({
      reviewState: makePassedReview(),
      currentHead: VALID_SHA,
      hasProof: true,
      manifestTier: 'T2',
      ciGreen: true,
      actor: 'random-user',
      approve: true,
    });
    assert.ok(!r.ready);
    assert.ok(r.failures.some(f => f.includes('not authorized')));
  });

  it('NEGATIVE: review state missing → NOT_READY', () => {
    const r = checkReadiness({
      reviewState: null,
      currentHead: VALID_SHA,
      hasProof: true,
      manifestTier: 'T2',
      ciGreen: true,
      actor: 'griff843',
      approve: true,
    });
    assert.ok(!r.ready);
    assert.ok(r.failures.some(f => f.includes('Review state missing')));
  });

  it('accumulates multiple failures', () => {
    const r = checkReadiness({
      reviewState: null,
      currentHead: null,
      hasProof: false,
      manifestTier: null,
      ciGreen: false,
      actor: 'bad-actor',
      approve: true,
    });
    assert.ok(!r.ready);
    assert.ok(r.failures.length >= 4);
  });
});
