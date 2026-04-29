import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadEnvironment } from '@unit-talk/config';
import {
  calculateRestartDelayMs,
  createInitialSupervisorState,
  evaluateIngestorHealth,
  type IngestorSupervisorState,
} from '../apps/ingestor/src/supervisor.js';
import {
  appendRestartAuditLog,
  createRestartAuditEntry,
  evaluateRestartRequest,
  readRestartAuditLog,
} from './restart-controls.js';

type Command = 'start' | 'run' | 'status' | 'stop' | 'restart';

interface ProcessRef {
  pid: number;
  commandLine: string;
}

interface RuntimeStatus {
  supervisorState: IngestorSupervisorState;
  supervisorRunning: boolean;
  childRunning: boolean;
  processConflicts: ProcessRef[];
  latestRunStatus: string | null;
  latestRunStartedAt: string | null;
  latestOfferCreatedAt: string | null;
  health: ReturnType<typeof evaluateIngestorHealth>;
  paths: {
    runtimeDir: string;
    supervisorLog: string;
    childLog: string;
    stateFile: string;
  };
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_DIR = path.join(ROOT, 'out', 'ingestor-runtime');
const SUPERVISOR_LOG = path.join(RUNTIME_DIR, 'supervisor.log');
const CHILD_LOG = path.join(RUNTIME_DIR, 'ingestor.log');
const STATE_FILE = path.join(RUNTIME_DIR, 'state.json');
const SUPERVISOR_SCRIPT = path.join(ROOT, 'scripts', 'ingestor-supervisor.ts');
const INGESTOR_ENTRY = path.join(ROOT, 'apps', 'ingestor', 'src', 'index.ts');
const RESTART_AUDIT_LOG = path.join(ROOT, 'out', 'runtime-control', 'restart-audit.jsonl');

async function main() {
  const command = normalizeCommand(process.argv[2]);

  switch (command) {
    case 'start':
      await startSupervisor();
      return;
    case 'run':
      await runSupervisor();
      return;
    case 'status':
      await printStatus();
      return;
    case 'stop':
      await stopSupervisor();
      return;
    case 'restart':
      enforceRestartPolicy('ingestor');
      await stopSupervisor({ silentIfMissing: true });
      await startSupervisor();
      return;
    default:
      throw new Error(`Unsupported command: ${process.argv[2] ?? '(missing)'}`);
  }
}

function normalizeCommand(value: string | undefined): Command {
  switch ((value ?? 'status').toLowerCase()) {
    case 'start':
    case 'run':
    case 'status':
    case 'stop':
    case 'restart':
      return value.toLowerCase() as Command;
    default:
      return 'status';
  }
}

async function startSupervisor() {
  ensureRuntimeDir();
  const existingStatus = await collectRuntimeStatus();

  if (existingStatus.supervisorRunning) {
    console.log('Ingestor supervisor is already running.');
    printHumanStatus(existingStatus);
    return;
  }

  if (existingStatus.processConflicts.length > 0) {
    throw new Error(
      `Refusing to start supervisor while unmanaged ingestor process(es) exist: ${existingStatus.processConflicts
        .map((ref) => `${ref.pid}`)
        .join(', ')}`,
    );
  }

  const stdoutFd = fs.openSync(SUPERVISOR_LOG, 'a');
  const stderrFd = fs.openSync(SUPERVISOR_LOG, 'a');
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', SUPERVISOR_SCRIPT, 'run'],
    {
      cwd: ROOT,
      env: process.env,
      detached: true,
      stdio: ['ignore', stdoutFd, stderrFd],
      windowsHide: true,
    },
  );

  child.unref();
  fs.closeSync(stdoutFd);
  fs.closeSync(stderrFd);

  await sleep(1000);
  const status = await collectRuntimeStatus();

  console.log(`Started ingestor supervisor (pid ${child.pid ?? 'unknown'}).`);
  printHumanStatus(status);
}

async function runSupervisor() {
  ensureRuntimeDir();

  let stopping = false;
  let child: ReturnType<typeof spawn> | null = null;
  let state = createInitialSupervisorState(new Date(), process.pid);
  persistState(state);

  const shutdown = () => {
    stopping = true;
    state = { ...state, status: 'stopping', childPid: child?.pid ?? state.childPid };
    persistState(state);

    if (child?.pid && isProcessRunning(child.pid)) {
      try {
        process.kill(child.pid, 'SIGTERM');
      } catch {
        // best-effort
      }
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (!stopping) {
    child = startIngestorChild();
    state = {
      ...state,
      status: 'running',
      childPid: child.pid ?? null,
      childStartedAt: new Date().toISOString(),
      supervisorPid: process.pid,
      lastError: null,
    };
    persistState(state);

    const exitResult = await waitForExit(child);

    if (stopping) {
      break;
    }

    state = {
      ...state,
      status: 'restarting',
      childPid: null,
      lastExitCode: exitResult.code,
      lastExitSignal: exitResult.signal,
      lastExitAt: new Date().toISOString(),
      lastError: exitResult.code === 0 ? null : `ingestor exited with code ${exitResult.code ?? 'unknown'}`,
      restartCount: state.restartCount + 1,
    };
    persistState(state);

    await sleep(calculateRestartDelayMs(state.restartCount));
  }

  if (child?.pid && isProcessRunning(child.pid)) {
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {
      // best-effort
    }
  }

  const stoppedState: IngestorSupervisorState = {
    ...state,
    status: 'stopped',
    supervisorPid: null,
    childPid: null,
  };
  persistState(stoppedState);
}

function startIngestorChild() {
  const logFd = fs.openSync(CHILD_LOG, 'a');
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', INGESTOR_ENTRY],
    {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    },
  );
  fs.closeSync(logFd);
  return child;
}

async function printStatus() {
  const status = await collectRuntimeStatus();
  printHumanStatus(status);
}

function printHumanStatus(status: RuntimeStatus) {
  console.log(`Supervisor: ${status.supervisorRunning ? 'RUNNING' : 'DOWN'}`);
  console.log(`Child:      ${status.childRunning ? 'RUNNING' : 'DOWN'}`);
  console.log(`Health:     ${status.health.status.toUpperCase()} — ${status.health.summary}`);
  console.log(`Restarts:   ${status.supervisorState.restartCount}`);
  console.log(`Run status: ${status.latestRunStatus ?? 'none'}`);
  console.log(`Run at:     ${status.latestRunStartedAt ?? 'none'}`);
  console.log(`Offer at:   ${status.latestOfferCreatedAt ?? 'none'}`);
  console.log(`Runtime:    ${status.paths.runtimeDir}`);
  console.log(`Logs:       ${status.paths.supervisorLog}`);
  console.log(`Child log:  ${status.paths.childLog}`);

  if (status.processConflicts.length > 0) {
    console.log('Conflicts:  unmanaged ingestor processes detected');
    for (const ref of status.processConflicts) {
      console.log(`  - pid=${ref.pid} ${ref.commandLine}`);
    }
  }

  for (const fact of status.health.facts) {
    console.log(`  * ${fact}`);
  }
}

async function stopSupervisor(options: { silentIfMissing?: boolean } = {}) {
  const status = await collectRuntimeStatus();

  if (!status.supervisorRunning) {
    if (!options.silentIfMissing) {
      console.log('Ingestor supervisor is not running.');
    }
    return;
  }

  const supervisorPid = status.supervisorState.supervisorPid;
  if (!supervisorPid) {
    throw new Error('Supervisor pid missing from runtime state.');
  }

  try {
    process.kill(supervisorPid, 'SIGTERM');
  } catch (error) {
    if (!isMissingProcessError(error)) {
      throw error;
    }
  }
  const exited = await waitForProcessExit(supervisorPid, 15000);

  if (!exited) {
    throw new Error(`Timed out waiting for supervisor ${supervisorPid} to stop.`);
  }

  console.log(`Stopped ingestor supervisor (pid ${supervisorPid}).`);
}

function isMissingProcessError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ESRCH'
  );
}

async function collectRuntimeStatus(): Promise<RuntimeStatus> {
  ensureRuntimeDir();
  const env = loadEnvironment();
  const state = readSupervisorState();
  const supervisorRunning = isProcessRunning(state.supervisorPid);
  const childRunning = isProcessRunning(state.childPid);
  const conflicts = listUnmanagedIngestorProcesses(state);
  const dbStatus = await readDatabaseStatus();
  const health = evaluateIngestorHealth({
    autorun: env.UNIT_TALK_INGESTOR_AUTORUN === 'true',
    pollIntervalMs: parsePositiveInt(env.UNIT_TALK_INGESTOR_POLL_MS, 300000),
    supervisorRunning,
    childRunning,
    restartCount: state.restartCount,
    latestRunStatus: dbStatus.latestRunStatus,
    latestRunStartedAt: dbStatus.latestRunStartedAt,
    latestOfferCreatedAt: dbStatus.latestOfferCreatedAt,
  });

  return {
    supervisorState: state,
    supervisorRunning,
    childRunning,
    processConflicts: conflicts,
    latestRunStatus: dbStatus.latestRunStatus,
    latestRunStartedAt: dbStatus.latestRunStartedAt,
    latestOfferCreatedAt: dbStatus.latestOfferCreatedAt,
    health,
    paths: {
      runtimeDir: RUNTIME_DIR,
      supervisorLog: SUPERVISOR_LOG,
      childLog: CHILD_LOG,
      stateFile: STATE_FILE,
    },
  };
}

async function readDatabaseStatus() {
  const env = loadEnvironment();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      latestRunStatus: null,
      latestRunStartedAt: null,
      latestOfferCreatedAt: null,
    };
  }

  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const [{ data: runRows }, { data: offerRows }] = await Promise.all([
    db
      .from('system_runs')
      .select('status, started_at')
      .eq('run_type', 'ingestor.cycle')
      .order('started_at', { ascending: false })
      .limit(1),
    db
      .from('provider_offers')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  return {
    latestRunStatus:
      typeof runRows?.[0]?.status === 'string' ? runRows[0].status : null,
    latestRunStartedAt:
      typeof runRows?.[0]?.started_at === 'string' ? runRows[0].started_at : null,
    latestOfferCreatedAt:
      typeof offerRows?.[0]?.created_at === 'string' ? offerRows[0].created_at : null,
  };
}

function readSupervisorState(): IngestorSupervisorState {
  if (!fs.existsSync(STATE_FILE)) {
    return createInitialSupervisorState(new Date(), null);
  }

  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<IngestorSupervisorState>;
    return {
      ...createInitialSupervisorState(new Date(), null),
      ...parsed,
    };
  } catch {
    return createInitialSupervisorState(new Date(), null);
  }
}

function persistState(state: IngestorSupervisorState) {
  ensureRuntimeDir();
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function ensureRuntimeDir() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

function enforceRestartPolicy(service: 'ingestor') {
  const now = new Date();
  const history = readRestartAuditLog(RESTART_AUDIT_LOG);
  const decision = evaluateRestartRequest({ service, history, now });
  appendRestartAuditLog(
    RESTART_AUDIT_LOG,
    createRestartAuditEntry({
      service,
      outcome: decision.allowed ? 'allowed' : 'denied',
      reason: decision.reason,
      message: decision.message,
      now,
    }),
  );

  if (!decision.allowed) {
    throw new Error(decision.message);
  }

  console.log(`[ingestor-supervisor] ${decision.message}`);
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function isProcessRunning(pid: number | null) {
  if (!pid || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function listUnmanagedIngestorProcesses(state: IngestorSupervisorState): ProcessRef[] {
  const refs = listProcessRefs().filter((ref) =>
    ref.commandLine.includes('apps\\ingestor\\src\\index.ts') ||
    ref.commandLine.includes('apps/ingestor/src/index.ts'),
  );

  return refs.filter((ref) => ref.pid !== state.childPid && ref.pid !== state.supervisorPid);
}

function listProcessRefs(): ProcessRef[] {
  if (process.platform === 'win32') {
    const result = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress",
      ],
      { cwd: ROOT, encoding: 'utf8' },
    );

    if (result.status !== 0 || !result.stdout.trim()) {
      return [];
    }

    // Strip unescaped control characters that PowerShell ConvertTo-Json emits in CommandLine strings
    // eslint-disable-next-line no-control-regex
    const sanitized = result.stdout.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ');
    const payload = JSON.parse(sanitized) as
      | { ProcessId?: number; CommandLine?: string | null }
      | Array<{ ProcessId?: number; CommandLine?: string | null }>;
    const rows = Array.isArray(payload) ? payload : [payload];
    return rows
      .filter((row) => typeof row.ProcessId === 'number' && typeof row.CommandLine === 'string')
      .map((row) => ({ pid: row.ProcessId!, commandLine: row.CommandLine! }));
  }

  const result = spawnSync('ps', ['-axo', 'pid=,command='], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) {
        return null;
      }

      return {
        pid: Number.parseInt(match[1] ?? '', 10),
        commandLine: match[2] ?? '',
      };
    })
    .filter((row): row is ProcessRef => row !== null && Number.isFinite(row.pid));
}

function waitForExit(child: ReturnType<typeof spawn>) {
  return new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.once('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });
}

async function waitForProcessExit(pid: number, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessRunning(pid)) {
      return true;
    }
    await sleep(250);
  }
  return false;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
