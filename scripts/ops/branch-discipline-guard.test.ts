import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateBranchDiscipline, extractIssueIds } from './branch-discipline-guard.js';

test('a branch with no issue ID passes — mission-native work has no ticket', () => {
  // The prior rule ("branch must include exactly one UTV2-###") reds every PR
  // produced by the mission-native model, where work comes from the plan.
  const result = evaluateBranchDiscipline({
    title: 'harness: recalibrate the agent environment',
    body: 'No reserved surface touched.',
    branch: 'harness/mission-native-recalibration',
    commits: 'harness: recalibrate the agent environment',
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'no_branch_issue_reference');
  assert.deepEqual(result.errors, []);
});

test('an unbranded branch may cite one issue as context, and says so', () => {
  const result = evaluateBranchDiscipline({
    title: 'fix: reject unresolvable identity',
    body: 'Context: originally reported as UTV2-1824.',
    branch: 'fix/unresolvable-identity',
    commits: 'fix: reject unresolvable identity',
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'no_branch_issue_reference');
  assert.match(String(result.warning), /portfolio-only/);
});

test('an unbranded branch citing two issues still fails — the real control', () => {
  // What this guard protects is that one change cannot be read as belonging to
  // two issues. Dropping the "must have an issue" rule must not drop that.
  const result = evaluateBranchDiscipline({
    title: 'fix: two things',
    body: 'Closes UTV2-1000 and UTV2-1001',
    branch: 'fix/two-things',
    commits: 'fix: two things',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'multiple_issue_references');
  assert.deepEqual(result.issue_ids, ['UTV2-1000', 'UTV2-1001']);
});

test('a lane branch still binds to exactly its own issue', () => {
  const ok = evaluateBranchDiscipline({
    title: 'UTV2-1824: resolve capper identity',
    body: 'Closes UTV2-1824',
    branch: 'claude/utv2-1824-smart-form-canonical-identity',
    commits: 'UTV2-1824: resolve capper identity',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.code, 'single_issue_reference');

  const crossRef = evaluateBranchDiscipline({
    title: 'UTV2-1824: resolve capper identity',
    body: 'Also fixes UTV2-1815',
    branch: 'claude/utv2-1824-smart-form-canonical-identity',
    commits: 'UTV2-1824: resolve capper identity',
  });
  assert.equal(crossRef.ok, false, 'a lane branch must not drag in another issue');
});

test('a branch naming two issues is still ambiguous and fails', () => {
  const result = evaluateBranchDiscipline({
    title: 'combined work',
    body: '',
    branch: 'claude/utv2-1000-utv2-1001-combined',
    commits: 'combined work',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'missing_branch_issue_reference');
  assert.match(result.errors[0]!, /references multiple issue IDs/);
});

test('exempt branches are unaffected', () => {
  const result = evaluateBranchDiscipline({ branch: 'dependabot/npm_and_yarn/foo-1.2.3' });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'exempt_branch');
});

test('extractIssueIds is case-insensitive and de-duplicates', () => {
  assert.deepEqual(extractIssueIds('utv2-12 UTV2-12 UNI-3'), ['UNI-3', 'UTV2-12']);
});
