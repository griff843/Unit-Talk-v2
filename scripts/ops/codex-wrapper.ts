/**
 * Codex CLI wrapper for Windows compatibility
 *
 * The Codex companion script (codex-companion.mjs) spawns `codex app-server`
 * without shell:true, which fails on Windows because Node's spawn() can't
 * resolve .cmd shims. This wrapper patches the PATH and uses shell:true.
 *
 * Usage: npx tsx scripts/ops/codex-wrapper.ts [args...]
 *
 * This is a workaround until the upstream Codex plugin adds shell:true
 * on Windows (UTV2-681).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const isWindows = process.platform === 'win32';

function buildCodexChildEnv(cwd: string): NodeJS.ProcessEnv {
  const stateRoot = path.join(cwd, '.out', 'codex-pnpm-state');
  const dirs = {
    home: path.join(stateRoot, 'home'),
    store: path.join(stateRoot, 'store'),
    cache: path.join(stateRoot, 'cache'),
    state: path.join(stateRoot, 'state'),
    corepack: path.join(stateRoot, 'corepack'),
  };

  for (const dir of Object.values(dirs)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return {
    ...process.env,
    PNPM_HOME: dirs.home,
    COREPACK_HOME: dirs.corepack,
    NPM_CONFIG_CACHE: dirs.cache,
    NPM_CONFIG_STORE_DIR: dirs.store,
    NPM_CONFIG_STATE_DIR: dirs.state,
    npm_config_cache: dirs.cache,
    npm_config_store_dir: dirs.store,
    npm_config_state_dir: dirs.state,
  };
}

const child = spawn('codex', args, {
  stdio: 'inherit',
  shell: isWindows,
  env: buildCodexChildEnv(process.cwd()),
});

child.on('error', (err) => {
  console.error(`[codex-wrapper] spawn error: ${err.message}`);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
