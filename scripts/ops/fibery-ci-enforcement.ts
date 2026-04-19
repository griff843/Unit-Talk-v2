import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  emitJson,
  getFlag,
  getFlags,
  parseArgs,
} from './shared.js';
import {
  extractIssueIds,
  loadSyncMetadata,
  type SyncMetadata,
} from './fibery-sync-lib.js';

const SYNC_BYPASS_LABEL = 'fibery-sync-bypass-approved';
const MULTI_ISSUE_APPROVAL_LABEL = 'multi-issue-pr-approved';

type EnforcementResult = {
  ok: boolean;
  code: 'fibery_ci_enforcement_passed' | 'fibery_ci_enforcement_failed';
  failures: string[];
  changed_files: string[];
  implementation_files: string[];
  proof_sensitive_files: string[];
  issue_ids: string[];
  sync_file_present: boolean;
  labels: string[];
};

const IMPLEMENTATION_PATTERNS = [
  /^apps\/[^/]+\//,
  /^packages\/[^/]+\//,
  /^scripts\/.+\.(ts|mjs|js|sh)$/,
  /^supabase\/migrations\/.+\.sql$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
];

const PROOF_SENSITIVE_PATTERNS = [
  /^packages\/db\/src\/lifecycle\.ts$/,
  /^packages\/db\/src\/repositories\.ts$/,
  /^packages\/db\/src\/runtime-repositories\.ts$/,
  /^apps\/api\/src\/controllers\/submit-pick-controller\.ts$/,
  /^apps\/api\/src\/controllers\/review-pick-controller\.ts$/,
  /^apps\/api\/src\/controllers\/settle-pick-controller\.ts$/,
  /^apps\/api\/src\/promotion-service\.ts$/,
  /^apps\/api\/src\/submission-service\.ts$/,
  /^apps\/api\/src\/distribution-service\.ts$/,
  /^apps\/api\/src\/run-audit-service\.ts$/,
  /^apps\/api\/src\/settlement-service\.ts$/,
  /^supabase\/migrations\/.+\.sql$/,
  /^apps\/api\/src\/t1-proof-.*\.test\.ts$/,
  /^apps\/api\/src\/.*test-db.*\.ts$/,
  /^apps\/[^/]+\/src\/scripts\/.+\.ts$/,
  /^packages\/[^/]+\/src\/scripts\/.+\.ts$/,
];

export function normalizeChangedFiles(input: string[]): string[] {
  const seen = new Set<string>();
  for (const value of input) {
    for (const line of value.split(/\r?\n/)) {
      const normalized = line.trim().replaceAll('\\', '/').replace(/^\.\/+/, '');
      if (normalized) {
        seen.add(normalized);
      }
    }
  }
  return [...seen].sort((left, right) => left.localeCompare(right));
}

export function parseLabels(values: string[]): string[] {
  const labels = values.flatMap((value) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.map((entry) => String(entry));
        }
      } catch {
        return [trimmed];
      }
    }
    return trimmed.split(',');
  });
  return labels
    .map((label) => label.trim())
    .filter(Boolean)
    .map((label) => label.toLowerCase());
}

export function isImplementationFile(filePath: string): boolean {
  return IMPLEMENTATION_PATTERNS.some((pattern) => pattern.test(filePath));
}

export function isProofSensitiveFile(filePath: string): boolean {
  return PROOF_SENSITIVE_PATTERNS.some((pattern) => pattern.test(filePath));
}

export function evaluateFiberyCiEnforcement(input: {
  changedFiles: string[];
  syncFilePresent: boolean;
  metadata: SyncMetadata | null;
  referencedText: string;
  labels: string[];
}): EnforcementResult {
  const changedFiles = normalizeChangedFiles(input.changedFiles);
  const labels = input.labels.map((label) => label.toLowerCase());
  const implementationFiles = changedFiles.filter(isImplementationFile);
  const proofSensitiveFiles = changedFiles.filter(isProofSensitiveFile);
  const issueIds = extractIssueIds([
    input.referencedText,
    ...(input.metadata?.entities.issues ?? []),
  ].join('\n'));
  const failures: string[] = [];
  const syncBypassApproved =
    labels.includes(SYNC_BYPASS_LABEL) || input.metadata?.approval.skip_sync_required === true;
  const multiIssueApproved =
    input.metadata?.approval.allow_multiple_issues === true &&
    labels.includes(MULTI_ISSUE_APPROVAL_LABEL);

  if (implementationFiles.length > 0 && !input.syncFilePresent && !syncBypassApproved) {
    failures.push(
      [
        '.ops/sync.yml is required because this PR touches implementation work.',
        `Changed implementation files: ${implementationFiles.join(', ')}`,
        `Add .ops/sync.yml with entities.issues, or apply the ${SYNC_BYPASS_LABEL} label for an approved bypass.`,
      ].join(' '),
    );
  }

  if (input.syncFilePresent && input.metadata && implementationFiles.length > 0 && input.metadata.entities.issues.length === 0 && !syncBypassApproved) {
    failures.push(
      '.ops/sync.yml must declare at least one implementation issue under entities.issues, for example UTV2-123.',
    );
  }

  if (issueIds.length > 1 && !multiIssueApproved) {
    failures.push(
      [
        `Multiple UTV2 issue IDs referenced: ${issueIds.join(', ')}.`,
        'To approve a multi-issue PR, set approval.allow_multiple_issues: true in .ops/sync.yml',
        `and apply the ${MULTI_ISSUE_APPROVAL_LABEL} label.`,
      ].join(' '),
    );
  }

  if (proofSensitiveFiles.length > 0) {
    if (!input.syncFilePresent) {
      failures.push(
        [
          '.ops/sync.yml is required because proof-sensitive paths changed.',
          `Proof-sensitive files: ${proofSensitiveFiles.join(', ')}`,
          'Add entities.proofs metadata that references the Fibery proof artifact.',
        ].join(' '),
      );
    } else if (!input.metadata || input.metadata.entities.proofs.length === 0) {
      failures.push(
        [
          '.ops/sync.yml must declare proof metadata under entities.proofs because proof-sensitive paths changed.',
          `Proof-sensitive files: ${proofSensitiveFiles.join(', ')}`,
        ].join(' '),
      );
    }
  }

  return {
    ok: failures.length === 0,
    code: failures.length === 0 ? 'fibery_ci_enforcement_passed' : 'fibery_ci_enforcement_failed',
    failures,
    changed_files: changedFiles,
    implementation_files: implementationFiles,
    proof_sensitive_files: proofSensitiveFiles,
    issue_ids: issueIds,
    sync_file_present: input.syncFilePresent,
    labels,
  };
}

export function main(argv = process.argv.slice(2)): number {
  const { flags, bools } = parseArgs(argv);
  const syncFile = getFlag(flags, 'sync-file') ?? '.ops/sync.yml';
  const changedFileList = getFlag(flags, 'changed-file-list');
  const changedFiles = [
    ...getFlags(flags, 'changed-file'),
    ...(changedFileList && fs.existsSync(changedFileList) ? [fs.readFileSync(changedFileList, 'utf8')] : []),
  ];
  const labels = parseLabels(getFlags(flags, 'label'));
  const referencedText = [
    getFlag(flags, 'title') ?? '',
    getFlag(flags, 'body') ?? '',
    getFlag(flags, 'branch') ?? '',
    ...getFlags(flags, 'commit-message'),
  ].join('\n');
  const syncFilePresent = fs.existsSync(syncFile);
  const metadata = syncFilePresent ? loadSyncMetadata(syncFile) : null;
  const result = evaluateFiberyCiEnforcement({
    changedFiles,
    syncFilePresent,
    metadata,
    referencedText,
    labels,
  });

  if (bools.has('json')) {
    emitJson(result);
  } else if (!result.ok) {
    for (const failure of result.failures) {
      console.error(`ERROR: ${failure}`);
    }
  } else {
    console.log('Fibery CI enforcement passed.');
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    emitJson({
      ok: false,
      code: 'fibery_ci_enforcement_failed',
      failures: [error instanceof Error ? error.message : String(error)],
      changed_files: [],
      implementation_files: [],
      proof_sensitive_files: [],
      issue_ids: [],
      sync_file_present: false,
      labels: [],
    } satisfies EnforcementResult);
    process.exitCode = 1;
  }
}
