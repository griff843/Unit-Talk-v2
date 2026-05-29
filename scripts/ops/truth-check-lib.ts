import fs from 'node:fs';
import path from 'node:path';
import { loadEnvironment } from '@unit-talk/config';
import {
  type CheckResult,
  type LaneManifest,
  type LaneTier,
  type TruthCheckHistoryEntry,
  type TruthCheckResult,
  EVIDENCE_BUNDLE_SCHEMA_PATH,
  MANIFEST_DIR,
  ROOT,
  git,
  issueToManifestPath,
  parseJsonFile,
  readManifest,
  relativeToRoot,
  validateManifest,
  validateTruthResultSchemaDependencies,
  writeManifest,
} from './shared.js';

interface RunTruthCheckOptions {
  issueId: string;
  json?: boolean;
  tierOverride?: LaneTier;
  sinceSha?: string;
  noRuntime?: boolean;
  explain?: boolean;
  runner?: 'ops:lane-close' | 'ops:reconcile' | 'manual';
}

interface LinearIssueRecord {
  id: string;
  identifier: string;
  title: string;
  state?: { name: string } | null;
  labels?: { nodes: Array<{ name: string }> } | null;
  attachments?: { nodes: Array<{ title?: string | null; url?: string | null }> } | null;
  project?: { id: string; name: string } | null;
}

const P0_PROJECT_ID = '46229dc4-c7c1-4ccb-af0d-dedaf8147a97';

export interface EvidenceBundleV1 {
  schema_version: number;
  merge_sha?: string;
  generated_at?: string;
  verifier?: {
    identity?: string;
  };
  static_proof?: {
    test_run_logs?: Array<{
      path?: string;
      merge_sha?: string;
    }>;
    [key: string]: unknown;
  };
  runtime_proof?: {
    queries?: unknown[];
    receipts?: unknown[];
    row_counts?: unknown[];
    [key: string]: unknown;
  };
}

export interface CommitCheckResult {
  passed: boolean;
  missing: string[];
  bypassed?: string[];
}

export interface CloseoutProofArtifact {
  path: string;
  content: string;
  mtime_ms?: number;
}

export interface CloseoutTruthGateInput {
  manifest: Pick<
    LaneManifest,
    | 'issue_id'
    | 'status'
    | 'commit_sha'
    | 'pr_url'
    | 'files_changed'
    | 'expected_proof_paths'
    | 'created_by'
  >;
  linear_state: string;
  pr_merged: boolean;
  pr_merge_sha: string | null;
  pr_head_sha?: string | null;
  proof_artifacts: CloseoutProofArtifact[];
  merge_timestamp_ms?: number | null;
  runtime_proof_required?: boolean;
  transition_age_ms?: number;
  allowed_transition_ms?: number;
}

export function evaluateCloseoutTruthGate(input: CloseoutTruthGateInput): CheckResult[] {
  const checks: CheckResult[] = [];
  const fail = (id: string, detail: string): void => checks.push({ id, status: 'fail', detail });
  const pass = (id: string, detail: string): void => checks.push({ id, status: 'pass', detail });

  const linearDone = /^done$/i.test(input.linear_state);
  const completedImplementation = input.manifest.files_changed.length > 0 ||
    input.manifest.expected_proof_paths.length > 0;
  const mergeSha = input.manifest.commit_sha?.trim() || null;
  const prMergeSha = input.pr_merge_sha?.trim() || null;
  const prHeadSha = input.pr_head_sha?.trim() || null;

  if (linearDone && !prMergeSha) {
    fail('C1', 'Linear Done is not allowed without a merged PR SHA');
  } else {
    pass('C1', 'Linear Done merge SHA requirement satisfied');
  }

  if (completedImplementation && !mergeSha) {
    fail('C2', 'completed implementation work requires manifest.commit_sha');
  } else {
    pass('C2', 'manifest.commit_sha requirement satisfied');
  }

  if (prMergeSha && mergeSha && prMergeSha !== mergeSha) {
    fail('C3', 'PR merge SHA does not match manifest.commit_sha');
  } else {
    pass('C3', 'PR merge SHA and manifest.commit_sha agree or are not both present');
  }

  const requiredProofSha = mergeSha ?? prMergeSha ?? prHeadSha;
  const proofWithoutSha = input.proof_artifacts.filter(
    (artifact) =>
      artifact.content.trim().length > 0 &&
      requiredProofSha &&
      !artifact.content.includes(requiredProofSha),
  );
  if (proofWithoutSha.length > 0) {
    fail('C4', `proof artifacts missing required SHA binding (${requiredProofSha}): ${proofWithoutSha.map((artifact) => artifact.path).join(', ')}`);
  } else {
    pass('C4', 'proof artifacts are SHA-bound or no SHA-bound proof is applicable');
  }

  if (input.merge_timestamp_ms !== null && input.merge_timestamp_ms !== undefined) {
    const staleProof = input.proof_artifacts.filter(
      (artifact) =>
        artifact.mtime_ms !== undefined &&
        artifact.mtime_ms < input.merge_timestamp_ms!,
    );
    if (staleProof.length > 0) {
      fail('C5', `proof artifacts predate merge SHA: ${staleProof.map((artifact) => artifact.path).join(', ')}`);
    } else {
      pass('C5', 'proof artifact mtimes do not predate merge timestamp');
    }
  } else {
    pass('C5', 'proof mtime freshness not applicable without merge timestamp');
  }

  if (input.runtime_proof_required) {
    const runtimeEvidence = input.proof_artifacts.some((artifact) => {
      const parsed = tryParseEvidenceBundle(artifact.content);
      return parsed
        ? hasRuntimeReferences(parsed.runtime_proof)
        : hasRuntimeProofTextEvidence(artifact.content);
    });
    if (!runtimeEvidence) {
      fail('C6', 'runtime-proof closeout requires live/runtime evidence, not narrative-only proof');
    } else {
      pass('C6', 'runtime-proof evidence is present');
    }
  } else {
    pass('C6', 'runtime-proof evidence not required for this closeout');
  }

  const allowedTransitionMs = input.allowed_transition_ms ?? 30 * 60 * 1000;
  const transitionAgeMs = input.transition_age_ms ?? 0;
  const manifestDone = input.manifest.status === 'done';
  if (manifestDone && !input.pr_merged) {
    fail('C7', 'manifest is Done but PR is not merged');
  } else if ((input.pr_merged || manifestDone) && !linearDone && transitionAgeMs > allowedTransitionMs) {
    fail('C7', 'PR is merged but Linear is not Done beyond the allowed transition window');
  } else if (linearDone && !input.pr_merged) {
    fail('C7', 'Linear is Done but PR is not merged');
  } else {
    pass('C7', 'Linear/PR state is within the allowed closeout transition semantics');
  }

  return checks;
}

export function evaluateT2ProofEvidence(input: {
  proofPaths: string[];
  proofContents: string;
}): CheckResult[] {
  const checks: CheckResult[] = [];
  const add = (id: string, status: 'pass' | 'fail', detail: string): void => {
    checks.push({ id, status, detail });
  };

  if (
    /diff summary/i.test(input.proofContents) ||
    input.proofPaths.some((proofPath) => /diff-summary/i.test(path.basename(proofPath)))
  ) {
    add('P11', 'pass', 'proof includes a diff summary file');
  } else {
    add('P11', 'fail', 'proof must include a diff summary file');
  }

  if (hasCommandMention(input.proofContents, 'pnpm type-check') && hasCommandMention(input.proofContents, 'pnpm test')) {
    add('P12', 'pass', 'verification log references pnpm type-check and pnpm test');
  } else {
    add('P12', 'fail', 'verification log must reference pnpm type-check and pnpm test');
  }

  if (hasCommandMention(input.proofContents, 'pnpm verify')) {
    add('P13', 'pass', 'verification log references pnpm verify');
  } else {
    add('P13', 'fail', 'verification log must reference pnpm verify');
  }

  if (hasRLevelCheckMention(input.proofContents)) {
    add('P14', 'pass', 'verification log references r-level-check');
  } else {
    add('P14', 'fail', 'verification log must reference scripts/ci/r-level-check.ts');
  }

  return checks;
}

function hasRuntimeProofTextEvidence(content: string): boolean {
  return content
    .split(/\r?\n/)
    .some((line) =>
      /runtime_proof|row_counts|receipts|queries/i.test(line) &&
      /[\d{[]/.test(line),
    );
}

function hasCommandMention(content: string, command: string): boolean {
  const escaped = command
    .split(/\s+/)
    .map(escapeRegExp)
    .join('\\s+');
  const commandPattern = new RegExp(`\\b${escaped}\\b`, 'i');

  return content
    .split(/\r?\n/)
    .some((line) =>
      commandPattern.test(line) &&
      !/\bpnpm\s+verify:commands\b/i.test(line),
    );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasRLevelCheckMention(content: string): boolean {
  return content
    .split(/\r?\n/)
    .some((line) =>
      /\bscripts\/ci\/r-level-check\.ts\b/i.test(line) ||
      /\br-level-check(?:\.ts)?\b/i.test(line),
    );
}

type Verdict = TruthCheckResult['verdict'];

export async function runTruthCheck(
  options: RunTruthCheckOptions,
): Promise<TruthCheckResult> {
  validateTruthResultSchemaDependencies();
  const env = loadEnvironment();
  const issueId = options.issueId.toUpperCase();
  const checkedAt = new Date().toISOString();
  const manifestPath = issueToManifestPath(issueId);
  const checks: CheckResult[] = [];
  const failures = new Set<string>();
  const reopenReasons = new Set<string>();
  const explain = options.explain ?? false;
  let manifest: LaneManifest | null = null;
  let tier: LaneTier = options.tierOverride ?? 'T3';
  let mergeSha: string | null = null;
  let prUrl: string | null = null;
  let mergeTimestamp: string | null = null;

  const addCheck = (id: string, status: 'pass' | 'fail' | 'skip', detail: string): void => {
    checks.push({ id, status, detail });
    if (status === 'fail') {
      failures.add(id);
      if (id === 'G5') {
        reopenReasons.add(detail);
      }
    }
    if (explain) {
      process.stderr.write(`[${status.toUpperCase()}] ${id} ${detail}\n`);
    }
  };

  try {
    if (!fs.existsSync(manifestPath)) {
      addCheck('M1', 'fail', `manifest missing at ${relativeToRoot(manifestPath)}`);
      return finalizeResult({
        issueId,
        tier,
        verdict: 'infra_error',
        exitCode: 3,
        mergeSha,
        prUrl,
        checkedAt,
        checks,
        failures,
        reopenReasons,
      });
    }
    addCheck('M1', 'pass', `manifest found at ${relativeToRoot(manifestPath)}`);

    manifest = readManifest(issueId);
    const manifestValidation = validateManifest(manifest, manifestPath);
    if (manifestValidation.length > 0) {
      addCheck('M2', 'fail', manifestValidation.join('; '));
      return finalizeResult({
        issueId,
        tier,
        verdict: 'infra_error',
        exitCode: 3,
        mergeSha,
        prUrl,
        checkedAt,
        checks,
        failures,
        reopenReasons,
      });
    }
    addCheck('M2', 'pass', 'manifest schema validated');

    if (manifest.issue_id !== issueId) {
      addCheck('M3', 'fail', 'manifest.issue_id does not match requested issue');
      return finalizeResult({
        issueId,
        tier,
        verdict: 'infra_error',
        exitCode: 3,
        mergeSha,
        prUrl,
        checkedAt,
        checks,
        failures,
        reopenReasons,
      });
    }
    addCheck('M3', 'pass', 'manifest.issue_id matches CLI argument');

    tier = options.tierOverride ?? manifest.tier;
    if (manifest.status !== 'merged' && manifest.status !== 'done') {
      addCheck('M4', 'fail', `manifest status ${manifest.status} is not eligible for truth-check`);
      return finalizeResult({
        issueId,
        tier,
        verdict: 'ineligible',
        exitCode: 2,
        mergeSha: manifest.commit_sha,
        prUrl: manifest.pr_url,
        checkedAt,
        checks,
        failures,
        reopenReasons,
      });
    }
    addCheck('M4', 'pass', `manifest status ${manifest.status} is eligible`);

    prUrl = manifest.pr_url;
    if (!prUrl) {
      addCheck('M5', 'fail', 'manifest.pr_url is missing');
    } else {
      try {
        new URL(prUrl);
        addCheck('M5', 'pass', 'manifest.pr_url is parseable');
      } catch {
        addCheck('M5', 'fail', 'manifest.pr_url is not parseable');
      }
    }

    mergeSha = manifest.commit_sha;
    if (!mergeSha) {
      addCheck('M6', 'fail', 'manifest.commit_sha is missing');
    } else {
      addCheck('M6', 'pass', 'manifest.commit_sha is set');
    }

    if ((tier === 'T1' || tier === 'T2') && manifest.expected_proof_paths.length === 0) {
      addCheck('M7', 'fail', 'expected_proof_paths must be non-empty for T1/T2');
    } else {
      addCheck('M7', 'pass', 'expected_proof_paths satisfies tier requirement');
    }

    const linearToken = env.LINEAR_API_TOKEN?.trim() || process.env.LINEAR_API_KEY?.trim();
    if (!linearToken) {
      addCheck('L1', 'fail', 'LINEAR_API_TOKEN or LINEAR_API_KEY is required');
      return finalizeWithManifest({
        manifest,
        issueId,
        tier,
        checkedAt,
        checks,
        failures,
        reopenReasons,
        mergeSha,
        prUrl,
        verdict: 'infra_error',
        exitCode: 3,
        runner: options.runner ?? 'manual',
      });
    }

    const linearIssue = await fetchLinearIssue(issueId, linearToken);
    addCheck('L1', 'pass', `Linear issue ${linearIssue.identifier} exists`);
    const linearLabels = (linearIssue.labels?.nodes ?? [])
      .map((label) => label.name.toLowerCase());
    const tierLabels = linearLabels
      .map((label) => label.replace(/^tier:/, ''))
      .filter((label) => label === 't1' || label === 't2' || label === 't3');
    const uniqueTierLabels = [...new Set(tierLabels)];
    if (uniqueTierLabels.length !== 1) {
      addCheck('L2', 'fail', `expected exactly one tier label, found ${uniqueTierLabels.length}`);
    } else {
      if (!options.tierOverride) {
        tier = uniqueTierLabels[0].toUpperCase() as LaneTier;
      }
      addCheck('L2', 'pass', `Linear tier label is ${uniqueTierLabels[0]}`);
    }

    const stateName = linearIssue.state?.name ?? '';
    if (stateName !== 'In Review' && stateName !== 'Done') {
      addCheck('L3', 'fail', `Linear state ${stateName || 'Unknown'} is not In Review or Done`);
    } else {
      addCheck('L3', 'pass', `Linear state ${stateName} is permitted`);
    }

    const attachmentUrls = (linearIssue.attachments?.nodes ?? [])
      .map((attachment) => attachment.url?.trim())
      .filter((entry): entry is string => Boolean(entry));
    if (!prUrl || !attachmentUrls.includes(prUrl)) {
      addCheck('L4', 'fail', 'Linear attachments do not include manifest.pr_url');
    } else {
      addCheck('L4', 'pass', 'Linear attachments include manifest.pr_url');
    }

    const githubToken = process.env.GITHUB_TOKEN?.trim();
    if (!githubToken) {
      addCheck('G1', 'fail', 'GITHUB_TOKEN is required');
      return finalizeWithManifest({
        manifest,
        issueId,
        tier,
        checkedAt,
        checks,
        failures,
        reopenReasons,
        mergeSha,
        prUrl,
        verdict: 'infra_error',
        exitCode: 3,
        runner: options.runner ?? 'manual',
      });
    }
    if (!prUrl) {
      return finalizeWithManifest({
        manifest,
        issueId,
        tier,
        checkedAt,
        checks,
        failures,
        reopenReasons,
        mergeSha,
        prUrl,
        verdict: 'fail',
        exitCode: 1,
        runner: options.runner ?? 'manual',
      });
    }

    const prRef = parsePullRequestUrl(prUrl);
    const pullRequest = await fetchGitHubPullRequest(prRef.owner, prRef.repo, prRef.number, githubToken);
    if (!pullRequest.merged || !pullRequest.merge_commit_sha) {
      addCheck('G1', 'fail', 'pull request is not merged');
    } else {
      addCheck('G1', 'pass', 'pull request is merged');
    }

    if (!mergeSha || pullRequest.merge_commit_sha !== mergeSha) {
      addCheck('G2', 'fail', 'PR merge commit SHA does not match manifest.commit_sha');
    } else {
      addCheck('G2', 'pass', 'PR merge commit SHA matches manifest.commit_sha');
    }

    if (mergeSha) {
      const g3 = checkCommitReachableFromMain(mergeSha);
      if (g3.reachable && !g3.firstParent) {
        // SHA is reachable via a secondary-parent chain (e.g. squash merge that landed
        // on a --no-ff merge commit). This is valid — emit a warning but do not fail.
        addCheck('G3', 'pass', 'merge commit is reachable from main (via secondary-parent chain; squash-merge anomaly)');
      } else if (g3.reachable) {
        addCheck('G3', 'pass', 'merge commit is reachable on main first-parent history');
      } else {
        addCheck('G3', 'fail', 'merge commit is not reachable from main via any ancestor path');
      }
    } else {
      addCheck('G3', 'fail', 'merge commit is not reachable from main via any ancestor path');
    }

    const requiredChecks = await fetchRequiredChecks(prRef.owner, prRef.repo, githubToken);
    const requiredCheckResult = await evaluateRequiredChecksWithHeadFallback({
      mergeSha,
      headSha: pullRequest.head?.sha,
      requiredChecks,
      allowAdminMergeGateBypass: Boolean(
        pullRequest.merged &&
        mergeSha &&
        pullRequest.merge_commit_sha === mergeSha,
      ),
      fetchChecks: (sha) => fetchCommitChecks(prRef.owner, prRef.repo, sha, githubToken),
    });
    if (requiredCheckResult.passed) {
      const detail = requiredCheckResult.checkedSha === 'head-admin-merge'
        ? `admin-merged PR accepted: non-governance required checks are green on PR head SHA; bypassed stuck checks: ${(requiredCheckResult.bypassed ?? []).join(', ')}`
        : requiredCheckResult.checkedSha === 'head'
          ? 'required GitHub checks are green on PR head SHA'
          : 'required GitHub checks are green on merge SHA';
      addCheck(
        'G4',
        'pass',
        detail,
      );
    } else {
      addCheck('G4', 'fail', `required checks missing or failing: ${requiredCheckResult.missing.join(', ')}`);
    }

    if (tier === 'T1') {
      const labels = (pullRequest.labels ?? []).map((label: { name?: string }) => label.name?.toLowerCase());
      if (labels.includes('t1-approved')) {
        addCheck('L5', 'pass', 'PR carries t1-approved label');
      } else {
        addCheck('L5', 'fail', 'PR is missing t1-approved label');
      }
    } else {
      addCheck('L5', 'skip', 'L5 skipped for non-T1 tier');
    }

    const mergeCommit = mergeSha
      ? gitShowCommit(mergeSha)
      : null;
    mergeTimestamp = mergeCommit?.timestamp ?? null;
    const proofFiles = manifest.expected_proof_paths.map((proofPath) => path.join(ROOT, proofPath));

    const missingProofs = proofFiles.filter((proofPath) => !fs.existsSync(proofPath));
    if (missingProofs.length > 0) {
      addCheck('P1', 'fail', `missing proof files: ${missingProofs.map(relativeToRoot).join(', ')}`);
    } else {
      addCheck('P1', 'pass', 'all expected proof files exist');
    }

    const readableProofs = proofFiles.filter((proofPath) => {
      try {
        return fs.readFileSync(proofPath, 'utf8').trim().length > 0;
      } catch {
        return false;
      }
    });
    if (readableProofs.length !== proofFiles.length) {
      addCheck('P2', 'fail', 'one or more proof files are unreadable or empty');
    } else {
      addCheck('P2', 'pass', 'proof files are readable and non-empty');
    }

    if (mergeSha) {
      const staleShaProofs = proofFiles.filter((proofPath) => {
        try {
          const content = fs.readFileSync(proofPath, 'utf8');
          return !content.includes(mergeSha) && !new RegExp(`merge_sha:\\s*${mergeSha}`, 'i').test(content);
        } catch {
          return true;
        }
      });
      if (staleShaProofs.length > 0) {
        addCheck('P3', 'fail', `proof files missing merge SHA reference: ${staleShaProofs.map(relativeToRoot).join(', ')}`);
      } else {
        addCheck('P3', 'pass', 'proof files reference the merge SHA');
      }
    } else {
      addCheck('P3', 'fail', 'cannot evaluate proof SHA without manifest.commit_sha');
    }

    if (mergeTimestamp) {
      const staleMtimeProofs = proofFiles.filter((proofPath) => {
        try {
          return fs.statSync(proofPath).mtime.getTime() < new Date(mergeTimestamp).getTime();
        } catch {
          return true;
        }
      });
      if (staleMtimeProofs.length > 0) {
        addCheck('P4', 'fail', `proof files predate merge commit: ${staleMtimeProofs.map(relativeToRoot).join(', ')}`);
      } else {
        addCheck('P4', 'pass', 'proof files are newer than the merge commit');
      }
    } else {
      addCheck('P4', 'fail', 'cannot evaluate proof freshness without merge commit timestamp');
    }

    const closeoutGateChecks = evaluateCloseoutTruthGate({
      manifest,
      linear_state: stateName,
      pr_merged: pullRequest.merged,
      pr_merge_sha: pullRequest.merge_commit_sha,
      pr_head_sha: pullRequest.head?.sha,
      proof_artifacts: proofFiles.map((proofPath) => ({
        path: relativeToRoot(proofPath),
        content: safeRead(proofPath),
        mtime_ms: fs.existsSync(proofPath) ? fs.statSync(proofPath).mtime.getTime() : undefined,
      })),
      merge_timestamp_ms: mergeTimestamp ? Date.parse(mergeTimestamp) : null,
      runtime_proof_required: tier === 'T1' ||
        linearLabels.includes('runtime-truth') ||
        linearLabels.includes('kind:runtime'),
      transition_age_ms: 0,
    });
    for (const check of closeoutGateChecks) {
      addCheck(check.id, check.status === 'fail' ? 'fail' : 'pass', check.detail);
    }

    if (tier === 'T1') {
      let evidence: { path: string; bundle: EvidenceBundleV1 } | null = null;
      if (!fs.existsSync(EVIDENCE_BUNDLE_SCHEMA_PATH)) {
        addCheck('P5', 'fail', `missing evidence bundle schema at ${relativeToRoot(EVIDENCE_BUNDLE_SCHEMA_PATH)}`);
      } else {
        evidence = readFirstEvidenceBundle(proofFiles);
        if (!evidence) {
          addCheck('P5', 'fail', 'no expected proof path resolved to a readable evidence bundle');
        } else {
          addCheck('P5', 'pass', 'evidence bundle found');
          if (evidence.bundle.schema_version === 1) {
            addCheck('P6', 'pass', 'evidence bundle schema_version is 1');
          } else {
            addCheck('P6', 'fail', 'evidence bundle schema_version must be 1');
          }

          if (hasPopulatedObject(evidence.bundle.static_proof) && hasPopulatedObject(evidence.bundle.runtime_proof)) {
            addCheck('P7', 'pass', 'evidence bundle includes static_proof and runtime_proof');
          } else {
            addCheck('P7', 'fail', 'evidence bundle must include populated static_proof and runtime_proof sections');
          }

          const testRunLogStatus = evaluateTestRunLogEvidence(evidence.bundle.static_proof, mergeSha);
          if (testRunLogStatus === 'pass') {
            addCheck('P8', 'pass', 'static_proof references test run logs tied to merge SHA');
          } else if (testRunLogStatus === 'skip') {
            addCheck('P8', 'skip', 'static_proof.test_run_logs absent; P8 skipped for flexible proof format');
          } else {
            addCheck('P8', 'fail', 'static_proof must reference test run logs tied to merge SHA');
          }

          if (hasRuntimeReferences(evidence.bundle.runtime_proof)) {
            addCheck('P9', 'pass', 'runtime_proof references live DB evidence');
          } else {
            addCheck('P9', 'fail', 'runtime_proof must reference live DB queries, row counts, or receipts');
          }

          const verifierIdentity = evidence.bundle.verifier?.identity?.trim();
          if (verifierIdentity && verifierIdentity !== manifest.created_by) {
            addCheck('P10', 'pass', 'verifier.identity is set and distinct from implementing lane identity');
          } else {
            addCheck('P10', 'fail', 'verifier.identity must be set and not equal to manifest.created_by');
          }
        }
      }

      addUnsupportedRuntimeChecks(addCheck, options.noRuntime ?? false, tier, evidence);
    } else if (tier === 'T2') {
      const proofContents = proofFiles.map((proofPath) => safeRead(proofPath)).join('\n');
      for (const check of evaluateT2ProofEvidence({
        proofPaths: proofFiles.map(relativeToRoot),
        proofContents,
      })) {
        addCheck(check.id, check.status === 'fail' ? 'fail' : 'pass', check.detail);
      }
    }

    if (manifest.files_changed.length > 0 && manifest.file_scope_lock.length > 0) {
      const allowedPaths = new Set([
        ...manifest.file_scope_lock,
        ...manifest.expected_proof_paths,
      ]);
      const outOfScope = manifest.files_changed.filter(
        (f) =>
          !allowedPaths.has(f) &&
          !f.includes('deleted-file') &&
          !f.startsWith('docs/06_status/proof/'),
      );
      if (outOfScope.length > 0) {
        addCheck('S1', 'fail', `files_changed outside file_scope_lock: ${outOfScope.join(', ')}`);
      } else {
        addCheck('S1', 'pass', 'all files_changed are within file_scope_lock or proof paths');
      }
    } else {
      addCheck('S1', 'pass', 'scope-diff check not applicable (empty files_changed or scope)');
    }

    const finalizedFilesForPostMergeTouchCheck = manifest.files_changed.filter(
      (filePath) =>
        filePath !== relativeToRoot(manifestPath) &&
        !filePath.startsWith('docs/06_status/proof/'),
    );

    if (mergeSha && finalizedFilesForPostMergeTouchCheck.length > 0) {
      const postMergeTouches = findPostMergeTouches({
        mergeSha,
        filesChanged: finalizedFilesForPostMergeTouchCheck,
        issueId,
        sinceSha: options.sinceSha,
        laneStartedAt: manifest.started_at,
        allowSameIssueCommits: manifest.status !== 'done',
      });
      if (postMergeTouches.length > 0) {
        addCheck(
          'G5',
          'fail',
          `commits touched locked files after merge without linked follow-up issue: ${postMergeTouches.join(', ')}`,
        );
      } else {
        addCheck('G5', 'pass', 'no post-merge touches without linked follow-up issue detected');
      }
    } else {
      addCheck('G5', 'pass', 'no finalized implementation files_changed entries to inspect');
    }

    const linearProjectIsP0 = linearIssue.project?.id === P0_PROJECT_ID;
    const manifestP0 = manifest.p0_protocol;
    const manifestSaysP0 = manifestP0?.required === true;

    if (!linearProjectIsP0 && !manifestSaysP0) {
      addCheck('H1', 'skip', 'lane is not P0 — protocol checks not applicable');
      addCheck('H2', 'skip', 'lane is not P0 — protocol checks not applicable');
      addCheck('H3', 'skip', 'lane is not P0 — protocol checks not applicable');
      addCheck('H4', 'skip', 'lane is not P0 — protocol checks not applicable');
      addCheck('H5', 'skip', 'lane is not P0 — protocol checks not applicable');
    } else {
      if (linearProjectIsP0 && !manifestSaysP0) {
        addCheck(
          'H1',
          'fail',
          `Linear places ${issueId} in P0 project but manifest.p0_protocol.required is not true`,
        );
      } else if (!linearProjectIsP0 && manifestSaysP0) {
        addCheck(
          'H1',
          'fail',
          `manifest declares P0 but Linear project (${linearIssue.project?.name ?? 'none'}) is not the P0 project`,
        );
      } else {
        addCheck('H1', 'pass', 'P0 detection is consistent between Linear and manifest');
      }

      const critique = manifestP0?.claude_critique;
      if (!critique?.recorded || !critique.artifact_path) {
        addCheck('H2', 'fail', 'p0_protocol.claude_critique not recorded or missing artifact_path');
      } else {
        const critiquePath = path.join(ROOT, critique.artifact_path);
        if (!fs.existsSync(critiquePath)) {
          addCheck('H2', 'fail', `claude-critique artifact missing: ${critique.artifact_path}`);
        } else {
          const body = safeRead(critiquePath).trim();
          if (body.length === 0) {
            addCheck('H2', 'fail', `claude-critique artifact is empty: ${critique.artifact_path}`);
          } else if (mergeSha && !body.includes(mergeSha)) {
            addCheck('H2', 'fail', `claude-critique artifact missing merge SHA reference: ${critique.artifact_path}`);
          } else {
            addCheck('H2', 'pass', `claude-critique recorded at ${critique.artifact_path}`);
          }
        }
      }

      const verification = manifestP0?.runtime_verification;
      if (!verification?.recorded || !verification.artifact_path) {
        addCheck('H3', 'fail', 'p0_protocol.runtime_verification not recorded or missing artifact_path');
      } else {
        const verifyPath = path.join(ROOT, verification.artifact_path);
        if (!fs.existsSync(verifyPath)) {
          addCheck('H3', 'fail', `runtime-verification artifact missing: ${verification.artifact_path}`);
        } else {
          const body = safeRead(verifyPath);
          if (body.trim().length === 0) {
            addCheck('H3', 'fail', `runtime-verification artifact is empty: ${verification.artifact_path}`);
          } else if (RUNTIME_VERIFY_FAIL_PATTERN.test(body)) {
            addCheck('H3', 'fail', `runtime-verification contains a FAIL/SKIP item: ${verification.artifact_path}`);
          } else {
            const resultLine = body.match(RUNTIME_VERIFY_RESULT_PATTERN);
            if (!resultLine || resultLine[1].toLowerCase() !== 'pass') {
              addCheck(
                'H3',
                'fail',
                `runtime-verification missing 'result: pass' line: ${verification.artifact_path}`,
              );
            } else if (verification.result !== 'pass') {
              addCheck('H3', 'fail', 'p0_protocol.runtime_verification.result is not "pass"');
            } else {
              addCheck('H3', 'pass', `runtime-verification recorded with result: pass at ${verification.artifact_path}`);
            }
          }
        }
      }

      if (prUrl && githubToken) {
        try {
          const prRefForH4 = parsePullRequestUrl(prUrl);
          const comments = await fetchGitHubPullRequestComments(
            prRefForH4.owner,
            prRefForH4.repo,
            prRefForH4.number,
            githubToken,
          );
          const latest = findLatestPmVerdict(comments, issueId);
          if (!latest) {
            addCheck(
              'H4',
              'fail',
              'no pm-verdict/v1 APPROVED comment from a CODEOWNERS member found on the PR',
            );
          } else if (latest.verdict !== 'APPROVED') {
            addCheck('H4', 'fail', `latest PM verdict is ${latest.verdict}, not APPROVED`);
          } else {
            addCheck(
              'H4',
              'pass',
              `PM verdict APPROVED recorded by ${latest.comment.user?.login ?? 'unknown'}`,
            );
          }
        } catch (error) {
          addCheck(
            'H4',
            'fail',
            `failed to verify PM approval: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } else if (!prUrl) {
        addCheck('H4', 'fail', 'cannot verify PM approval without pr_url');
      } else {
        addCheck('H4', 'fail', 'cannot verify PM approval without GITHUB_TOKEN');
      }

      const mergeType = manifestP0?.merge_type;
      if (mergeType === 'auto') {
        addCheck('H5', 'fail', 'p0_protocol.merge_type is "auto" — P0 lanes must be merged manually');
      } else if (mergeType === 'manual') {
        addCheck('H5', 'pass', 'p0_protocol.merge_type is manual');
      } else {
        addCheck('H5', 'fail', 'p0_protocol.merge_type is not set');
      }
    }

    const exitCode = determineExitCode(checks, manifest.status);
    const verdict = determineVerdict(exitCode);
    return finalizeWithManifest({
      manifest,
      issueId,
      tier,
      checkedAt,
      checks,
      failures,
      reopenReasons,
      mergeSha,
      prUrl,
      verdict,
      exitCode,
      runner: options.runner ?? 'manual',
    });
  } catch (error) {
    addCheck('INFRA', 'fail', error instanceof Error ? error.message : String(error));
    return finalizeWithManifest({
      manifest,
      issueId,
      tier,
      checkedAt,
      checks,
      failures,
      reopenReasons,
      mergeSha,
      prUrl,
      verdict: 'infra_error',
      exitCode: 3,
      runner: options.runner ?? 'manual',
    });
  }
}

export function addUnsupportedRuntimeChecks(
  addCheck: (id: string, status: 'pass' | 'fail' | 'skip', detail: string) => void,
  noRuntime: boolean,
  tier: LaneTier,
  evidence: { bundle: EvidenceBundleV1 } | null,
): void {
  if (tier !== 'T1') {
    addCheck('R1', 'skip', 'runtime checks skipped for non-T1 tier');
    addCheck('R2', 'skip', 'runtime checks skipped for non-T1 tier');
    addCheck('R3', 'skip', 'runtime checks skipped for non-T1 tier');
    return;
  }

  if (noRuntime) {
    addCheck('R1', 'fail', '--no-runtime is rejected for T1');
    addCheck('R2', 'fail', '--no-runtime is rejected for T1');
    addCheck('R3', 'fail', '--no-runtime is rejected for T1');
    return;
  }

  if (!evidence) {
    addCheck('R1', 'fail', 'evidence bundle required for R1 runtime query check');
    addCheck('R2', 'fail', 'evidence bundle required for R2 monitored-table check');
    addCheck('R3', 'fail', 'evidence bundle required for R3 verifier-identity check');
    return;
  }

  const rp = evidence.bundle.runtime_proof;
  const queries = Array.isArray(rp?.queries) ? rp.queries : [];
  if (queries.length > 0) {
    addCheck('R1', 'pass', `runtime_proof.queries has ${queries.length} entr${queries.length === 1 ? 'y' : 'ies'}`);
  } else {
    addCheck('R1', 'fail', 'runtime_proof.queries must be non-empty: run pnpm test:db and include live query evidence');
  }

  const rowCounts = Array.isArray(rp?.row_counts) ? rp.row_counts : [];
  if (rowCounts.length > 0) {
    addCheck('R2', 'pass', `runtime_proof.row_counts has ${rowCounts.length} entr${rowCounts.length === 1 ? 'y' : 'ies'}`);
  } else {
    addCheck('R2', 'fail', 'runtime_proof.row_counts must be non-empty: include monitored-table row counts from pnpm test:db');
  }

  const verifierIdentity = evidence.bundle.verifier?.identity?.trim();
  if (verifierIdentity) {
    addCheck('R3', 'pass', `verifier.identity confirmed: ${verifierIdentity}`);
  } else {
    addCheck('R3', 'fail', 'evidence bundle verifier.identity must be set for T1 phase-boundary-guard');
  }
}

function determineExitCode(
  checks: CheckResult[],
  manifestStatus: LaneManifest['status'],
): 0 | 1 | 2 | 3 | 4 {
  if (checks.some((check) => check.id === 'M4' && check.status === 'fail')) {
    return 2;
  }
  if (checks.some((check) => check.id === 'G5' && check.status === 'fail' && manifestStatus === 'done')) {
    return 4;
  }
  if (
    checks.some(
      (check) =>
        check.status === 'fail' &&
        (
          check.id === 'M1' ||
          check.id === 'M2' ||
          check.id === 'M3' ||
          check.id === 'L1' ||
          /is required|missing required schema/i.test(check.detail)
        ),
    )
  ) {
    return 3;
  }

  if (checks.some((check) => check.id === 'G5' && check.status === 'fail')) {
    return 4;
  }
  if (checks.some((check) => check.status === 'fail')) {
    return 1;
  }

  return 0;
}

function determineVerdict(exitCode: 0 | 1 | 2 | 3 | 4): Verdict {
  switch (exitCode) {
    case 0:
      return 'pass';
    case 1:
      return 'fail';
    case 2:
      return 'ineligible';
    case 3:
      return 'infra_error';
    case 4:
      return 'reopen';
  }
}

function finalizeResult(input: {
  issueId: string;
  tier: LaneTier;
  verdict: Verdict;
  exitCode: 0 | 1 | 2 | 3 | 4;
  mergeSha: string | null;
  prUrl: string | null;
  checkedAt: string;
  checks: CheckResult[];
  failures: Set<string>;
  reopenReasons: Set<string>;
}): TruthCheckResult {
  return {
    schema_version: 1,
    issue_id: input.issueId,
    tier: input.tier,
    verdict: input.verdict,
    exit_code: input.exitCode,
    merge_sha: input.mergeSha,
    pr_url: input.prUrl,
    checked_at: input.checkedAt,
    checks: input.checks,
    failures: [...input.failures],
    reopen_reasons: [...input.reopenReasons],
    manifest_path: relativeToRoot(path.join(MANIFEST_DIR, `${input.issueId}.json`)),
  };
}

function finalizeWithManifest(input: {
  manifest: LaneManifest | null;
  issueId: string;
  tier: LaneTier;
  checkedAt: string;
  checks: CheckResult[];
  failures: Set<string>;
  reopenReasons: Set<string>;
  mergeSha: string | null;
  prUrl: string | null;
  verdict: Verdict;
  exitCode: 0 | 1 | 2 | 3 | 4;
  runner: TruthCheckHistoryEntry['runner'];
}): TruthCheckResult {
  const result = finalizeResult({
    issueId: input.issueId,
    tier: input.tier,
    verdict: input.verdict,
    exitCode: input.exitCode,
    mergeSha: input.mergeSha,
    prUrl: input.prUrl,
    checkedAt: input.checkedAt,
    checks: input.checks,
    failures: input.failures,
    reopenReasons: input.reopenReasons,
  });

  if (!input.manifest || input.exitCode === 2 || input.exitCode === 3) {
    return result;
  }

  const historyEntry: TruthCheckHistoryEntry = {
    checked_at: input.checkedAt,
    verdict: input.verdict === 'pass' ? 'pass' : input.verdict === 'reopen' ? 'reopen' : 'fail',
    merge_sha: input.mergeSha,
    failures: [...input.failures],
    runner: input.runner,
  };

  const updated: LaneManifest = {
    ...input.manifest,
    heartbeat_at: input.checkedAt,
    truth_check_history: [...input.manifest.truth_check_history, historyEntry],
  };

  if (input.exitCode === 4) {
    updated.status = 'reopened';
    updated.closed_at = null;
    updated.reopen_history = [
      ...input.manifest.reopen_history,
      {
        timestamp: input.checkedAt,
        reasons: [...input.reopenReasons],
        detected_by: input.runner,
      },
    ];
  }

  writeManifest(updated);
  return result;
}

async function fetchLinearIssue(issueId: string, token: string): Promise<LinearIssueRecord> {
  const payload = await fetchJson<{
    data?: { issue: LinearIssueRecord | null };
    errors?: Array<{ message?: string }>;
  }>('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `
        query IssueForTruthCheck($id: String!) {
          issue(id: $id) {
            id
            identifier
            title
            state { name }
            labels(first: 20) { nodes { name } }
            attachments(first: 20) { nodes { title url } }
            project { id name }
          }
        }
      `,
      variables: { id: issueId },
    }),
  });

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((entry) => entry.message ?? 'Unknown Linear error').join('; '));
  }
  if (!payload.data?.issue) {
    throw new Error(`Linear issue not found: ${issueId}`);
  }

  return payload.data.issue;
}

function parsePullRequestUrl(prUrl: string): { owner: string; repo: string; number: number } {
  const url = new URL(prUrl);
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)$/);
  if (!match) {
    throw new Error(`Unsupported PR URL: ${prUrl}`);
  }

  return {
    owner: match[1],
    repo: match[2],
    number: Number.parseInt(match[3], 10),
  };
}

async function fetchGitHubPullRequest(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<{
  merged: boolean;
  merge_commit_sha: string | null;
  head?: { sha?: string | null } | null;
  labels: Array<{ name?: string }>;
  user?: { login?: string; type?: string } | null;
  auto_merge?: { merge_method?: string } | null;
}> {
  return fetchJson(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, {
    headers: githubHeaders(token),
  });
}

interface GitHubIssueComment {
  body?: string;
  user?: { login?: string; type?: string } | null;
  html_url?: string;
  created_at?: string;
}

async function fetchGitHubPullRequestComments(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<GitHubIssueComment[]> {
  return fetchJson<GitHubIssueComment[]>(
    `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`,
    { headers: githubHeaders(token) },
  );
}

const PM_VERDICT_CODEOWNERS = new Set(['griff843']);

interface PmVerdictMatch {
  verdict: 'APPROVED' | 'CHANGES_REQUIRED';
  issueId: string;
  comment: GitHubIssueComment;
}

function findLatestPmVerdict(
  comments: GitHubIssueComment[],
  issueId: string,
): PmVerdictMatch | null {
  const matches: PmVerdictMatch[] = [];
  for (const comment of comments) {
    const body = comment.body?.replace(/\\n/g, '\n');
    if (!body) continue;
    const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 3) continue;
    const verdict = lines[0].replace(/^\$/, '').match(
      /^PM_VERDICT:\s+(APPROVED|CHANGES_REQUIRED)$/i,
    );
    if (!verdict) continue;
    if (lines[1] !== 'schema: pm-verdict/v1') continue;
    const issueMatch = lines[2].match(/^Issue:\s+((?:UTV2|UNI)-\d+)$/i);
    if (!issueMatch) continue;
    if (issueMatch[1].toUpperCase() !== issueId.toUpperCase()) continue;
    if (comment.user?.type === 'Bot') continue;
    if (!comment.user?.login || !PM_VERDICT_CODEOWNERS.has(comment.user.login)) continue;
    matches.push({
      verdict: verdict[1].toUpperCase() as 'APPROVED' | 'CHANGES_REQUIRED',
      issueId: issueMatch[1].toUpperCase(),
      comment,
    });
  }
  if (matches.length === 0) return null;
  return matches[matches.length - 1];
}

const RUNTIME_VERIFY_FAIL_PATTERN = /^\s*-\s*\[[ xX]\]\s+.*:\s*(FAIL|SKIP|SKIPPED)\s*$/m;
const RUNTIME_VERIFY_RESULT_PATTERN = /^result:\s*(pass|fail)\s*$/im;
const BRANCH_PROTECTION_SCRIPT_PATH = path.join(ROOT, 'scripts', 'ops', 'apply-branch-protection.sh');

export function parseRequiredChecksFromBranchProtectionScript(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/contexts\[\]=([^'"\r\n]+)/g)]
        .map((match) => match[1]?.trim())
        .filter((entry): entry is string => Boolean(entry)),
    ),
  ];
}

function readRequiredChecksFallback(): string[] {
  if (!fs.existsSync(BRANCH_PROTECTION_SCRIPT_PATH)) {
    return [];
  }

  return parseRequiredChecksFromBranchProtectionScript(
    fs.readFileSync(BRANCH_PROTECTION_SCRIPT_PATH, 'utf8'),
  );
}

function isBranchProtectionReadBlocked(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(403 Forbidden|404 Not Found)\b/.test(message);
}

async function fetchRequiredChecks(
  owner: string,
  repo: string,
  token: string,
): Promise<string[]> {
  let response: {
    contexts?: string[];
    checks?: Array<{ context?: string }>;
  };
  try {
    response = await fetchJson<{
      contexts?: string[];
      checks?: Array<{ context?: string }>;
    }>(`https://api.github.com/repos/${owner}/${repo}/branches/main/protection/required_status_checks`, {
      headers: githubHeaders(token),
    });
  } catch (error) {
    if (!isBranchProtectionReadBlocked(error)) {
      throw error;
    }

    const fallbackChecks = readRequiredChecksFallback();
    if (fallbackChecks.length === 0) {
      throw error;
    }
    return fallbackChecks;
  }

  const contexts = response.contexts ?? [];
  const checks = (response.checks ?? [])
    .map((entry) => entry.context?.trim())
    .filter((entry): entry is string => Boolean(entry));
  return [...new Set([...contexts, ...checks])];
}

async function fetchCommitChecks(
  owner: string,
  repo: string,
  sha: string,
  token: string,
): Promise<CommitCheckResult> {
  const [statusPayload, checksPayload] = await Promise.all([
    fetchJson<{
      statuses?: Array<{ context?: string; state?: string }>;
    }>(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/status`, {
      headers: githubHeaders(token),
    }),
    fetchJson<{
      check_runs?: Array<{ name?: string; conclusion?: string | null; status?: string }>;
    }>(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`, {
      headers: {
        ...githubHeaders(token),
        Accept: 'application/vnd.github+json',
      },
    }),
  ]);

  const requiredChecks = await fetchRequiredChecks(owner, repo, token);
  if (requiredChecks.length === 0) {
    return { passed: true, missing: [] };
  }

  const statusMap = new Map<string, boolean>();
  for (const status of statusPayload.statuses ?? []) {
    if (status.context) {
      statusMap.set(status.context, status.state === 'success');
    }
  }
  for (const checkRun of checksPayload.check_runs ?? []) {
    if (checkRun.name) {
      const isPassed = checkRun.status === 'completed' && checkRun.conclusion === 'success';
      if (isPassed || !statusMap.has(checkRun.name)) {
        statusMap.set(checkRun.name, isPassed);
      }
    }
  }

  const missing = requiredChecks.filter((check) => statusMap.get(check) !== true);
  return {
    passed: missing.length === 0,
    missing,
  };
}

export interface G3ReachabilityResult {
  /** SHA is reachable from main HEAD via any ancestor path (first or secondary parent). */
  reachable: boolean;
  /** SHA is on the first-parent chain specifically (fast-forward / squash-merge-to-main). */
  firstParent: boolean;
}

/**
 * Check whether `sha` is reachable from main HEAD.
 *
 * Option A implementation: uses `git merge-base --is-ancestor` for full-ancestry
 * reachability (first-parent OR secondary-parent), then separately checks
 * first-parent-only to surface a warning when the SHA landed via a --no-ff merge
 * commit (e.g. UTV2-1087 squash-merge anomaly, issue UTV2-1160).
 *
 * G3 passes for both cases; only a genuinely absent SHA causes G3 to fail.
 */
export function checkCommitReachableFromMain(
  sha: string,
  gitCommand: typeof git = git,
): G3ReachabilityResult {
  // Full-ancestry check: exit code 0 = ancestor, non-zero = not ancestor
  const ancestorResult = gitCommand(['merge-base', '--is-ancestor', sha, 'main']);
  const reachable = ancestorResult.ok;

  if (!reachable) {
    return { reachable: false, firstParent: false };
  }

  // First-parent check: is it on the linear history?
  const firstParentList = parseGitWithCommand(['rev-list', '--first-parent', 'main'], gitCommand);
  const firstParent = firstParentList.includes(sha);

  return { reachable: true, firstParent };
}

function parseGitWithCommand(args: string[], gitCommand: typeof git): string[] {
  const { stdout, ok } = gitCommand(args);
  if (!ok) {
    return [];
  }

  return stdout.split(/\r?\n/).filter(Boolean);
}

function gitShowCommit(sha: string): { timestamp: string; subject: string } | null {
  const result = git(['show', '-s', '--format=%cI%n%s', sha]);
  if (!result.ok || !result.stdout) {
    return null;
  }
  const [timestamp, ...subject] = result.stdout.split(/\r?\n/);
  return {
    timestamp,
    subject: subject.join(' '),
  };
}

function safeRead(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

export async function evaluateRequiredChecksWithHeadFallback(input: {
  mergeSha: string | null;
  headSha?: string | null;
  requiredChecks: string[];
  allowAdminMergeGateBypass?: boolean;
  fetchChecks: (sha: string) => Promise<CommitCheckResult>;
}): Promise<CommitCheckResult & { checkedSha: 'merge' | 'head' | 'head-admin-merge' | 'none' }> {
  const mergeChecks = input.mergeSha
    ? await input.fetchChecks(input.mergeSha)
    : { passed: false, missing: input.requiredChecks };
  if (mergeChecks.passed) {
    return { ...mergeChecks, checkedSha: 'merge' };
  }

  const headSha = input.headSha?.trim();
  if (headSha && headSha !== input.mergeSha) {
    const headChecks = await input.fetchChecks(headSha);
    if (headChecks.passed) {
      return { ...headChecks, checkedSha: 'head' };
    }
    if (input.allowAdminMergeGateBypass && isAdminMergeGateOnlyFailure(headChecks.missing)) {
      return {
        passed: true,
        missing: [],
        bypassed: headChecks.missing,
        checkedSha: 'head-admin-merge',
      };
    }
  }

  return { ...mergeChecks, checkedSha: input.mergeSha ? 'merge' : 'none' };
}

function isAdminMergeGateOnlyFailure(missing: string[]): boolean {
  return missing.length > 0 &&
    missing.every((check) => /^merge gate(?: ci)?$/i.test(check.trim()));
}

export function evaluateTestRunLogEvidence(
  staticProof: EvidenceBundleV1['static_proof'],
  mergeSha: string | null,
): 'pass' | 'fail' | 'skip' {
  const testRunLogs = staticProof?.test_run_logs;
  if (!Array.isArray(testRunLogs) || testRunLogs.length === 0) {
    return 'skip';
  }

  return mergeSha && testRunLogs.some((entry) => entry.merge_sha === mergeSha)
    ? 'pass'
    : 'fail';
}

function readFirstEvidenceBundle(
  proofFiles: string[],
): { path: string; bundle: EvidenceBundleV1 } | null {
  for (const proofPath of proofFiles) {
    try {
      const parsed = parseJsonFile<EvidenceBundleV1>(proofPath);
      if (parsed && typeof parsed === 'object') {
        return { path: proofPath, bundle: parsed };
      }
    } catch {
      continue;
    }
  }

  return null;
}

function tryParseEvidenceBundle(content: string): EvidenceBundleV1 | null {
  try {
    const parsed = JSON.parse(content) as EvidenceBundleV1;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function hasPopulatedObject(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && Object.keys(value as Record<string, unknown>).length > 0);
}

export function hasRuntimeReferences(runtimeProof: EvidenceBundleV1['runtime_proof']): boolean {
  if (!runtimeProof) {
    return false;
  }

  return (
    Array.isArray(runtimeProof.queries) && runtimeProof.queries.length > 0 ||
    Array.isArray(runtimeProof.receipts) && runtimeProof.receipts.length > 0 ||
    Array.isArray(runtimeProof.row_counts) && runtimeProof.row_counts.length > 0 ||
    Object.values(runtimeProof).some(
      (value) =>
        (typeof value === 'string' && value.trim().length > 0) ||
        (typeof value === 'number' && value !== 0),
    )
  );
}

export function findPostMergeTouches(input: {
  mergeSha: string;
  filesChanged: string[];
  issueId: string;
  sinceSha?: string;
  laneStartedAt?: string;
  allowSameIssueCommits?: boolean;
  gitCommand?: typeof git;
  showCommit?: typeof gitShowCommit;
}): string[] {
  const gitCommand = input.gitCommand ?? git;
  const logArgs = ['log', '--format=%H%x09%s%x09%cI', 'main', '--max-count=200'];
  const result = gitCommand(logArgs);
  if (!result.ok) {
    return [];
  }

  const mergeCommit = input.showCommit ? input.showCommit(input.mergeSha) : gitShowCommit(input.mergeSha);
  if (!mergeCommit?.timestamp) {
    return [];
  }
  const mergeTime = new Date(mergeCommit.timestamp).getTime();
  if (Number.isNaN(mergeTime)) {
    return [];
  }
  const windowEnd = mergeTime + 24 * 60 * 60 * 1000;
  const output: string[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line) {
      continue;
    }
    const [sha, subject, committedAt] = line.split('\t');
    if (!sha || sha === input.mergeSha) {
      continue;
    }
    if (input.sinceSha && sha === input.sinceSha) {
      break;
    }
    const committedTime = Date.parse(committedAt);
    if (Number.isNaN(committedTime) || committedTime > windowEnd) {
      continue;
    }
    if (committedTime <= mergeTime) {
      continue;
    }
    if (input.laneStartedAt && committedTime < new Date(input.laneStartedAt).getTime()) {
      continue;
    }
    const touchedFiles = gitCommand(['show', '--format=', '--name-only', sha]).stdout
      .split(/\r?\n/)
      .filter(Boolean);
    const overlaps = touchedFiles.some((filePath) => input.filesChanged.includes(filePath));
    if (!overlaps) {
      continue;
    }
    const referencedIssues = subject.match(/(?:UTV2|UNI)-\d+/gi) ?? [];
    if (
      input.allowSameIssueCommits &&
      referencedIssues.some((candidate) => candidate.toUpperCase() === input.issueId)
    ) {
      continue;
    }
    const hasFollowUpIssue = referencedIssues.some(
      (candidate) => candidate.toUpperCase() !== input.issueId,
    );
    if (!hasFollowUpIssue) {
      output.push(sha);
    }
  }

  return output;
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt === 1) {
        break;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Request failed for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function githubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'unit-talk-ops-truth-check',
  };
}

const P0_RUNBOOK = 'docs/05_operations/P0_PROTOCOL_SPEC.md';

/**
 * Format P0 protocol H-check failures from a TruthCheckResult as structured
 * log lines for consistent operator-visible output (UTV2-949).
 *
 * Returns empty string when no H-check failures are present.
 */
export function formatP0Failures(result: TruthCheckResult): string {
  const hFailures = result.checks.filter(
    (c) => c.id.startsWith('H') && c.status === 'fail',
  );

  if (hFailures.length === 0) return '';

  const lines: string[] = [];
  for (const check of hFailures) {
    const event = {
      event: 'p0_protocol.h_check_failed',
      check_id: check.id,
      issue_id: result.issue_id,
      block_reason: check.detail,
      verdict: result.verdict,
      runbook: P0_RUNBOOK,
    };
    lines.push(JSON.stringify(event));
  }
  return lines.join('\n');
}
