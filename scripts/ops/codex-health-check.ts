/**
 * UTV2-681: Codex CLI health check
 *
 * Verifies Codex CLI is available and functional before dispatch.
 * Returns structured JSON result for use by /dispatch skill.
 *
 * Usage:
 *   npx tsx scripts/ops/codex-health-check.ts
 *   npx tsx scripts/ops/codex-health-check.ts --json
 *
 * Exit codes:
 *   0 = healthy (Codex CLI available and responsive)
 *   1 = unhealthy (Codex CLI not found, not responsive, or spawn error)
 */

import { spawnSync } from 'node:child_process';

interface HealthCheckResult {
  healthy: boolean;
  codex_available: boolean;
  codex_version: string | null;
  error: string | null;
  platform: string;
  checked_at: string;
}

function checkCodexAvailability(): HealthCheckResult {
  const checkedAt = new Date().toISOString();
  const platform = process.platform;

  try {
    // On Windows, spawn without shell: true cannot resolve .cmd shims.
    // Use shell: true to match how the user's terminal resolves 'codex'.
    const result = spawnSync('codex', ['--version'], {
      encoding: 'utf8',
      stdio: 'pipe',
      shell: platform === 'win32',
      timeout: 10_000,
    });

    if (result.error) {
      const errCode = (result.error as NodeJS.ErrnoException).code;
      return {
        healthy: false,
        codex_available: false,
        codex_version: null,
        error: errCode === 'ENOENT'
          ? `Codex CLI not found on PATH. On Windows, ensure codex.cmd is accessible. Error: ${result.error.message}`
          : `Codex CLI spawn error: ${result.error.message}`,
        platform,
        checked_at: checkedAt,
      };
    }

    if (result.status !== 0) {
      return {
        healthy: false,
        codex_available: false,
        codex_version: null,
        error: `Codex CLI exited with status ${result.status}: ${result.stderr?.trim() || 'unknown error'}`,
        platform,
        checked_at: checkedAt,
      };
    }

    const version = result.stdout?.trim() || 'unknown';

    return {
      healthy: true,
      codex_available: true,
      codex_version: version,
      error: null,
      platform,
      checked_at: checkedAt,
    };
  } catch (err) {
    return {
      healthy: false,
      codex_available: false,
      codex_version: null,
      error: `Health check exception: ${err instanceof Error ? err.message : String(err)}`,
      platform,
      checked_at: checkedAt,
    };
  }
}

const result = checkCodexAvailability();
const jsonMode = process.argv.includes('--json');

if (jsonMode) {
  console.log(JSON.stringify(result, null, 2));
} else {
  if (result.healthy) {
    console.log(`[codex-health] HEALTHY — ${result.codex_version} on ${result.platform}`);
  } else {
    console.log(`[codex-health] UNHEALTHY — ${result.error}`);
    console.log(`  Platform: ${result.platform}`);
    console.log(`  Recommendation: Route T2 work to Claude until Codex CLI is fixed`);
  }
}

process.exitCode = result.healthy ? 0 : 1;
