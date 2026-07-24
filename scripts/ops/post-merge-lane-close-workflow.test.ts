import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './shared.js';

function readWorkflow(): string {
  return fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'post-merge-lane-close.yml'), 'utf8');
}

test('UTV2-1567: post-merge-lane-close.yml resolves the merge SHA via the manifest PR, not github.sha, for workflow_dispatch', () => {
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
