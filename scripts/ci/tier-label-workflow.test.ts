/**
 * WORK-2026092402 — Tier Label Check resolves repository-owned WORK identities.
 *
 * The check and its privileged apply step each carry an identity grammar inline
 * in a github-script block. Neither knew `WORK-###`, so every WORK lane's PR
 * showed a red Tier Label Check. These tests execute the grammars the workflows
 * actually contain, read from disk, and pin them to the grammar merge-gate.yml
 * already uses, so the three cannot drift apart again.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const check = read('.github/workflows/tier-label-check.yml');
const apply = read('.github/workflows/tier-label-apply.yml');
const mergeGate = read('.github/workflows/merge-gate.yml');

/** The regex literal passed to `<anchor>.match(` on the first line containing the anchor. */
function matchLiteral(source: string, anchor: string): string {
  const line = source.split('\n').find((l) => l.includes(`${anchor}.match(`));
  assert.ok(line, `no ${anchor}.match( line found`);
  const literal = line.slice(line.indexOf(`${anchor}.match(`) + anchor.length + '.match('.length);
  const end = literal.lastIndexOf('/i)');
  assert.ok(end > 0, `no /i) terminator after ${anchor}.match(`);
  return literal.slice(0, end + 2);
}

function toRegExp(literal: string): RegExp {
  const lastSlash = literal.lastIndexOf('/');
  return new RegExp(literal.slice(1, lastSlash), literal.slice(lastSlash + 1));
}

/** Every `/^(?:...)-\d+$/` strict-format validator in a workflow. */
function strictValidators(source: string): string[] {
  return [...source.matchAll(/\/\^\(\?:[A-Z0-9|]+\)-\\d\+\$\//g)].map((m) => m[0]);
}

const checkBranch = matchLiteral(check, 'pr.head.ref');
const checkTitle = matchLiteral(check, "(pr.title || '')");
const gateBranch = matchLiteral(mergeGate, "(headRef || '')");
const gateTitle = matchLiteral(mergeGate, "(prTitle || '')");

function resolve(branch: string, title: string): string | null {
  const m = branch.match(toRegExp(checkBranch)) || title.match(toRegExp(checkTitle));
  return m ? m[1].toUpperCase() : null;
}

test('the check resolves a WORK identity from the branch and from the title', () => {
  assert.equal(resolve('claude/work-2026092402-tier-label-work-identity', ''), 'WORK-2026092402');
  assert.equal(resolve('feature-x', 'WORK-2026092401: the conveyor names...'), 'WORK-2026092401');
});

test('the tracker identities still resolve', () => {
  assert.equal(resolve('claude/utv2-1919-evidence-plane', ''), 'UTV2-1919');
  assert.equal(resolve('codex/uni-42-thing', ''), 'UNI-42');
  assert.equal(resolve('feature-x', 'UTV2-1827: governed staging proof runner'), 'UTV2-1827');
});

test('the grammar is bounded at both ends', () => {
  assert.equal(resolve('claude/homework-123', ''), null);
  assert.equal(resolve('claude/work-123abc', ''), null);
  assert.equal(resolve('feature-x', 'homework-123 is not an id'), null);
  assert.equal(resolve('feature-x', 'WORK-123abc is not an id'), null);
});

test('the check uses exactly the grammar merge-gate.yml uses', () => {
  assert.equal(checkBranch, gateBranch);
  assert.equal(checkTitle, gateTitle);
});

test('both strict-format validators admit WORK and nothing wider', () => {
  const validators = [...strictValidators(check), ...strictValidators(apply)];
  assert.equal(validators.length, 2, `expected one validator per workflow, found ${validators.join(', ')}`);
  for (const literal of validators) {
    const re = toRegExp(literal);
    for (const ok of ['WORK-2026092402', 'UTV2-1919', 'UNI-42']) assert.ok(re.test(ok), `${literal} refused ${ok}`);
    for (const bad of ['WORK-', 'work-1', 'HOMEWORK-1', 'WORK-1 ', 'tier:T1', 'OTHER-1']) {
      assert.equal(re.test(bad), false, `${literal} admitted ${bad}`);
    }
  }
});

test('the label allowlist and the manifest-only tier source are unchanged', () => {
  assert.ok(check.includes('/^tier:T[123]$/.test(l)'), 'check must still refuse a non-tier label');
  assert.ok(apply.includes("/^tier:T[123]$/.test(l)"), 'apply must still refuse a non-tier label');
  assert.ok(check.includes('path: `docs/06_status/lanes/${issueId}.json`'), 'tier must still come from the lane manifest');
  assert.equal(/secrets\.SYNC_BOT_TOKEN/.test(check), false, 'the pull_request job must never reach the privileged token');
});
