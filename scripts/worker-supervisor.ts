/**
 * Worker supervisor — Phase 0B production hardening (T1-lite).
 *
 * T1-lite safety notes:
 * - Restart-vs-claim: worker uses SELECT FOR UPDATE SKIP LOCKED. A restarted worker
 *   will not re-claim a row held by the dying process. The stale claim reaper
 *   (staleClaimMs, default 5 min) handles orphaned claims. Minimum restart delay
 *   of 5s is enforced to let TCP/DB state settle before the new process opens
 *   connections.
 * - Duplicate delivery guard: confirmDeliveryAtomic is idempotent at the DB level.
 *   A delivery attempted by the dying worker and retried by the restarted worker
 *   will succeed exactly once (unique receipt constraint).
 * - Conflict detection: refuses to start if an unmanaged worker process exists.
 *
 * Usage:
 *   pnpm worker:start    — detach supervisor + worker as background processes
 *   pnpm worker:stop     — gracefully stop supervisor and worker
 *   pnpm worker:restart  — stop then start
 *   pnpm worker:status   — print current health
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadEnvironment } from '@unit-talk/config';
import {
  appendRestartAuditLog,
  createRestartAuditEntry,
  evaluateRestartRequest,
  readRestartAuditLog,
} from './restart-controls.js';

// ---------------------------------------------------------------------------
// Supervisor state
// ---------------------------------------------------------------------------

interface WorkerSupervisorState {
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

function createInitialState(now: Date, supervisorPid: number | null): WorkerSupervisorState {
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

/** Exponential backoff capped at 30 seconds. Minimum 5s for DB state to settle. */
function calculateRestartDelayMs(restartCount: number): number {
  const MIN_MS = 5_000;
  const MAX_MS = 30_000;
  const delay = MIN_MS * Math.pow(1.5, Math.min(restartCount, 10));
  return Math.min(Math.round(delay), MAX_MS);
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_DIR = path.join(ROOT, 'out', 'worker-runtime');
const SUPERVISOR_LOG = path.join(RUNTIME_DIR, 'supervisor.log');
const CHILD_LOG = path.join(RUNTIME_DIR, 'worker.log');
const STATE_FILE = path.join(RUNTIME_DIR, 'state.json');
const SUPERVISOR_SCRIPT = path.join(ROOT, 'scripts', 'worker-supervisor.ts');
const WORKER_ENTRY = path.join(ROOT, 'apps', 'worker', 'src', 'index.ts');
const RESTART_AUDIT_LOG = path.join(ROOT, 'out', 'runtime-control', 'restart-audit.jsonl');

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

type Command = 'start' | 'run' | 'status' | 'stop' | 'restart';

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
      enforceRestartPolicy('worker');
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
      return (value as string).toLowerCase() as Command;
    default:
      return 'status';
  }
}

// ---------------------------------------------------------------------------
// Supervisor lifecycle
// ---------------------------------------------------------------------------

async function startSupervisor() {
  ensureRuntimeDir();
  const existing = await collectRuntimeStatus();

  if (existing.supervisorRunning) {
    console.log('Worker supervisor is already running.');
    printHumanStatus(existing);
    return;
  }

  if (existing.processConflicts.length > 0) {
    throw new Error(
      `Refusing to start supervisor while unmanaged worker process(es) exist: ` +
        existing.processConflicts.map((ref) => String(ref.pid)).join(', '),
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
  console.log(`Started worker supervisor (pid ${child.pid ?? 'unknown'}).`);
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
    child = startWorkerChild();
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
      lastError:
        exitResult.code === 0
          ? null
          : `worker exited with code ${exitResult.code ?? 'unknown'}`,
      restartCount: state.restartCount + 1,
    };
    persistState(state);

    const delayMs = calculateRestartDelayMs(state.restartCount);
    console.log(
      `[worker-supervisor] Worker exited (code=${exitResult.code ?? 'null'}, signal=${exitResult.signal ?? 'null'}). ` +
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

function startWorkerChild() {
  const logFd = fs.openSync(CHILD_LOG, 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', WORKER_ENTRY], {
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
      console.log('Worker supervisor is not running.');
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

  console.log(`Stopped worker supervisor (pid ${supervisorPid}).`);
}

// ---------------------------------------------------------------------------
// Status + health
// ---------------------------------------------------------------------------

interface ProcessRef {
  pid: number;
  commandLine: string;
}

interface WorkerDbStatus {
  lastHeartbeatStatus: string | null;
  lastHeartbeatAt: string | null;
  pendingOutboxCount: number | null;
}

interface RuntimeStatus {
  supervisorState: WorkerSupervisorState;
  supervisorRunning: boolean;
  childRunning: boolean;
  processConflicts: ProcessRef[];
  db: WorkerDbStatus;
  heartbeatAgeMinutes: number | null;
  verdict: 'UP' | 'DEGRADED' | 'DOWN';
  paths: { runtimeDir: string; supervisorLog: string; childLog: string; stateFile: string };
}

async function printStatus() {
  const status = await collectRuntimeStatus();
  printHumanStatus(status);
}

function printHumanStatus(status: RuntimeStatus) {
  console.log(`Supervisor:  ${status.supervisorRunning ? 'RUNNING' : 'DOWN'}`);
  console.log(`Child:       ${status.childRunning ? 'RUNNING' : 'DOWN'}`);
  console.log(`Verdict:     ${status.verdict}`);
  console.log(`Restarts:    ${status.supervisorState.restartCount}`);
  console.log(`Last hb:     ${status.db.lastHeartbeatAt ?? 'none'} (${status.heartbeatAgeMinutes != null ? `${status.heartbeatAgeMinutes}m ago` : 'n/a'})`);
  console.log(`Pending:     ${status.db.pendingOutboxCount ?? 'unknown'} outbox rows`);
  console.log(`Runtime:     ${status.paths.runtimeDir}`);
  console.log(`Logs:        ${status.paths.supervisorLog}`);
  console.log(`Child log:   ${status.paths.childLog}`);

  if (status.processConflicts.length > 0) {
    console.log('WARN: unmanaged worker processes detected:');
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
  const processConflicts = listUnmanagedWorkerProcesses(state);
  const db = await readWorkerDbStatus();

  const heartbeatAgeMinutes =
    db.lastHeartbeatAt != null
      ? Math.round((Date.now() - new Date(db.lastHeartbeatAt).getTime()) / 60_000)
      : null;

  let verdict: 'UP' | 'DEGRADED' | 'DOWN';
  if (!childRunning && !supervisorRunning) {
    verdict = 'DOWN';
  } else if (heartbeatAgeMinutes != null && heartbeatAgeMinutes > 120) {
    verdict = 'DEGRADED';
  } else {
    verdict = 'UP';
  }

  return {
    supervisorState: state,
    supervisorRunning,
    childRunning,
    processConflicts,
    db,
    heartbeatAgeMinutes,
    verdict,
    paths: {
      runtimeDir: RUNTIME_DIR,
      supervisorLog: SUPERVISOR_LOG,
      childLog: CHILD_LOG,
      stateFile: STATE_FILE,
    },
  };
}

async function readWorkerDbStatus(): Promise<WorkerDbStatus> {
  const env = loadEnvironment();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { lastHeartbeatStatus: null, lastHeartbeatAt: null, pendingOutboxCount: null };
  }

  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const [{ data: runRows }, { count: pendingCount }] = await Promise.all([
    db
      .from('system_runs')
      .select('status, started_at')
      .eq('run_type', 'worker.heartbeat')
      .order('started_at', { ascending: false })
      .limit(1),
    db
      .from('distribution_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
  ]);

  return {
    lastHeartbeatStatus:
      typeof runRows?.[0]?.status === 'string' ? runRows[0].status : null,
    lastHeartbeatAt:
      typeof runRows?.[0]?.started_at === 'string' ? runRows[0].started_at : null,
    pendingOutboxCount: pendingCount ?? null,
  };
}

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

function readSupervisorState(): WorkerSupervisorState {
  if (!fs.existsSync(STATE_FILE)) {
    return createInitialState(new Date(), null);
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<WorkerSupervisorState>;
    return { ...createInitialState(new Date(), null), ...parsed };
  } catch {
    return createInitialState(new Date(), null);
  }
}

function persistState(state: WorkerSupervisorState) {
  ensureRuntimeDir();
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function ensureRuntimeDir() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

function enforceRestartPolicy(service: 'worker') {
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

  console.log(`[worker-supervisor] ${decision.message}`);
}

// ---------------------------------------------------------------------------
// Process utilities
// ---------------------------------------------------------------------------

function isProcessRunning(pid: number | null): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function listUnmanagedWorkerProcesses(state: WorkerSupervisorState): ProcessRef[] {
  return listProcessRefs()
    .filter(
      (ref) =>
        ref.commandLine.includes('apps\\worker\\src\\index.ts') ||
        ref.commandLine.includes('apps/worker/src/index.ts'),
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
    if (!isProcessRunning(pid)) return true;
    await sleep(250);
  }
  return false;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
