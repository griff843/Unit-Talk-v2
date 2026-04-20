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

const args = process.argv.slice(2);
const isWindows = process.platform === 'win32';

const child = spawn('codex', args, {
  stdio: 'inherit',
  shell: isWindows,
  env: process.env,
});

child.on('error', (err) => {
  console.error(`[codex-wrapper] spawn error: ${err.message}`);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
