import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_DIR = path.join(ROOT, 'out', 'ingestor-runtime');
const STATE_FILE = path.join(RUNTIME_DIR, 'state.json');
const env = loadEnvironment();
const state = readState();
const container = readContainer();
const supervisorRunning = isRunning(state.supervisorPid);
const childRunning = isRunning(state.childPid);
const db = await readDb();
const health = evaluateHealth({
  autorun: env.UNIT_TALK_INGESTOR_AUTORUN === 'true',
  pollIntervalMs: positiveInt(env.UNIT_TALK_INGESTOR_POLL_MS, 300000),
  supervisorRunning,
  childRunning,
  restartCount: state.restartCount,
  latestRunStatus: db.latestRunStatus,
  latestRunStartedAt: db.latestRunStartedAt,
  latestOfferUpdatedAt: db.latestOfferUpdatedAt,
});

console.log(`Docker:     ${container.running ? 'RUNNING' : 'DOWN'} (${container.status ?? 'no ingestor container from docker ps'})`);
console.log(`Docker at:  ${container.startedAt ?? 'none'}`);
console.log('Docker ps:');
console.log(container.psOutput || '  (no running ingestor containers)');
console.log(`Supervisor: ${supervisorRunning ? 'RUNNING' : 'DOWN'}`);
console.log(`Child:      ${childRunning ? 'RUNNING' : 'DOWN'}`);
console.log(`Health:     ${health.status.toUpperCase()} - ${health.summary}`);
console.log(`Restarts:   ${state.restartCount}`);
console.log(`Run status: ${db.latestRunStatus ?? 'none'}`);
console.log(`Run at:     ${db.latestRunStartedAt ?? 'none'}`);
console.log(`Offer at:   ${db.latestOfferUpdatedAt ?? 'none'}`);
console.log(`Runtime:    ${RUNTIME_DIR}`);
console.log(`Logs:       ${path.join(RUNTIME_DIR, 'supervisor.log')}`);
console.log(`Child log:  ${path.join(RUNTIME_DIR, 'ingestor.log')}`);
for (const fact of health.facts) console.log(`  * ${fact}`);

function loadEnvironment() {
  return { ...envFile('.env.example'), ...envFile('.env'), ...envFile('local.env'), ...process.env };
}

function envFile(name) {
  const filePath = path.join(ROOT, name);
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals <= 0) continue;
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readState() {
  const fallback = {
    supervisorPid: null,
    childPid: null,
    status: 'starting',
    startedAt: new Date().toISOString(),
    childStartedAt: null,
    restartCount: 0,
    lastExitCode: null,
    lastExitSignal: null,
    lastExitAt: null,
    lastError: null,
  };
  if (!fs.existsSync(STATE_FILE)) return fallback;
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
  } catch {
    return fallback;
  }
}

function readContainer() {
  const ps = spawnSync('docker', ['ps', '--filter', 'name=ingestor'], { encoding: 'utf8' });
  const parsed = spawnSync('docker', ['ps', '--filter', 'name=ingestor', '--format', '{{.Names}}\t{{.Status}}'], { encoding: 'utf8' });
  if (ps.error || ps.status !== 0 || parsed.error || parsed.status !== 0) {
    const error = ps.error ?? parsed.error;
    return {
      running: false,
      healthy: false,
      psOutput: ps.stderr?.trim() || parsed.stderr?.trim() || (error instanceof Error ? error.message : ''),
      status: null,
      startedAt: null,
    };
  }
  const rows = parsed.stdout.split(/\r?\n/u).filter((line) => line.trim());
  const runningRows = rows.filter((line) => /\bUp\b/i.test(line));
  return {
    running: runningRows.length > 0,
    healthy: runningRows.some((line) => !/\bunhealthy\b/i.test(line)),
    psOutput: ps.stdout.trim(),
    status: runningRows[0]?.split('\t')[1] ?? rows[0]?.split('\t')[1] ?? null,
    startedAt: null,
  };
}

async function readDb() {
  const [runs, offers] = await Promise.all([
    rest('/rest/v1/system_runs?select=status,started_at&run_type=eq.ingestor.cycle&order=started_at.desc&limit=1'),
    rest('/rest/v1/provider_offers?select=snapshot_at&order=snapshot_at.desc&limit=1'),
  ]);
  return {
    latestRunStatus: typeof runs?.[0]?.status === 'string' ? runs[0].status : null,
    latestRunStartedAt: typeof runs?.[0]?.started_at === 'string' ? runs[0].started_at : null,
    latestOfferUpdatedAt: typeof offers?.[0]?.snapshot_at === 'string' ? offers[0].snapshot_at : null,
  };
}

async function rest(urlPath) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return [];
  const response = await fetch(`${env.SUPABASE_URL}${urlPath}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!response.ok) {
    console.log(`  * DB query failed: HTTP ${response.status} ${await response.text()}`);
    return [];
  }
  return await response.json();
}

function evaluateHealth(input, now = new Date()) {
  if (!input.autorun) return { status: 'down', summary: 'Ingestor autorun is disabled.', facts: ['Set UNIT_TALK_INGESTOR_AUTORUN=true before starting supervised runtime.'] };
  if (!input.supervisorRunning) return { status: 'down', summary: 'Supervisor is not running.', facts: ['Use the repo supervisor start command to keep ingestor alive.'] };
  if (!input.childRunning) return { status: 'degraded', summary: 'Supervisor is running, but the ingestor child is currently down.', facts: [`restartCount=${input.restartCount}`] };
  if (!input.latestRunStartedAt) return { status: 'degraded', summary: 'Supervisor is up, but the ingestor has not recorded a cycle yet.', facts: ['No ingestor.cycle rows recorded yet.'] };
  const facts = [`lastCycleAgeMs=${now.getTime() - new Date(input.latestRunStartedAt).getTime()}`];
  const runFreshnessMs = Math.max(input.pollIntervalMs * 2, 15 * 60_000);
  const offerFreshnessMs = Math.max(input.pollIntervalMs * 2, 20 * 60_000);
  if (input.latestRunStatus === 'failed') {
    facts.push('Latest ingestor.cycle row is failed.');
    return { status: 'degraded', summary: 'Ingestor is running, but the latest cycle failed.', facts };
  }
  if (now.getTime() - new Date(input.latestRunStartedAt).getTime() > runFreshnessMs * 2) {
    facts.push(`runFreshnessThresholdMs=${runFreshnessMs}`);
    return { status: 'down', summary: 'Ingestor cycle heartbeat is stale.', facts };
  }
  if (!input.latestOfferUpdatedAt) return { status: 'degraded', summary: 'Ingestor cycles are running, but no provider offers have been written yet.', facts };
  const offerAgeMs = now.getTime() - new Date(input.latestOfferUpdatedAt).getTime();
  facts.push(`latestOfferAgeMs=${offerAgeMs}`);
  if (offerAgeMs > offerFreshnessMs * 2) {
    facts.push(`offerFreshnessThresholdMs=${offerFreshnessMs}`);
    return { status: 'down', summary: 'Provider offer freshness is stale even though the ingestor is running.', facts };
  }
  return { status: 'healthy', summary: 'Supervisor, ingestor child, and ingest freshness all look healthy.', facts };
}

function isRunning(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
