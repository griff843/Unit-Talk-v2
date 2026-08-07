/**
 * Guard on the phase-1 bootstrap head-read exception (UTV2-1619 capability 19).
 *
 * The head fallback lets a PR supply its own authority artifact. That is safe
 * only while it stays pinned to one issue and one narrow diff shape, and the
 * constraint lives in inline workflow JavaScript that no unit test would
 * otherwise execute. These assertions fail if the exception is widened, so a
 * change to its scope has to be deliberate rather than incidental.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github/workflows/merge-gate.yml'), 'utf8');

function allowlistFromWorkflow(): string[] {
  const block = WORKFLOW.match(/const BOOTSTRAP_ALLOWED_FILES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, 'BOOTSTRAP_ALLOWED_FILES must exist in merge-gate.yml');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('BHF-1: the head fallback is pinned to the single initial bootstrap issue', () => {
  const match = WORKFLOW.match(/const BOOTSTRAP_INTRODUCTION_ISSUE = '([^']+)'/);
  assert.ok(match, 'BOOTSTRAP_INTRODUCTION_ISSUE must be declared');
  assert.equal(match[1], 'UTV2-1619');
});

test('BHF-2: the allowlist contains exactly the approved bootstrap paths', () => {
  assert.deepEqual(allowlistFromWorkflow().sort(), [
    '.github/workflows/merge-gate.yml',
    'docs/governance/BOOTSTRAP_AUTHORIZATIONS.json',
    'package.json',
    'scripts/ops/bootstrap-authorization.test.ts',
    'scripts/ops/bootstrap-authorization.ts',
    'scripts/ops/bootstrap-head-fallback-guard.test.ts',
    'scripts/ops/lane-start.ts',
    'scripts/ops/pre-merge-authorization.test.ts',
    'scripts/ops/pre-merge-authorization.ts',
  ]);
});

test('BHF-3: no application or runtime path may enter the allowlist', () => {
  const forbidden = ['apps/', 'packages/', 'supabase/', 'infra/'];
  for (const entry of allowlistFromWorkflow()) {
    for (const prefix of forbidden) {
      assert.ok(
        !entry.startsWith(prefix),
        `allowlist entry "${entry}" is an application/runtime path and must not be bootstrap-allowed`,
      );
    }
  }
});

test('BHF-4: the proof prefix is scoped to the bootstrap issue, not all proofs', () => {
  const block = WORKFLOW.match(/const BOOTSTRAP_ALLOWED_PREFIXES = \[([\s\S]*?)\]/);
  assert.ok(block, 'BOOTSTRAP_ALLOWED_PREFIXES must exist');
  const prefixes = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(prefixes, ['docs/06_status/proof/UTV2-1619/']);
});

test('BHF-5: base is read before head, and head only when base has nothing', () => {
  assert.match(
    WORKFLOW,
    /let doc = await readBootstrapAuthorizations\(baseSha\);/,
    'base must be consulted first',
  );
  assert.match(
    WORKFLOW,
    /if \(!doc\) \{\s*\n\s*const headDoc = await readBootstrapAuthorizations\(headSha\);/,
    'head must be consulted only when base yielded nothing',
  );
});

test('BHF-6: a head-sourced admission must disclose its source in the verdict', () => {
  assert.match(WORKFLOW, /Source: PR HEAD bootstrap artifact \(not base\)/);
  assert.match(WORKFLOW, /Source: base bootstrap artifact \(canonical\)/);
});

test('BHF-7: failure to enumerate the diff refuses head-read rather than allowing it', () => {
  assert.match(WORKFLOW, /diffScopeOk = false;\s*\n\s*offendingFiles\.push\(`<diff enumeration failed/);
});

test('BHF-8: the Merge Gate and merge-wrapper allowlists must not drift apart', async () => {
  // Two independent authorities decide bootstrap admission: Merge Gate (inline
  // workflow JS) and pre-merge-authorization (the sanctioned merge path). If
  // their allowlists disagree, one will admit a diff the other refuses, and the
  // effective policy becomes whichever ran last. Caught in practice: the
  // merge-wrapper list was extended and the workflow list was not.
  const mod = await import('./pre-merge-authorization.js');
  const wrapper = [...(mod.BOOTSTRAP_ALLOWED_FILES as ReadonlySet<string>)].sort();
  assert.deepEqual(allowlistFromWorkflow().sort(), wrapper);

  const workflowPrefixes = [
    ...WORKFLOW.match(/const BOOTSTRAP_ALLOWED_PREFIXES = \[([\s\S]*?)\]/)![1].matchAll(/'([^']+)'/g),
  ].map((m) => m[1]);
  assert.deepEqual(workflowPrefixes, [...(mod.BOOTSTRAP_ALLOWED_PREFIXES as readonly string[])]);
});

test('BHF-9: both authorities pin the same initial bootstrap issue', async () => {
  const mod = await import('./pre-merge-authorization.js');
  const workflowIssue = WORKFLOW.match(/const BOOTSTRAP_INTRODUCTION_ISSUE = '([^']+)'/)![1];
  assert.equal(workflowIssue, mod.BOOTSTRAP_INTRODUCTION_ISSUE);
});
