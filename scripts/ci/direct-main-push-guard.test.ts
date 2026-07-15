import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  classifyMainCommit,
  emergencyRecordReferencesSha,
  type CommitClassificationInput,
} from './direct-main-push-guard.js';

const INCIDENT_SHA = '74eb6cd65da829cb969a4a7819494a1d3747ccb2';

function input(overrides: Partial<CommitClassificationInput> = {}): CommitClassificationInput {
  return {
    sha: INCIDENT_SHA,
    authorLogin: 'griff843',
    message: 'chore(proof): bind proof to merge SHA and add T1 runtime proof',
    associatedPrNumbers: [],
    ...overrides,
  };
}

// ── legitimate GitHub merge / squash merge commits ──────────────────────────────

test('classifyMainCommit: a commit with an associated PR is pr_merge, regardless of author', () => {
  const result = classifyMainCommit(input({ associatedPrNumbers: [1216] }));
  assert.strictEqual(result.code, 'pr_merge');
  assert.match(result.reason, /#1216/);
});

// ── explicitly authorized automation ─────────────────────────────────────────────

const LANE_CLOSE_MESSAGE = 'chore(lanes): close UTV2-9999 — lane closed, sync file removed';
const LANE_CLOSE_SCOPED_FILES = [
  'docs/06_status/lanes/UTV2-9999.json',
  'docs/06_status/proof/UTV2-9999/evidence.json',
  '.ops/sync/UTV2-9999.yml',
];

test('classifyMainCommit: github-actions[bot] with the allow-listed lane-close message AND only in-scope changed files is authorized_automation', () => {
  const result = classifyMainCommit(
    input({
      authorLogin: 'github-actions[bot]',
      message: LANE_CLOSE_MESSAGE,
      associatedPrNumbers: [],
      changedFiles: LANE_CLOSE_SCOPED_FILES,
    }),
  );
  assert.strictEqual(result.code, 'authorized_automation');
});

test('classifyMainCommit: github-actions[bot] with an UNLISTED message pattern is NOT auto-authorized', () => {
  const result = classifyMainCommit(
    input({
      authorLogin: 'github-actions[bot]',
      message: 'chore: some other automated change not on the allow-list',
      associatedPrNumbers: [],
      changedFiles: LANE_CLOSE_SCOPED_FILES,
    }),
  );
  assert.strictEqual(result.code, 'unauthorized_direct_push');
});

test('classifyMainCommit: a human identity is never treated as automation even with a matching message text', () => {
  const result = classifyMainCommit(
    input({
      authorLogin: 'griff843',
      message: LANE_CLOSE_MESSAGE,
      associatedPrNumbers: [],
      changedFiles: LANE_CLOSE_SCOPED_FILES,
    }),
  );
  assert.strictEqual(result.code, 'unauthorized_direct_push');
});

// ── message pattern alone is never sufficient -- changed files must also match ──

test('classifyMainCommit: github-actions[bot] with the allow-listed message but a file OUTSIDE its known scope is NOT authorized_automation', () => {
  const result = classifyMainCommit(
    input({
      authorLogin: 'github-actions[bot]',
      message: LANE_CLOSE_MESSAGE,
      associatedPrNumbers: [],
      changedFiles: [...LANE_CLOSE_SCOPED_FILES, 'apps/api/src/server.ts'],
    }),
  );
  assert.strictEqual(result.code, 'unauthorized_direct_push');
});

test('classifyMainCommit: github-actions[bot] with the allow-listed message but NO changedFiles evidence is NOT authorized (never authorizes on message text alone)', () => {
  const result = classifyMainCommit(
    input({
      authorLogin: 'github-actions[bot]',
      message: LANE_CLOSE_MESSAGE,
      associatedPrNumbers: [],
      // changedFiles intentionally omitted
    }),
  );
  assert.strictEqual(result.code, 'unauthorized_direct_push');
});

// ── documented emergency exceptions ──────────────────────────────────────────────

function makeTmpIncidentsRoot(): { root: string; incidentsDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-main-push-guard-test-'));
  const incidentsDir = path.join(root, 'docs', '06_status', 'INCIDENTS');
  fs.mkdirSync(incidentsDir, { recursive: true });
  return { root, incidentsDir };
}

test('emergencyRecordReferencesSha: true only when the file exists, is under INCIDENTS/, and mentions the SHA', () => {
  const { root, incidentsDir } = makeTmpIncidentsRoot();
  const recordPath = path.join(incidentsDir, 'INC-2026-01-01-example.md');
  fs.writeFileSync(recordPath, `mentions ${INCIDENT_SHA} as an emergency bypass`);

  assert.strictEqual(
    emergencyRecordReferencesSha('docs/06_status/INCIDENTS/INC-2026-01-01-example.md', INCIDENT_SHA, root),
    true,
  );
  assert.strictEqual(
    emergencyRecordReferencesSha('docs/06_status/INCIDENTS/does-not-exist.md', INCIDENT_SHA, root),
    false,
  );
  assert.strictEqual(
    emergencyRecordReferencesSha('docs/06_status/INCIDENTS/INC-2026-01-01-example.md', 'some-other-sha', root),
    false,
  );
});

test('emergencyRecordReferencesSha: refuses to follow a trailer path outside docs/06_status/INCIDENTS/', () => {
  const { root } = makeTmpIncidentsRoot();
  const outsidePath = path.join(root, 'secrets.env');
  fs.writeFileSync(outsidePath, INCIDENT_SHA);
  assert.strictEqual(emergencyRecordReferencesSha('../secrets.env', INCIDENT_SHA, root), false);
  assert.strictEqual(emergencyRecordReferencesSha('secrets.env', INCIDENT_SHA, root), false);
});

test('classifyMainCommit: a commit with a valid Emergency-Bypass-Record trailer is documented_emergency_exception', () => {
  const result = classifyMainCommit(
    input({
      message: [
        'fix(prod): emergency hotfix for live outage',
        '',
        'Emergency-Bypass-Record: docs/06_status/INCIDENTS/INC-2026-01-01-example.md',
      ].join('\n'),
    }),
    { checkEmergencyRecord: () => true },
  );
  assert.strictEqual(result.code, 'documented_emergency_exception');
});

test('classifyMainCommit: an Emergency-Bypass-Record trailer that does not resolve to a real, matching doc is still unauthorized', () => {
  const result = classifyMainCommit(
    input({
      message: [
        'chore(proof): bind proof to merge SHA',
        '',
        'Emergency-Bypass-Record: docs/06_status/INCIDENTS/does-not-exist.md',
      ].join('\n'),
    }),
    { checkEmergencyRecord: () => false },
  );
  assert.strictEqual(result.code, 'unauthorized_direct_push');
});

// ── unauthorized human direct pushes: the exact incident this guard was built for ─

test('classifyMainCommit: reproduces the real incident -- no PR, human author, no bypass trailer -> unauthorized_direct_push', () => {
  const result = classifyMainCommit(
    input({
      sha: INCIDENT_SHA,
      authorLogin: 'griff843',
      message:
        'chore(proof): UTV2-1533 bind proof to merge SHA and add T1 runtime proof\n\n' +
        'Binds evidence.json/verification.md to the real merge commit 8ca5acf3...',
      associatedPrNumbers: [],
    }),
  );
  assert.strictEqual(result.code, 'unauthorized_direct_push');
  assert.match(result.reason, /no associated PR/);
});

test('classifyMainCommit: an unknown/null author login with no PR is unauthorized_direct_push (fails closed, not silently trusted)', () => {
  const result = classifyMainCommit(input({ authorLogin: null, associatedPrNumbers: [] }));
  assert.strictEqual(result.code, 'unauthorized_direct_push');
});
