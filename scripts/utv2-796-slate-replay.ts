import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadEnvironment } from '../packages/config/src/index.js';
import {
  createDatabaseIngestorRepositoryBundle,
  createInMemoryIngestorRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type IngestorRepositoryBundle,
} from '../packages/db/src/index.js';
import {
  runSlateReplayHarness,
  type SlateReplayHookCapture,
  type SlateReplayVolumeMode,
} from '../packages/verification/src/engine/slate-replay.js';
import {
  captureProviderOfferReplayPack,
  runProviderOfferReplay,
} from '../apps/ingestor/src/provider-offer-replay.js';

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

interface CliOptions {
  engine: 'slate' | 'provider-offer';
  action: 'run' | 'capture' | 'replay';
  persistence: 'database' | 'in-memory';
  allowDbWrites: boolean;
  confirmBillingChecklist: boolean;
  runId: string;
  scenarioId: string;
  volumeMode: SlateReplayVolumeMode;
  fixturePath?: string;
  archiveSourceId?: string;
  outPath?: string;
  captureFreshness: boolean;
  captureDbMetrics: boolean;
  providerKey: string;
  league: string;
  packDir?: string;
  captureRootDir?: string;
  snapshotAt?: string;
  freshnessSlaMs?: number;
  apiKey?: string;
  skipResults: boolean;
  startsAfter?: string;
  startsBefore?: string;
  providerEventIds?: string[];
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const output =
    options.engine === 'provider-offer'
      ? await runProviderOfferEngine(options)
      : await runSlateEngine(options);

  if (options.outPath) {
    const outPath = resolve(options.outPath);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

async function runSlateEngine(options: CliOptions) {
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

  return {
    engine: 'slate',
    action: 'run',
    summary: result.summary,
    runRecord: result.runRecord,
  };
}

async function runProviderOfferEngine(options: CliOptions) {
  assertProviderOfferWriteApproval(options);

  const env = loadEnvironment(REPO_ROOT);
  const repositories = resolveIngestorRepositories(options.persistence, env);
  const apiKey = options.apiKey ?? env.SGO_API_KEY ?? env.SGO_API_KEYS?.[0] ?? 'replay-key';
  const freshnessSlaMs =
    options.freshnessSlaMs ??
    resolveFreshnessSlaMs(env.UNIT_TALK_INGESTOR_OFFER_STALE_MINUTES);

  if (options.action === 'capture') {
    const snapshotAt = options.snapshotAt ?? new Date().toISOString();
    const capture = await captureProviderOfferReplayPack(repositories, {
      rootDir: resolve(options.captureRootDir ?? 'out/provider-offer-replay'),
      providerKey: options.providerKey,
      league: options.league,
      apiKey,
      snapshotAt,
      freshnessMaxAgeMs: freshnessSlaMs,
      skipResults: options.skipResults,
      ...(options.startsAfter ? { startsAfter: options.startsAfter } : {}),
      ...(options.startsBefore ? { startsBefore: options.startsBefore } : {}),
      ...(options.providerEventIds
        ? { providerEventIds: options.providerEventIds }
        : {}),
      logger: console,
    });
    return {
      engine: 'provider-offer',
      action: 'capture',
      packDir: capture.packDir,
      manifest: capture.manifest,
      replayContract: {
        spec: 'UTV2-796',
        freshnessSlaMs,
      },
    };
  }

  if (!options.packDir) {
    throw new Error('--pack-dir is required for provider-offer replay');
  }

  const replay = await runProviderOfferReplay(repositories, {
    packDir: resolve(options.packDir),
    mode: options.volumeMode,
    apiKey,
    league: options.league,
    logger: console,
  });
  return {
    engine: 'provider-offer',
    action: 'replay',
    mode: options.volumeMode,
    reportPath: replay.reportPath,
    manifest: replay.manifest,
    replaySummary: replay.replaySummary,
    replayCycleStatus: replay.replayCycleStatus,
    requestMetrics: replay.requestMetrics,
    replayContract: {
      spec: 'UTV2-796',
      freshnessSlaMs: replay.manifest.freshnessMaxAgeMs,
    },
  };
}

function resolveIngestorRepositories(
  persistence: CliOptions['persistence'],
  env: ReturnType<typeof loadEnvironment>,
): IngestorRepositoryBundle {
  if (persistence === 'in-memory') {
    return createInMemoryIngestorRepositoryBundle();
  }

  return createDatabaseIngestorRepositoryBundle(
    createServiceRoleDatabaseConnectionConfig(env),
  );
}

async function captureHook(
  hookId: string,
  command: string,
  args: string[],
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

export function assertProviderOfferWriteApproval(
  options: Pick<CliOptions, 'engine' | 'persistence' | 'allowDbWrites' | 'confirmBillingChecklist'>,
) {
  if (
    options.engine === 'provider-offer' &&
    options.persistence === 'database' &&
    !options.allowDbWrites
  ) {
    throw new Error(
      'provider-offer replay defaults to in-memory persistence; pass --allow-db-writes with --persistence database only for an intentional live DB write.',
    );
  }

  if (
    options.engine === 'provider-offer' &&
    options.persistence === 'database' &&
    !options.confirmBillingChecklist
  ) {
    throw new Error(
      'provider-offer database replay requires --confirm-billing-checklist to acknowledge Supabase billing / spend-cap review before heavy ingestion tests.',
    );
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

export function parseCliOptions(args: string[]): CliOptions {
  const values = new Map<string, string>();
  let captureFreshness = false;
  let captureDbMetrics = false;
  let skipResults = false;
  let allowDbWrites = false;
  let confirmBillingChecklist = false;

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

    if (arg === '--skip-results') {
      skipResults = true;
      continue;
    }

    if (arg === '--allow-db-writes') {
      allowDbWrites = true;
      continue;
    }

    if (arg === '--confirm-billing-checklist') {
      confirmBillingChecklist = true;
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

  const engine = (values.get('engine') ?? 'slate') as CliOptions['engine'];
  if (engine !== 'slate' && engine !== 'provider-offer') {
    throw new Error('--engine must be slate or provider-offer');
  }

  const action = (values.get('action') ?? 'run') as CliOptions['action'];
  if (!['run', 'capture', 'replay'].includes(action)) {
    throw new Error('--action must be run, capture, or replay');
  }

  const persistence = (values.get('persistence') ??
    defaultPersistenceForEngine(engine)) as CliOptions['persistence'];
  if (persistence !== 'database' && persistence !== 'in-memory') {
    throw new Error('--persistence must be database or in-memory');
  }

  return {
    engine,
    action,
    persistence,
    allowDbWrites,
    confirmBillingChecklist,
    runId: values.get('run-id') ?? `utv2-796-${volumeMode}`,
    scenarioId: values.get('scenario') ?? 'slate-replay',
    volumeMode,
    fixturePath: values.get('fixture'),
    archiveSourceId: values.get('archive-source'),
    outPath: values.get('out'),
    captureFreshness,
    captureDbMetrics,
    providerKey: values.get('provider') ?? 'sgo',
    league: values.get('league') ?? 'NBA',
    packDir: values.get('pack-dir'),
    captureRootDir: values.get('capture-root'),
    snapshotAt: values.get('snapshot-at'),
    freshnessSlaMs: parsePositiveInt(values.get('freshness-sla-ms')),
    apiKey: values.get('api-key'),
    skipResults,
    startsAfter: values.get('starts-after'),
    startsBefore: values.get('starts-before'),
    providerEventIds: values.get('provider-event-ids')?.split(',').map((value) => value.trim()).filter(Boolean),
  };
}

export function defaultPersistenceForEngine(engine: CliOptions['engine']): CliOptions['persistence'] {
  return engine === 'provider-offer' ? 'in-memory' : 'database';
}

function parsePositiveInt(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function resolveFreshnessSlaMs(staleMinutes: string | undefined) {
  const parsedMinutes = parsePositiveInt(staleMinutes);
  return (parsedMinutes ?? 30) * 60 * 1000;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
