import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnvironment } from '@unit-talk/config';

export type Command = 'start' | 'run' | 'status' | 'stop' | 'restart';

export interface ApiSupervisorState {
  supervisorPid: number | null;
  childPid: number | null;
  status: 'init' | 'running' | 'restarting' | 'stopping' | 'stopped';
  startedAt: string;
  childStartedAt: string | null;
  lastExitCode: number | null;
  lastExitSignal: string | null;
  lastExitAt: string | null;
  lastError: string | null;
  restartCount: number;
}

interface ProcessRef {
  pid: number;
  commandLine: string;
}

export interface ApiHealthCheck {
  status: 'healthy' | 'degraded' | 'down';
  detail: string;
  httpStatus: number | null;
  payload: Record<string, unknown> | null;
}

interface RuntimeStatus {
  supervisorState: ApiSupervisorState;
  supervisorRunning: boolean;
  childRunning: boolean;
  processConflicts: ProcessRef[];
  health: ApiHealthCheck;
  port: number;
  paths: {
    runtimeDir: string;
    supervisorLog: string;
    childLog: string;
    stateFile: string;
  };
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_DIR = path.join(ROOT, 'out', 'api-runtime');
const SUPERVISOR_LOG = path.join(RUNTIME_DIR, 'supervisor.log');
const CHILD_LOG = path.join(RUNTIME_DIR, 'api.log');
const STATE_FILE = path.join(RUNTIME_DIR, 'state.json');
const SUPERVISOR_SCRIPT = path.join(ROOT, 'scripts', 'api-supervisor.ts');
const API_ENTRY = path.join(ROOT, 'apps', 'api', 'src', 'index.ts');

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
      await stopSupervisor({ silentIfMissing: true });
      await startSupervisor();
      return;
    default:
      throw new Error(`Unsupported command: ${process.argv[2] ?? '(missing)'}`);
  }
}

export function normalizeCommand(value: string | undefined): Command {
  const normalized = (value ?? 'status').toLowerCase();
  switch (normalized) {
    case 'start':
    case 'run':
    case 'status':
    case 'stop':
    case 'restart':
      return normalized as Command;
    default:
      return 'status';
  }
}

export function createInitialState(now: Date, supervisorPid: number | null): ApiSupervisorState {
  return {
    supervisorPid,
    childPid: null,
    status: 'init',
    startedAt: now.toISOString(),
    childStartedAt: null,
    lastExitCode: null,
    lastExitSignal: null,
    lastExitAt: null,
    lastError: null,
    restartCount: 0,
  };
}

export function calculateRestartDelayMs(restartCount: number) {
  const minMs = 5_000;
  const maxMs = 30_000;
  const delay = minMs * Math.pow(1.5, Math.min(Math.max(restartCount, 0), 10));
  return Math.min(Math.round(delay), maxMs);
}

async function startSupervisor() {
  ensureRuntimeDir();
  const existingStatus = await collectRuntimeStatus();

  if (existingStatus.supervisorRunning) {
    console.log('API supervisor is already running.');
    printHumanStatus(existingStatus);
    return;
  }

  if (existingStatus.processConflicts.length > 0) {
    throw new Error(
      `Refusing to start supervisor while unmanaged API process(es) exist: ${existingStatus.processConflicts
        .map((ref) => `${ref.pid}`)
        .join(', ')}`,
    );
  }

  const stdoutFd = fs.openSync(SUPERVISOR_LOG, 'a');
  const stderrFd = fs.openSync(SUPERVISOR_LOG, 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', SUPERVISOR_SCRIPT, 'run'], {
    cwd: ROOT,
    env: process.env,
    detached: true,
    stdio: ['ignore', stdoutFd, stderrFd],
    windowsHide: true,
  });

  child.unref();
  fs.closeSync(stdoutFd);
  fs.closeSync(stderrFd);

  await sleep(1000);
  const status = await collectRuntimeStatus();

  console.log(`Started API supervisor (pid ${child.pid ?? 'unknown'}).`);
  printHumanStatus(status);
}

async function runSupervisor() {
  ensureRuntimeDir();

  let stopping = false;
  let child: ReturnType<typeof spawn> | null = null;
  let state = createInitialState(new Date(), process.pid);
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
    child = startApiChild();
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
      lastError: exitResult.code === 0 ? null : `api exited with code ${exitResult.code ?? 'unknown'}`,
      restartCount: state.restartCount + 1,
    };
    persistState(state);

    const delayMs = calculateRestartDelayMs(state.restartCount);
    console.log(
      `[api-supervisor] API exited (code=${exitResult.code ?? 'null'}, signal=${exitResult.signal ?? 'null'}). ` +
        `Restart ${state.restartCount}, waiting ${delayMs}ms.`,
    );

    await sleep(delayMs);
  }

  if (child?.pid && isProcessRunning(child.pid)) {
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {
      // best-effort
    }
  }

  persistState({ ...state, status: 'stopped', supervisorPid: null, childPid: null });
}

function startApiChild() {
  const logFd = fs.openSync(CHILD_LOG, 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', API_ENTRY], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });
  fs.closeSync(logFd);
  return child;
}

async function stopSupervisor(options: { silentIfMissing?: boolean } = {}) {
  const status = await collectRuntimeStatus();

  if (!status.supervisorRunning) {
    if (!options.silentIfMissing) {
      console.log('API supervisor is not running.');
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
    if (!isMissingProcessError(error)) throw error;
  }

  const exited = await waitForProcessExit(supervisorPid, 15_000);
  if (!exited) {
    throw new Error(`Timed out waiting for supervisor ${supervisorPid} to stop.`);
  }

  console.log(`Stopped API supervisor (pid ${supervisorPid}).`);
}

async function printStatus() {
  const status = await collectRuntimeStatus();
  printHumanStatus(status);
}

function printHumanStatus(status: RuntimeStatus) {
  console.log(`Supervisor:  ${status.supervisorRunning ? 'RUNNING' : 'DOWN'}`);
  console.log(`Child:       ${status.childRunning ? 'RUNNING' : 'DOWN'}`);
  console.log(`Health:      ${status.health.status.toUpperCase()} - ${status.health.detail}`);
  console.log(`HTTP:        ${status.health.httpStatus ?? 'n/a'}`);
  console.log(`Restarts:    ${status.supervisorState.restartCount}`);
  console.log(`Port:        ${status.port}`);
  console.log(`Runtime:     ${status.paths.runtimeDir}`);
  console.log(`Logs:        ${status.paths.supervisorLog}`);
  console.log(`Child log:   ${status.paths.childLog}`);

  if (status.processConflicts.length > 0) {
    console.log('WARN: unmanaged API processes detected:');
    for (const ref of status.processConflicts) {
      console.log(`  - pid=${ref.pid} ${ref.commandLine}`);
    }
  }
}

async function collectRuntimeStatus(): Promise<RuntimeStatus> {
  ensureRuntimeDir();
  const state = readSupervisorState();
  const supervisorRunning = isProcessRunning(state.supervisorPid);
  const childRunning = isProcessRunning(state.childPid);
  const processConflicts = listUnmanagedApiProcesses(state);
  const port = readApiPort();
  const health = await readApiHealth(port, childRunning);

  return {
    supervisorState: state,
    supervisorRunning,
    childRunning,
    processConflicts,
    health,
    port,
    paths: {
      runtimeDir: RUNTIME_DIR,
      supervisorLog: SUPERVISOR_LOG,
      childLog: CHILD_LOG,
      stateFile: STATE_FILE,
    },
  };
}

async function readApiHealth(port: number, childRunning: boolean): Promise<ApiHealthCheck> {
  const timeout = AbortSignal.timeout(5_000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: timeout });
    const payload = (await response.json()) as Record<string, unknown>;
    const reportedStatus = payload['status'];
    if (reportedStatus === 'healthy' || reportedStatus === 'degraded') {
      return {
        status: response.ok ? reportedStatus : 'degraded',
        detail: buildHealthDetail(payload, response.status),
        httpStatus: response.status,
        payload,
      };
    }

    return {
      status: childRunning ? 'degraded' : 'down',
      detail: `Health endpoint returned unexpected payload (${response.status}).`,
      httpStatus: response.status,
      payload,
    };
  } catch (error) {
    return {
      status: childRunning ? 'degraded' : 'down',
      detail: `Health endpoint unreachable: ${error instanceof Error ? error.message : String(error)}`,
      httpStatus: null,
      payload: null,
    };
  }
}

export function buildHealthDetail(payload: Record<string, unknown>, statusCode: number) {
  const persistenceMode = typeof payload['persistenceMode'] === 'string' ? payload['persistenceMode'] : 'unknown';
  const runtimeMode = typeof payload['runtimeMode'] === 'string' ? payload['runtimeMode'] : 'unknown';
  const dbReachable = typeof payload['dbReachable'] === 'boolean' ? payload['dbReachable'] : null;
  const dbLabel = dbReachable == null ? 'dbReachable=n/a' : `dbReachable=${dbReachable ? 'yes' : 'no'}`;
  return `HTTP ${statusCode}, persistence=${persistenceMode}, runtime=${runtimeMode}, ${dbLabel}`;
}

function readApiPort() {
  const env = loadEnvironment();
  const parsed = Number.parseInt(env.PORT ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4000;
}

function readSupervisorState(): ApiSupervisorState {
  if (!fs.existsSync(STATE_FILE)) {
    return createInitialState(new Date(), null);
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ApiSupervisorState>;
    return { ...createInitialState(new Date(), null), ...parsed };
  } catch {
    return createInitialState(new Date(), null);
  }
}

function persistState(state: ApiSupervisorState) {
  ensureRuntimeDir();
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function ensureRuntimeDir() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

function isProcessRunning(pid: number | null): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function listUnmanagedApiProcesses(state: ApiSupervisorState): ProcessRef[] {
  return listProcessRefs()
    .filter(
      (ref) =>
        ref.commandLine.includes('apps\\api\\src\\index.ts') ||
        ref.commandLine.includes('apps/api/src/index.ts'),
    )
    .filter((ref) => ref.pid !== state.childPid && ref.pid !== state.supervisorPid);
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

    if (result.status !== 0 || !result.stdout.trim()) return [];

    const payload = JSON.parse(result.stdout) as
      | { ProcessId?: number; CommandLine?: string | null }
      | Array<{ ProcessId?: number; CommandLine?: string | null }>;
    const rows = Array.isArray(payload) ? payload : [payload];
    return rows
      .filter((row) => typeof row.ProcessId === 'number' && typeof row.CommandLine === 'string')
      .map((row) => ({ pid: row.ProcessId!, commandLine: row.CommandLine! }));
  }

  const result = spawnSync('ps', ['-axo', 'pid=,command='], { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout.trim()) return [];

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      return match ? { pid: Number.parseInt(match[1] ?? '', 10), commandLine: match[2] ?? '' } : null;
    })
    .filter((row): row is ProcessRef => row !== null && Number.isFinite(row.pid));
}

function isMissingProcessError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH';
}

function waitForExit(child: ReturnType<typeof spawn>) {
  return new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function waitForProcessExit(pid: number, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isProcessRunning(pid)) {
      return true;
    }
    await sleep(250);
  }
  return false;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[api-supervisor] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
