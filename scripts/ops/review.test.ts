/**
 * Tests for ops:review (Review Packet Generator — WFR-v2 Phase C)
 *
 * Tests the executor → reviewer assignment logic and packet generation.
 * No gh CLI calls are made in these tests.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  makeEmptyReviewState,
  writeReviewState,
  readReviewState,
  isSelfCertification,
  type Executor,
} from './review-state-schema.js';

// ---------------------------------------------------------------------------
// Inline the reviewer assignment logic (matches review.ts)
// ---------------------------------------------------------------------------

function assignReviewer(executor: Executor): Executor {
  if (executor === 'claude') return 'codex';
  if (executor === 'codex' || executor === 'codex-cli' || executor === 'codex-cloud') return 'claude';
  return 'claude';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('assignReviewer', () => {
  it('claude implementation → codex review', () => {
    assert.equal(assignReviewer('claude'), 'codex');
  });

  it('codex implementation → claude review', () => {
    assert.equal(assignReviewer('codex'), 'claude');
  });

  it('codex-cli implementation → claude review', () => {
    assert.equal(assignReviewer('codex-cli'), 'claude');
  });

  it('codex-cloud implementation → claude review', () => {
    assert.equal(assignReviewer('codex-cloud'), 'claude');
  });

  it('pm implementation → claude review (fallback)', () => {
    assert.equal(assignReviewer('pm'), 'claude');
  });

  it('NEGATIVE: claude review of own work → self-cert blocked', () => {
    const state = makeEmptyReviewState('UTV2-TEST', 900, 'claude', 'T2', 'governance', []);
    state.reviewer = 'claude';
    assert.equal(isSelfCertification(state), true);
  });

  it('NEGATIVE: codex review of own work → self-cert blocked', () => {
    const state = makeEmptyReviewState('UTV2-TEST', 900, 'codex', 'T2', 'governance', []);
    state.reviewer = 'codex';
    assert.equal(isSelfCertification(state), true);
  });

  it('opposite reviewer assignment is never self-cert', () => {
    const executors: Executor[] = ['claude', 'codex', 'codex-cli', 'codex-cloud'];
    for (const executor of executors) {
      const reviewer = assignReviewer(executor);
      const state = makeEmptyReviewState('UTV2-TEST', 900, executor, 'T2', 'governance', []);
      state.reviewer = reviewer;
      assert.equal(
        isSelfCertification(state),
        false,
        `Expected no self-cert for executor=${executor} reviewer=${reviewer}`,
      );
    }
  });
});

describe('review packet initialization', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-packet-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates review state file in in_review status', () => {
    const state = makeEmptyReviewState('UTV2-PKT1', 900, 'codex', 'T2', 'governance', ['package.json']);
    state.reviewer = assignReviewer('codex');
    state.review_status = 'in_review';
    writeReviewState(state, tmpDir);
    const loaded = readReviewState('UTV2-PKT1', tmpDir);
    assert.equal(loaded.review_status, 'in_review');
    assert.equal(loaded.reviewer, 'claude');
    assert.equal(loaded.executor, 'codex');
  });

  it('NEGATIVE: does not set review_status to pass on creation', () => {
    const state = makeEmptyReviewState('UTV2-PKT2', 901, 'claude', 'T1', 'migration', []);
    state.reviewer = assignReviewer('claude');
    state.review_status = 'in_review';
    writeReviewState(state, tmpDir);
    const loaded = readReviewState('UTV2-PKT2', tmpDir);
    assert.notEqual(loaded.review_status, 'pass');
  });

  it('NEGATIVE: scope bleed detection — changed file not in lock scope', () => {
    const lockScope = ['scripts/ops/proof-schema.ts'];
    const changedFiles = ['scripts/ops/proof-schema.ts', 'README.md'];
    const outOfScope = changedFiles.filter(f => !lockScope.includes(f));
    assert.deepEqual(outOfScope, ['README.md']);
  });

  it('no scope bleed when all changed files in lock scope', () => {
    const lockScope = ['scripts/ops/proof-schema.ts', 'package.json'];
    const changedFiles = ['scripts/ops/proof-schema.ts'];
    const outOfScope = changedFiles.filter(f => !lockScope.includes(f));
    assert.deepEqual(outOfScope, []);
  });
});
