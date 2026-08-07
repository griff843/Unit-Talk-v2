import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './shared.js';

function readWorkflow(): string {
  return fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'post-merge-lane-close.yml'), 'utf8');
}

/*
 * HONEST PARTIAL (PM decision 2026-08-04, tracked as UTV2-1673).
 *
 * These assertions prove the `resolve_sha` step EXISTS and is shaped
 * correctly. They do NOT prove workflow_dispatch replays actually bind to the
 * right merge SHA -- because they don't. `resolve_sha`'s only consumer is the
 * "Bind proof artifacts to merge SHA" step, which UTV2-1589 restricted to
 * `github.event_name == 'push'` for a documented safety reason. On `push`,
 * `resolve_sha` returns `github.sha`, so behavior is unchanged.
 *
 * Read a green run of this file as "the step is present and correct", never
 * as "replay binding works". The third test below exists precisely so this
 * suite cannot be made to pass by widening the UTV2-1589 gate -- which is the
 * wrong fix. UTV2-1673 owns the right one.
 */

test('UTV2-1567: post-merge-lane-close.yml has a resolve_sha step shaped to read the merge SHA from the manifest PR (see honest-partial note above)', () => {
  const workflow = readWorkflow();

  const resolveStep = workflow.match(/- name: Resolve merge SHA[\s\S]*?(?=\n {6}- name:)/);
  assert.ok(resolveStep, 'post-merge-lane-close.yml must have a dedicated "Resolve merge SHA" step');
  const body = resolveStep[0];

  assert.match(
    body,
    /github\.event_name.*=\s*"workflow_dispatch"/,
    'the resolve step must branch on the workflow_dispatch trigger',
  );
  assert.match(
    body,
    /gh pr view .*--json mergeCommit/,
    'the workflow_dispatch branch must resolve the merge SHA from the manifest PR via the GitHub API',
  );
  assert.match(
    body,
    /merge_sha=\$\{\{ github\.sha \}\}/,
    'the non-workflow_dispatch (push) branch must still use github.sha, which is correct there',
  );
});

test('UTV2-1567: "Bind proof artifacts to merge SHA" step consumes the resolved SHA, not github.sha directly', () => {
  const workflow = readWorkflow();

  const bindStep = workflow.match(/- name: Bind proof artifacts to merge SHA[\s\S]*?(?=\n {6}- name:)/);
  assert.ok(bindStep, 'post-merge-lane-close.yml must have a "Bind proof artifacts to merge SHA" step');
  const body = bindStep[0];

  assert.match(
    body,
    /MERGE_SHA:\s*\$\{\{\s*steps\.resolve_sha\.outputs\.merge_sha\s*\}\}/,
    'MERGE_SHA must come from the resolve_sha step output, not github.sha directly -- ' +
      'github.sha is only correct for the push trigger; a workflow_dispatch replay of an ' +
      'already-merged lane would otherwise bind proof to today\'s main HEAD instead of the ' +
      'issue\'s real merge commit (UTV2-1567)',
  );
  assert.doesNotMatch(
    body,
    /MERGE_SHA:\s*\$\{\{\s*github\.sha\s*\}\}/,
    'MERGE_SHA must not be set directly from github.sha in this step',
  );
});

test("UTV2-1589's push-only restriction on the bind step survives UTV2-1567 (UTV2-1673 owns lifting it safely)", () => {
  const workflow = readWorkflow();

  const bindStep = workflow.match(/- name: Bind proof artifacts to merge SHA[\s\S]*?(?=\n {6}- name:)/);
  assert.ok(bindStep, 'post-merge-lane-close.yml must have a "Bind proof artifacts to merge SHA" step');
  const ifLine = bindStep[0].split('\n').find((line) => line.trim().startsWith('if:'));
  assert.ok(ifLine, 'the bind step must carry an explicit `if:` guard');

  // This is a fail-closed guard, not a style check. Wiring resolve_sha into
  // the bind step (the test above) makes it *look* like widening this
  // condition to include workflow_dispatch would finish UTV2-1567. It would
  // not -- it would reintroduce exactly the hazard UTV2-1589 closed: an early
  // bind that trusts manifest.pr_url from disk, with no GitHub-backed
  // validation, can write model-routing.json's IMMUTABLE closeout_binding
  // from a stale/renamed/reopened PR identity and permanently deadlock every
  // future replay of the very repair this workflow exists to perform.
  //
  // Widening the gate requires UTV2-1673's three validations first (PR
  // identity, merge-SHA ownership + reachability, and separate authorization
  // for immutable artifacts). If you are here because this test failed, the
  // question to answer is "did UTV2-1673 land?", not "how do I loosen this?".
  assert.match(
    ifLine,
    /github\.event_name == 'push'/,
    "the bind step must remain restricted to the push trigger until UTV2-1673 makes workflow_dispatch replay binding safe -- see UTV2-1589's in-file rationale",
  );

  // The assertion above is necessary but NOT sufficient on its own: it still
  // matches inside a widened `(github.event_name == 'push' ||
  // github.event_name == 'workflow_dispatch')`, which is the exact mistake
  // this test exists to catch. Verified by negative control -- with only the
  // match above, widening the gate left the suite green. Any mention of
  // workflow_dispatch in this guard means the restriction has been lifted.
  assert.doesNotMatch(
    ifLine,
    /workflow_dispatch/,
    'the bind step guard must not admit workflow_dispatch -- widening it (including via an ' +
      "`|| github.event_name == 'workflow_dispatch'` disjunction) reintroduces the unvalidated " +
      'replay binding UTV2-1589 closed. UTV2-1673 must land first.',
  );
});
