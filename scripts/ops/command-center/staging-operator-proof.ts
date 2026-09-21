/** Real browser + API + staging DB proof. Never starts workers or sends Discord messages. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvironment } from '@unit-talk/config';
import { isApprovedStagingTarget } from '@unit-talk/db';
import { createApiServer } from '../../../apps/api/src/server.js';

async function exitCode(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}
async function main() {
  // Check the resolved target before creating a DB client, starting an API or seeding anything.
  const initial = loadEnvironment();
  assert.equal(isApprovedStagingTarget(initial.SUPABASE_URL), true, 'Operator browser proof requires the approved staging project');
  const apiKey = randomUUID();
  process.env.UNIT_TALK_CC_API_KEY = apiKey;
  process.env.UNIT_TALK_API_RUNTIME_MODE = 'fail_closed';
  process.env.DISCORD_BOT_TOKEN = '';
  const environment = loadEnvironment();
  const api = createApiServer({ environment });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  const address = api.address();
  assert.ok(address && typeof address !== 'string');
  const apiUrl = `http://127.0.0.1:${address.port}`;
  let ui: ChildProcess | undefined;
  const output = path.resolve('.out/command-center-staging');
  await mkdir(output, { recursive: true });
  const log = createWriteStream(path.join(output, 'next.log'));
  try {
    const submission = await fetch(`${apiUrl}/api/submissions`, {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'api', market: 'nba-spread', selection: `UTV2-1950 proof browser ${randomUUID()}`, line: -2.5, odds: -110, stakeUnits: 1, confidence: 58,
        metadata: { distributionMode: 'track-only', proof_issue: 'UTV2-1950', testRun: randomUUID() } }),
    });
    const body = await submission.json() as { ok?: boolean; data?: { pickId?: string; lifecycleState?: string }; error?: unknown };
    assert.equal(submission.status, 201, `Staging fixture submission failed: ${JSON.stringify(body)}`);
    assert.equal(body.ok, true);
    assert.equal(body.data?.lifecycleState, 'validated');
    assert.ok(body.data?.pickId);
    const childEnv = { ...process.env, NODE_ENV: 'production', UNIT_TALK_APP_ENV: 'test',
      SUPABASE_URL: environment.SUPABASE_URL!, SUPABASE_ANON_KEY: environment.SUPABASE_ANON_KEY!, SUPABASE_SERVICE_ROLE_KEY: environment.SUPABASE_SERVICE_ROLE_KEY!,
      UNIT_TALK_API_URL: apiUrl, UNIT_TALK_CC_API_KEY: apiKey,
      COMMAND_CENTER_AUTH_USERNAME: 'staging-operator', COMMAND_CENTER_AUTH_PASSWORD: randomUUID(),
      COMMAND_CENTER_AUTH_TOKEN: randomUUID(), COMMAND_CENTER_OPERATOR_IDENTITY: 'staging-proof-operator',
      PLAYWRIGHT_BASE_URL: 'http://localhost:4308', CC_STAGING_PICK_ID: body.data.pickId, CC_STAGING_PROOF_OUTPUT: output,
    };
    ui = spawn('pnpm', ['--filter', '@unit-talk/command-center', 'exec', 'next', 'start', '--hostname', '127.0.0.1', '--port', '4308'],
      { env: childEnv, stdio: ['ignore', log, log], detached: true });
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (ui.exitCode !== null) throw new Error('Staging Command Center exited before readiness; inspect next.log');
      try { const response = await fetch('http://127.0.0.1:4308/picks', { signal: AbortSignal.timeout(1_000) }); ready = response.status === 401; } catch { /* Await startup. */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(ready, true, 'Staging UI did not expose its ordinary sign-in entry');
    const browser = spawn('pnpm', ['--filter', '@unit-talk/command-center', 'exec', 'playwright', 'test', '--config', 'playwright.staging.config.ts'],
      { env: childEnv, stdio: 'inherit' });
    assert.equal(await exitCode(browser), 0, 'Staging operator browser proof failed');
  } finally {
    if (ui?.pid) { try { process.kill(-ui.pid, 'SIGTERM'); } catch { /* Already exited. */ } }
    log.end();
    api.closeAllConnections();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
