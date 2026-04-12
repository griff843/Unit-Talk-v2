import { pathToFileURL } from 'node:url';
import {
  emitJson,
  getFlag,
  parseArgs,
  readManifest,
  relativeToRoot,
  requireIssueId,
  validateBranchName,
  writeManifest,
} from './shared.js';

const PR_URL_PATTERN = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/;

type LaneLinkResult = {
  ok: boolean;
  code: string;
  message?: string;
  issue_id?: string;
  manifest_path?: string;
  branch?: string;
  pr_url?: string;
  status?: string;
  heartbeat_at?: string;
};

export function main(argv = process.argv.slice(2)): number {
  const { positionals, flags } = parseArgs(argv);
  const issueIdRaw = positionals[0] ?? '';
  const branch = getFlag(flags, 'branch') ?? '';
  const prUrl = getFlag(flags, 'pr') ?? '';

  try {
    const issueId = requireIssueId(issueIdRaw);
    if (!branch) {
      throw new Error('Missing required --branch');
    }
    if (!prUrl) {
      throw new Error('Missing required --pr');
    }
    validateBranchName(branch);
    if (!PR_URL_PATTERN.test(prUrl)) {
      emitJson({
        ok: false,
        code: 'pr_url_invalid',
        message: `Invalid PR URL: ${prUrl}`,
        issue_id: issueId,
        branch,
        pr_url: prUrl,
      } satisfies LaneLinkResult);
      return 1;
    }

    const manifest = readManifest(issueId);
    const manifestPath = relativeToRoot(`docs/06_status/lanes/${issueId}.json`);

    if (manifest.branch !== branch) {
      emitJson({
        ok: false,
        code: 'branch_mismatch',
        message: `Manifest branch ${manifest.branch} does not match requested branch ${branch}`,
        issue_id: issueId,
        branch,
        manifest_path: manifestPath,
      } satisfies LaneLinkResult);
      return 1;
    }
    if (manifest.lane_type !== 'codex-cli') {
      emitJson({
        ok: false,
        code: 'lane_type_mismatch',
        message: `Manifest lane_type must be codex-cli, found ${manifest.lane_type}`,
        issue_id: issueId,
        branch,
        manifest_path: manifestPath,
      } satisfies LaneLinkResult);
      return 1;
    }
    if (manifest.status === 'in_review') {
      emitJson({
        ok: false,
        code: 'already_in_review',
        message: `${issueId} is already in_review`,
        issue_id: issueId,
        manifest_path: manifestPath,
        branch,
        pr_url: manifest.pr_url ?? prUrl,
        status: manifest.status,
        heartbeat_at: manifest.heartbeat_at,
      } satisfies LaneLinkResult);
      return 2;
    }
    if (manifest.status === 'merged' || manifest.status === 'done') {
      emitJson({
        ok: false,
        code: 'status_not_transitionable',
        message: `${issueId} is already ${manifest.status}`,
        issue_id: issueId,
        manifest_path: manifestPath,
        branch,
        pr_url: manifest.pr_url ?? prUrl,
        status: manifest.status,
        heartbeat_at: manifest.heartbeat_at,
      } satisfies LaneLinkResult);
      return 2;
    }
    if (!['started', 'in_progress', 'reopened'].includes(manifest.status)) {
      emitJson({
        ok: false,
        code: 'status_not_transitionable',
        message: `${issueId} with status ${manifest.status} cannot transition to in_review`,
        issue_id: issueId,
        manifest_path: manifestPath,
        branch,
        status: manifest.status,
      } satisfies LaneLinkResult);
      return 1;
    }

    manifest.status = 'in_review';
    manifest.pr_url = prUrl;
    manifest.heartbeat_at = new Date().toISOString();
    writeManifest(manifest);

    emitJson({
      ok: true,
      code: 'lane_linked',
      issue_id: issueId,
      manifest_path: manifestPath,
      branch: manifest.branch,
      pr_url: manifest.pr_url,
      status: manifest.status,
      heartbeat_at: manifest.heartbeat_at,
    } satisfies LaneLinkResult);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT|no such file/i.test(message)) {
      emitJson({
        ok: false,
        code: 'manifest_missing',
        message,
        issue_id: issueIdRaw ? issueIdRaw.toUpperCase() : undefined,
      } satisfies LaneLinkResult);
      return 1;
    }
    emitJson({
      ok: false,
      code: 'lane_link_pr_failed',
      message,
      issue_id: issueIdRaw ? issueIdRaw.toUpperCase() : undefined,
      branch: branch || undefined,
      pr_url: prUrl || undefined,
    } satisfies LaneLinkResult);
    return /Not in a git repository/i.test(message) ? 3 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
