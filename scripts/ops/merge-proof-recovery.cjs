'use strict';

const EXPECTED_REPOSITORY = 'griff843/Unit-Talk-v2';
const RECOVERY_EVENT = 'merge-proof-recovery';
const REQUIRED_CONTEXTS = Object.freeze({
  staging: 'Writable DB proof (staging only)',
  verify: 'verify',
});
const NATIVE_JOB_NAMES = Object.freeze({
  staging: 'Merge recovery / writable DB proof',
  verify: 'Merge recovery / full verify',
});
const SHA_PATTERN = /^[0-9a-f]{40}$/;

function refusal(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  throw error;
}

function requireSha(value, field) {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
    refusal('invalid_sha', `${field} must be a lowercase 40-character SHA`);
  }
  return value;
}

function parseRecoveryPrNumber(value) {
  const text = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  if (!/^[1-9][0-9]*$/.test(text)) {
    refusal('invalid_pr_number', 'client_payload.pr_number must be a positive integer');
  }
  const number = Number(text);
  if (!Number.isSafeInteger(number)) {
    refusal('invalid_pr_number', 'client_payload.pr_number is outside the safe integer range');
  }
  return number;
}

function validateDispatchContext(input) {
  if (input.eventName !== 'repository_dispatch' || input.action !== RECOVERY_EVENT) {
    refusal('untrusted_event', `expected repository_dispatch/${RECOVERY_EVENT}`);
  }
  if (input.repository !== (input.expectedRepository ?? EXPECTED_REPOSITORY)) {
    refusal('wrong_repository', `refusing repository ${String(input.repository)}`);
  }
  if (typeof input.defaultBranch !== 'string' || input.defaultBranch.length === 0) {
    refusal('missing_default_branch', 'repository default branch is unreadable');
  }
  if (input.ref !== `refs/heads/${input.defaultBranch}`) {
    refusal('untrusted_workflow_ref', `recovery must execute from refs/heads/${input.defaultBranch}`);
  }
  const executionSha = requireSha(input.executionSha, 'execution SHA');
  const defaultHeadSha = requireSha(input.defaultHeadSha, 'default-branch head SHA');
  if (executionSha !== defaultHeadSha) {
    refusal('stale_workflow_definition', 'execution SHA is not the current default-branch head');
  }
  return { executionSha, defaultHeadSha };
}

function validatePullTarget(input) {
  const pull = input.pull;
  if (!pull || typeof pull !== 'object') refusal('unreadable_pull', 'pull request payload is missing');
  if (pull.number !== input.requestedPrNumber) refusal('mismatched_pull', 'API PR number differs from the request');
  if (pull.state !== 'closed' || pull.merged !== true || !pull.merged_at) {
    refusal('unmerged_pull', `PR #${input.requestedPrNumber} is not merged`);
  }
  if (pull.base?.repo?.full_name !== input.repository || pull.base?.ref !== input.defaultBranch) {
    refusal('wrong_pull_base', 'PR is not merged into this repository default branch');
  }
  const mergeSha = requireSha(pull.merge_commit_sha, 'PR merge SHA');
  return { prNumber: pull.number, mergeSha };
}

function validateReachability(input) {
  const mergeSha = requireSha(input.mergeSha, 'PR merge SHA');
  const defaultHeadSha = requireSha(input.defaultHeadSha, 'default-branch head SHA');
  const comparison = input.comparison;
  if (!comparison || typeof comparison !== 'object') {
    refusal('unreadable_comparison', 'default-branch ancestry response is missing');
  }
  if (!['ahead', 'identical'].includes(comparison.status)) {
    refusal('merge_not_reachable', `merge SHA is not an ancestor of protected main (${String(comparison.status)})`);
  }
  if (comparison.merge_base_commit?.sha !== mergeSha) {
    refusal('merge_base_mismatch', 'GitHub comparison did not return the requested merge SHA as merge base');
  }
  if (comparison.base_commit?.sha && comparison.base_commit.sha !== mergeSha) {
    refusal('altered_target', 'comparison base differs from the PR merge SHA');
  }
  if (comparison.commits?.length === 0 && mergeSha !== defaultHeadSha && comparison.status !== 'ahead') {
    refusal('merge_not_reachable', 'comparison contains no path from merge SHA to protected main');
  }
  return { mergeSha, defaultHeadSha };
}

function newestNamedJob(jobs, name) {
  return jobs
    .filter((job) => job && job.name === name)
    .sort((left, right) => Number(right.id ?? 0) - Number(left.id ?? 0))[0] ?? null;
}

function terminalConclusion(value) {
  return ['failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'neutral', 'stale'].includes(value)
    ? value
    : 'failure';
}

function buildPublishedProofResults(input) {
  const targetSha = requireSha(input.targetSha, 'tested merge SHA');
  const executionSha = requireSha(input.executionSha, 'execution SHA');
  if (!Number.isSafeInteger(input.runId) || input.runId <= 0) refusal('invalid_run_id', 'workflow run ID is invalid');
  if (!Array.isArray(input.jobs)) refusal('unreadable_jobs', 'native workflow jobs are unreadable');

  return ['staging', 'verify'].map((key) => {
    const nativeName = NATIVE_JOB_NAMES[key];
    const context = REQUIRED_CONTEXTS[key];
    const job = newestNamedJob(input.jobs, nativeName);
    const declaredResult = input.declaredResults?.[key] ?? null;
    const testedSha = input.testedShas?.[key] ?? null;
    const identityMatches = job?.run_id === input.runId && job?.head_sha === executionSha;
    const nativeCompleted = job?.status === 'completed';
    const nativeSucceeded = nativeCompleted && job?.conclusion === 'success';
    const succeeded = identityMatches
      && nativeSucceeded
      && declaredResult === 'success'
      && testedSha === targetSha;

    let reason = 'native proof succeeded and is bound to the requested merge SHA';
    if (!job) reason = `native job ${nativeName} is missing`;
    else if (!identityMatches) reason = `${nativeName} belongs to the wrong workflow run or execution SHA`;
    else if (!nativeCompleted) reason = `${nativeName} is incomplete (${String(job.status)})`;
    else if (!nativeSucceeded) reason = `${nativeName} concluded ${String(job.conclusion)}`;
    else if (declaredResult !== 'success') reason = `${nativeName} dependency result is ${String(declaredResult)}`;
    else if (testedSha !== targetSha) reason = `${nativeName} tested ${String(testedSha)}, not ${targetSha}`;

    return {
      key,
      context,
      nativeJobName: nativeName,
      nativeJobId: job?.id ?? null,
      detailsUrl: job?.html_url ?? input.runUrl,
      conclusion: succeeded ? 'success' : terminalConclusion(job?.conclusion ?? declaredResult),
      succeeded,
      reason,
      targetSha,
      executionSha,
      testedSha,
      runId: input.runId,
    };
  });
}

module.exports = {
  EXPECTED_REPOSITORY,
  NATIVE_JOB_NAMES,
  RECOVERY_EVENT,
  REQUIRED_CONTEXTS,
  buildPublishedProofResults,
  parseRecoveryPrNumber,
  validateDispatchContext,
  validatePullTarget,
  validateReachability,
};
