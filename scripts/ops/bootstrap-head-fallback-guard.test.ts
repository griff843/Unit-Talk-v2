/**
 * Guard on the *absence* of the phase-1 bootstrap head-read exception.
 *
 * History: UTV2-1619 capability 19 let a PR supply its own authority artifact
 * from its own head. That exception existed for one reason — Merge Gate hard-
 * failed on a missing lane-manifest tier, so the change that repaired lane
 * admission could never itself be admitted. The exception was the bridge over
 * that deadlock, and this file used to constrain it: pinned to one issue, one
 * narrow diff shape, kept in sync with the merge-wrapper copy.
 *
 * RMA/v1 (2026-09-02, docs/mission/intent.md) removed the deadlock at its root.
 * Merge Gate no longer reads a lane manifest — or any repository content — to
 * resolve authority; it classifies the diff against
 * docs/05_operations/RESERVED_RISK_SURFACES.json using a module loaded from the
 * pinned base checkout. With no deadlock there is nothing for a head-read to
 * bridge, so the exception is gone.
 *
 * These assertions now guard the stronger property: a PR must not be able to
 * supply its own merge authority at all. If the exception ever returns, it must
 * be a deliberate act that fails this file first.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github/workflows/merge-gate.yml'), 'utf8');

test('BHF-1: the bootstrap head-read exception is absent from Merge Gate', () => {
  for (const symbol of [
    'BOOTSTRAP_INTRODUCTION_ISSUE',
    'BOOTSTRAP_ALLOWED_FILES',
    'BOOTSTRAP_ALLOWED_PREFIXES',
    'readBootstrapAuthorizations',
  ]) {
    assert.ok(
      !WORKFLOW.includes(symbol),
      `${symbol} reintroduces the head-read exception RMA/v1 retired — a PR must not supply its own authority`,
    );
  }
});

test('BHF-2: Merge Gate never reads repository content to resolve authority', () => {
  // getContent was how the manifest (and the bootstrap artifact) were read. Any
  // reintroduction means authority is being sourced from a ref again, which is
  // the shape of the original vulnerability regardless of which ref is chosen.
  assert.ok(
    !WORKFLOW.includes('repos.getContent'),
    'Merge Gate must classify the diff, not read authority artifacts out of a ref',
  );
});

test('BHF-3: Merge Gate resolves authority from the reserved-surface policy', () => {
  assert.match(
    WORKFLOW,
    /require\('\.\/scripts\/ops\/merge-authority\.cjs'\)/,
    'authority must come from the tested classifier module',
  );
  assert.match(
    WORKFLOW,
    /evaluateMergeAuthority\(/,
    'the classifier must actually be invoked, not merely imported',
  );
});

test('BHF-4: the authority module is loaded from the pinned base checkout, never PR head', () => {
  // The checkout step pins pull_request(_review) events to base.sha precisely so
  // merge-authority.cjs and its policy cannot be PR-supplied. If that pin is
  // relaxed, a PR can rewrite its own classifier — the same class of hole the
  // retired bootstrap exception was fenced against.
  assert.match(
    WORKFLOW,
    /ref: \$\{\{ \(github\.event_name == 'pull_request' \|\| github\.event_name == 'pull_request_review'\) && github\.event\.pull_request\.base\.sha \|\| github\.sha \}\}/,
    'Merge Gate checkout must stay pinned to base.sha for PR-triggered events',
  );
});

test('BHF-5: the reserved-surface policy reserves its own amendment', async () => {
  // This is what makes RMA non-self-amending and replaces every constraint the
  // old allowlist provided: widening authority is itself a reserved surface, so
  // it always requires a human.
  const { loadPolicy, classifyDiff } = await import('./merge-authority.cjs');
  const policy = loadPolicy(ROOT);

  for (const self of [
    '.github/workflows/merge-gate.yml',
    'docs/05_operations/RESERVED_RISK_SURFACES.json',
    'scripts/ops/merge-authority.cjs',
    '.github/CODEOWNERS',
  ]) {
    const result = classifyDiff({
      files: [{ filename: self, patch: '+x', status: 'modified' }],
      policy,
    });
    assert.equal(result.authority, 'human', `${self} must be a reserved surface`);
    assert.ok(result.surfaces.includes('merge-authority'), `${self} must map to the merge-authority surface`);
  }
});
