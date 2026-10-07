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
const METADATA_PREFIXES = Object.freeze([
  '.ops/sync/',
  'docs/06_status/lanes/',
  'docs/06_status/proof/',
]);
const RECOVERY_WORKFLOW_PATH = '.github/workflows/merge-proof-recovery.yml';
const MAX_NATIVE_JOB_COUNT = 20;
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

function parsePositiveInteger(value, field) {
  const text = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  if (!/^[1-9][0-9]*$/.test(text) || !Number.isSafeInteger(Number(text))) {
    refusal('invalid_positive_integer', `${field} must be a positive safe integer`);
  }
  return Number(text);
}

function isRecoveryMetadataPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && METADATA_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function validateMetadataOnlyFiles(input) {
  const changedFileCount = input.changedFileCount;
  const files = input.files;
  if (!Number.isSafeInteger(changedFileCount) || changedFileCount <= 0) {
    refusal('invalid_changed_file_count', 'pull.changed_files must be a positive integer');
  }
  if (!Array.isArray(files) || files.length === 0) {
    refusal('unreadable_pull_files', 'pull file list is missing or empty');
  }
  if (files.length !== changedFileCount) {
    refusal('incomplete_pull_files', `received ${files.length} of ${changedFileCount} pull files`);
  }

  for (const file of files) {
    if (!file || typeof file !== 'object' || !isRecoveryMetadataPath(file.filename)) {
      refusal('non_metadata_change', `refusing changed path ${String(file?.filename)}`);
    }
    if (file.previous_filename !== undefined && !isRecoveryMetadataPath(file.previous_filename)) {
      refusal('non_metadata_rename_source', `refusing previous path ${String(file.previous_filename)}`);
    }
    if (file.status === 'renamed' && typeof file.previous_filename !== 'string') {
      refusal('missing_rename_source', `renamed path ${file.filename} has no previous_filename`);
    }
  }
  return { changedFileCount, files };
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
  if (pull.head?.repo?.full_name !== input.repository) {
    refusal('wrong_pull_head', 'PR head is not from this repository');
  }
  validateMetadataOnlyFiles({ changedFileCount: pull.changed_files, files: input.files });
  const mergeSha = requireSha(pull.merge_commit_sha, 'PR merge SHA');
  return { prNumber: pull.number, mergeSha, changedFileCount: pull.changed_files };
}

function validateWorkflowRun(input) {
  const run = input.run;
  if (!run || typeof run !== 'object') refusal('unreadable_workflow_run', 'workflow run payload is missing');
  const runId = parsePositiveInteger(input.runId, 'workflow run ID');
  const runAttempt = parsePositiveInteger(input.runAttempt, 'workflow run attempt');
  if (run.id !== runId || run.run_attempt !== runAttempt) {
    refusal('wrong_workflow_run', 'workflow run ID or attempt differs from the executing run');
  }
  if (run.event !== 'repository_dispatch' || run.path !== RECOVERY_WORKFLOW_PATH) {
    refusal('untrusted_workflow_run', 'workflow run event or path is not the trusted recovery workflow');
  }
  if (run.repository?.full_name !== input.repository || run.head_repository?.full_name !== input.repository) {
    refusal('wrong_workflow_repository', 'workflow run repository identity differs from the executing repository');
  }
  if (run.head_branch !== input.defaultBranch || run.head_sha !== requireSha(input.executionSha, 'execution SHA')) {
    refusal('wrong_workflow_head', 'workflow run branch or head SHA differs from the trusted execution source');
  }
  if (!['queued', 'in_progress'].includes(run.status)) {
    refusal('unexpected_workflow_state', `publisher observed workflow run status ${String(run.status)}`);
  }
  return { runId, runAttempt, executionSha: run.head_sha };
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

function buildPublishedProofResults(input) {
  const targetSha = requireSha(input.targetSha, 'tested merge SHA');
  const executionSha = requireSha(input.executionSha, 'execution SHA');
  const runId = parsePositiveInteger(input.runId, 'workflow run ID');
  const runAttempt = parsePositiveInteger(input.runAttempt, 'workflow run attempt');
  if (!Array.isArray(input.jobs)) refusal('unreadable_jobs', 'native workflow jobs are unreadable');
  const jobCountWithinLimit = input.jobs.length <= MAX_NATIVE_JOB_COUNT;

  return ['staging', 'verify'].map((key) => {
    const nativeName = NATIVE_JOB_NAMES[key];
    const context = REQUIRED_CONTEXTS[key];
    const job = newestNamedJob(input.jobs, nativeName);
    const declaredResult = input.declaredResults?.[key] ?? null;
    const testedSha = input.testedShas?.[key] ?? null;
    const identityMatches = job?.run_id === runId
      && job?.run_attempt === runAttempt
      && job?.head_sha === executionSha;
    const nativeCompleted = job?.status === 'completed';
    const nativeSucceeded = nativeCompleted && job?.conclusion === 'success';
    const succeeded = jobCountWithinLimit
      && identityMatches
      && nativeSucceeded
      && declaredResult === 'success'
      && testedSha === targetSha;

    let reason = 'native proof succeeded and is bound to the requested merge SHA';
    if (!jobCountWithinLimit) reason = `observed ${input.jobs.length} jobs, exceeding limit ${MAX_NATIVE_JOB_COUNT}`;
    else if (!job) reason = `native job ${nativeName} is missing`;
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
      conclusion: succeeded ? 'success' : 'failure',
      nativeConclusion: job?.conclusion ?? null,
      succeeded,
      reason,
      targetSha,
      executionSha,
      testedSha,
      runId,
      runAttempt,
      observedJobCount: input.jobs.length,
      jobLimit: MAX_NATIVE_JOB_COUNT,
    };
  });
}

module.exports = {
  EXPECTED_REPOSITORY,
  MAX_NATIVE_JOB_COUNT,
  METADATA_PREFIXES,
  NATIVE_JOB_NAMES,
  RECOVERY_WORKFLOW_PATH,
  RECOVERY_EVENT,
  REQUIRED_CONTEXTS,
  buildPublishedProofResults,
  parseRecoveryPrNumber,
  parsePositiveInteger,
  validateDispatchContext,
  validateMetadataOnlyFiles,
  validatePullTarget,
  validateReachability,
  validateWorkflowRun,
};
