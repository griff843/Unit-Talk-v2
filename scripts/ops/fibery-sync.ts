import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  emitJson,
  getFlag,
  parseArgs,
} from './shared.js';
import { FiberyClient } from './fibery-client.js';
import {
  loadFiberyPolicy,
  loadSyncMetadata,
  runFiberySync,
  type SyncContext,
  type SyncEvent,
  buildResult,
} from './fibery-sync-lib.js';

type CliResult = Awaited<ReturnType<typeof runFiberySync>>;

async function main(argv = process.argv.slice(2)): Promise<number> {
  const { flags, bools } = parseArgs(argv);
  const event = parseEvent(getFlag(flags, 'event'));
  const syncFile = getFlag(flags, 'sync-file') ?? '.ops/sync.yml';
  const policyFile = getFlag(flags, 'policy-file') ?? '.ops/fibery-policy.yml';
  const resultFile = getFlag(flags, 'result-file');
  const commentFile = getFlag(flags, 'comment-file');

  let result: CliResult;
  try {
    const policy = loadFiberyPolicy(policyFile);
    const metadata = loadSyncMetadata(syncFile);
    const dryRun = bools.has('dry-run') || process.env[policy.fibery.dry_run_env] === 'true';
    const apiUrl = process.env[policy.fibery.api_url_env]?.trim() ?? '';
    const token = process.env[policy.fibery.api_token_env]?.trim() ?? '';
    if (!dryRun && (!apiUrl || !token)) {
      throw new Error(`${policy.fibery.api_url_env} and ${policy.fibery.api_token_env} are required for live Fibery sync`);
    }

    const context = buildContext(event, flags);
    const client = new FiberyClient({
      apiUrl: dryRun ? 'https://dry-run.invalid' : apiUrl,
      token: dryRun ? 'dry-run' : token,
      dryRun,
    });
    result = await runFiberySync({
      metadata,
      policy,
      context,
      client,
      dryRun,
    });
  } catch (error) {
    result = buildResult({
      event,
      dryRun: bools.has('dry-run'),
      code: 'fibery_sync_failed',
      actions: [],
      results: [],
      errors: [error instanceof Error ? error.message : String(error)],
    });
  }

  writeOutputs(result, resultFile, commentFile);
  emitJson(result);
  return result.ok ? 0 : 1;
}

function buildContext(event: SyncEvent, flags: Map<string, string[]>): SyncContext {
  return {
    event,
    prNumber: getFlag(flags, 'pr-number') ?? process.env.GITHUB_PR_NUMBER ?? '',
    prTitle: getFlag(flags, 'pr-title') ?? process.env.GITHUB_PR_TITLE ?? '',
    prUrl: getFlag(flags, 'pr-url') ?? process.env.GITHUB_PR_URL ?? '',
    actor: getFlag(flags, 'actor') ?? process.env.GITHUB_ACTOR ?? '',
    sha: getFlag(flags, 'sha') ?? process.env.GITHUB_SHA ?? '',
    repository: getFlag(flags, 'repository') ?? process.env.GITHUB_REPOSITORY ?? '',
  };
}

function parseEvent(value: string | undefined): SyncEvent {
  if (value === 'pr_open' || value === 'merge') {
    return value;
  }
  throw new Error('Missing or invalid --event. Use pr_open or merge');
}

function writeOutputs(result: CliResult, resultFile: string | undefined, commentFile: string | undefined): void {
  if (resultFile) {
    fs.mkdirSync(path.dirname(resultFile), { recursive: true });
    fs.writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  if (commentFile) {
    fs.mkdirSync(path.dirname(commentFile), { recursive: true });
    fs.writeFileSync(commentFile, result.comment_markdown, 'utf8');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      emitJson({
        ok: false,
        code: 'fibery_sync_unhandled_error',
        message: error instanceof Error ? error.message : String(error),
      });
      process.exitCode = 1;
    });
}
