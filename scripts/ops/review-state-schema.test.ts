import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateReviewState,
  isSelfCertification,
  isReviewStale,
  makeEmptyReviewState,
  writeReviewState,
  readReviewState,
  type ReviewStateV1,
} from './review-state-schema.js';

const VALID_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

function makeValid(): ReviewStateV1 {
  return makeEmptyReviewState('UTV2-1157', 900, 'claude', 'T2', 'governance', ['package.json']);
}

describe('validateReviewState', () => {
  it('accepts a valid empty review state', () => {
    const r = validateReviewState(makeValid());
    assert.ok(r.valid, JSON.stringify(r.failures));
  });

  it('rejects null', () => {
    const r = validateReviewState(null);
    assert.ok(!r.valid);
    assert.ok(r.failures.some(f => f.field === 'root'));
  });

  it('rejects wrong schema_version', () => {
    const r = validateReviewState({ ...makeValid(), schema_version: 2 });
    assert.ok(!r.valid);
    assert.ok(r.failures.some(f => f.field === 'schema_version'));
  });

  it('rejects empty issue_id', () => {
    const r = validateReviewState({ ...makeValid(), issue_id: '' });
    assert.ok(!r.valid);
  });

  it('rejects invalid pr_number', () => {
    const r = validateReviewState({ ...makeValid(), pr_number: 0 });
    assert.ok(!r.valid);
    assert.ok(r.failures.some(f => f.field === 'pr_number'));
  });

  it('rejects invalid executor', () => {
    const r = validateReviewState({ ...makeValid(), executor: 'robot' });
    assert.ok(!r.valid);
    assert.ok(r.failures.some(f => f.field === 'executor'));
  });

  it('rejects invalid tier', () => {
    const r = validateReviewState({ ...makeValid(), tier: 'T9' });
    assert.ok(!r.valid);
    assert.ok(r.failures.some(f => f.field === 'tier'));
  });

  it('rejects invalid review_status', () => {
    const r = validateReviewState({ ...makeValid(), review_status: 'approved' });
    assert.ok(!r.valid);
    assert.ok(r.failures.some(f => f.field === 'review_status'));
  });

  it('rejects invalid pm_verdict_status', () => {
    const r = validateReviewState({ ...makeValid(), pm_verdict_status: 'yes' });
    assert.ok(!r.valid);
    assert.ok(r.failures.some(f => f.field === 'pm_verdict_status'));
  });

  it('accepts null reviewed_head_sha', () => {
    const r = validateReviewState({ ...makeValid(), reviewed_head_sha: null });
    assert.ok(r.valid, JSON.stringify(r.failures));
  });

  it('rejects malformed reviewed_head_sha', () => {
    const r = validateReviewState({ ...makeValid(), reviewed_head_sha: 'short' });
    assert.ok(!r.valid);
    assert.ok(r.failures.some(f => f.field === 'reviewed_head_sha'));
  });

  it('rejects non-array blocking_findings', () => {
    const r = validateReviewState({ ...makeValid(), blocking_findings: 'bad' });
    assert.ok(!r.valid);
  });

  it('rejects negative re_review_count', () => {
    const r = validateReviewState({ ...makeValid(), re_review_count: -1 });
    assert.ok(!r.valid);
    assert.ok(r.failures.some(f => f.field === 're_review_count'));
  });

  it('accumulates multiple failures', () => {
    const r = validateReviewState({
      schema_version: 99,
      issue_id: '',
      pr_number: -5,
    });
    assert.ok(!r.valid);
    assert.ok(r.failures.length >= 3);
  });
});

describe('isSelfCertification', () => {
  it('returns false when reviewer is null', () => {
    const state = { ...makeValid(), reviewer: null };
    assert.equal(isSelfCertification(state), false);
  });

  it('NEGATIVE: returns true when reviewer == executor (self-cert blocked)', () => {
    const state = { ...makeValid(), executor: 'claude' as const, reviewer: 'claude' as const };
    assert.equal(isSelfCertification(state), true);
  });

  it('returns false when reviewer != executor', () => {
    const state = { ...makeValid(), executor: 'claude' as const, reviewer: 'codex' as const };
    assert.equal(isSelfCertification(state), false);
  });

  it('NEGATIVE: codex self-certifying own patch → blocked', () => {
    const state = { ...makeValid(), executor: 'codex' as const, reviewer: 'codex' as const };
    assert.equal(isSelfCertification(state), true);
  });
});

describe('isReviewStale', () => {
  it('returns false when no reviewed_head_sha set yet', () => {
    const state = { ...makeValid(), reviewed_head_sha: null };
    assert.equal(isReviewStale(state, VALID_SHA), false);
  });

  it('returns false when head matches', () => {
    const state = { ...makeValid(), reviewed_head_sha: VALID_SHA };
    assert.equal(isReviewStale(state, VALID_SHA), false);
  });

  it('NEGATIVE: returns true when head changed after review (stale verdict)', () => {
    const state = { ...makeValid(), reviewed_head_sha: VALID_SHA };
    assert.equal(isReviewStale(state, OTHER_SHA), true);
  });

  it('returns false when currentHeadSha is malformed', () => {
    const state = { ...makeValid(), reviewed_head_sha: VALID_SHA };
    assert.equal(isReviewStale(state, 'bad'), false);
  });
});

describe('review state file I/O', () => {
  let tmpDir: string;
  let root: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-state-test-'));
    root = tmpDir;
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trips a valid review state', () => {
    const state = makeEmptyReviewState('UTV2-TEST', 900, 'codex', 'T2', 'governance', []);
    writeReviewState(state, root);
    const loaded = readReviewState('UTV2-TEST', root);
    assert.equal(loaded.issue_id, 'UTV2-TEST');
    assert.equal(loaded.executor, 'codex');
  });

  it('NEGATIVE: throws when file missing', () => {
    assert.throws(() => readReviewState('UTV2-MISSING', root));
  });

  it('NEGATIVE: throws when file is corrupt JSON', () => {
    const dir = path.join(root, '.ops', 'reviews');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'UTV2-CORRUPT.json'), '{bad json}');
    assert.throws(() => readReviewState('UTV2-CORRUPT', root));
  });

  it('NEGATIVE: throws when schema_version is wrong', () => {
    const state = { ...makeEmptyReviewState('UTV2-BAD', 1, 'claude', 'T2', 'governance', []), schema_version: 99 };
    const dir = path.join(root, '.ops', 'reviews');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'UTV2-BAD.json'), JSON.stringify(state));
    assert.throws(() => readReviewState('UTV2-BAD', root));
  });
});
