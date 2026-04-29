import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  runSlateReplayHarness,
  type SlateReplayHookCapture,
  type SlateReplayVolumeMode,
} from '../packages/verification/src/engine/slate-replay.ts';

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

interface CliOptions {
  runId: string;
  scenarioId: string;
  volumeMode: SlateReplayVolumeMode;
  fixturePath?: string;
  archiveSourceId?: string;
  outPath?: string;
  captureFreshness: boolean;
  captureDbMetrics: boolean;
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const commitHash = await readCommitHash();
  const freshnessCapture = options.captureFreshness
    ? await captureHook('freshness', PNPM_COMMAND, ['stage:freshness', '--json'])
    : undefined;
  const dbMetricsCapture = options.captureDbMetrics
    ? await captureHook('db-metrics', PNPM_COMMAND, ['exec', 'tsx', 'scripts/pipeline-health.ts'])
    : undefined;

  const result = await runSlateReplayHarness({
    repoRoot: REPO_ROOT,
    runId: options.runId,
    scenarioId: options.scenarioId,
    fixturePath: options.fixturePath,
    archiveSourceId: options.archiveSourceId,
    commitHash,
    volumeMode: options.volumeMode,
    freshnessCapture,
    dbMetricsCapture,
  });

  const output = {
    summary: result.summary,
    runRecord: result.runRecord,
  };

  if (options.outPath) {
    const outPath = resolve(options.outPath);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

async function captureHook(
  hookId: string,
  command: string,
  args: string[]
): Promise<SlateReplayHookCapture> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd: REPO_ROOT,
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      hookId,
      status: 'captured',
      source: `${command} ${args.join(' ')}`,
      capturedAt: new Date().toISOString(),
      payload: parseHookPayload(stdout),
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : JSON.stringify(error);
    return {
      hookId,
      status: 'failed',
      source: `${command} ${args.join(' ')}`,
      capturedAt: new Date().toISOString(),
      error: message,
    };
  }
}

function parseHookPayload(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { raw: '' };
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return { raw: trimmed };
  }
}

async function readCommitHash(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
    });
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

function parseCliOptions(args: string[]): CliOptions {
  const values = new Map<string, string>();
  let captureFreshness = false;
  let captureDbMetrics = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith('--')) {
      continue;
    }

    if (arg === '--capture-freshness') {
      captureFreshness = true;
      continue;
    }

    if (arg === '--capture-db-metrics') {
      captureDbMetrics = true;
      continue;
    }

    const value = args[index + 1];
    if (value && !value.startsWith('--')) {
      values.set(arg.slice(2), value);
      index += 1;
    }
  }

  const volumeMode = (values.get('volume') ?? '1x') as SlateReplayVolumeMode;
  if (volumeMode !== '1x' && volumeMode !== '2x') {
    throw new Error('--volume must be 1x or 2x');
  }

  return {
    runId: values.get('run-id') ?? `utv2-796-${volumeMode}`,
    scenarioId: values.get('scenario') ?? 'slate-replay',
    volumeMode,
    fixturePath: values.get('fixture'),
    archiveSourceId: values.get('archive-source'),
    outPath: values.get('out'),
    captureFreshness,
    captureDbMetrics,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
