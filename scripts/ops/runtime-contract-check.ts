import { execSync } from 'node:child_process';

interface CheckResult {
  name: string;
  ok: boolean;
  message: string;
  level: 'fail' | 'warn' | 'pass';
}

interface Output {
  ok: boolean;
  checks: CheckResult[];
}

const CODEX_MIN_VERSION = [0, 1, 0];

function parseVersion(raw: string): number[] | null {
  const m = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

function versionGte(v: number[], min: number[]): boolean {
  for (let i = 0; i < 3; i++) {
    if ((v[i] ?? 0) > (min[i] ?? 0)) return true;
    if ((v[i] ?? 0) < (min[i] ?? 0)) return false;
  }
  return true;
}

function run(cmd: string): { stdout: string; ok: boolean } {
  try {
    const stdout = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { stdout, ok: true };
  } catch {
    return { stdout: '', ok: false };
  }
}

function checkCodexCli(): CheckResult {
  const result = run('codex exec --help');
  if (result.ok && result.stdout.includes('exec')) {
    return { name: 'codex-cli', ok: true, message: 'codex exec subcommand available', level: 'pass' };
  }
  // Try to detect if codex exists at all
  const versionResult = run('codex --version');
  if (!versionResult.ok) {
    return { name: 'codex-cli', ok: false, message: 'codex CLI not found', level: 'fail' };
  }
  return { name: 'codex-cli', ok: false, message: 'codex exec subcommand not present — CLI may be outdated', level: 'fail' };
}

function checkGhCli(): CheckResult {
  const result = run('gh auth status');
  if (result.ok) {
    return { name: 'gh-cli', ok: true, message: 'gh auth status passed', level: 'pass' };
  }
  return { name: 'gh-cli', ok: false, message: 'gh auth status failed — run: gh auth login', level: 'fail' };
}

function checkLinear(): CheckResult {
  const token = process.env.LINEAR_API_TOKEN;
  if (!token) {
    return { name: 'linear', ok: false, message: 'LINEAR_API_TOKEN not set', level: 'fail' };
  }
  // Basic connectivity check via curl
  const result = run(
    `curl -sf -X POST https://api.linear.app/graphql -H "Authorization: ${token}" -H "Content-Type: application/json" -d '{"query":"{ teams { nodes { id } } }"}'`
  );
  if (result.ok && result.stdout.includes('"teams"')) {
    return { name: 'linear', ok: true, message: 'Linear API reachable and token valid', level: 'pass' };
  }
  return { name: 'linear', ok: false, message: 'Linear API query failed — check LINEAR_API_TOKEN', level: 'fail' };
}

function checkNodeVersion(): CheckResult {
  const raw = process.version; // e.g. "v20.11.0"
  const m = raw.match(/v(\d+)/);
  const major = m ? parseInt(m[1], 10) : 0;
  if (major >= 20) {
    return { name: 'node-version', ok: true, message: `Node ${raw} >= 20`, level: 'pass' };
  }
  return { name: 'node-version', ok: false, message: `Node ${raw} < 20 required`, level: 'fail' };
}

function checkCodexVersion(): CheckResult {
  const result = run('codex --version');
  if (!result.ok) {
    return { name: 'codex-version', ok: false, message: 'codex --version failed — CLI missing', level: 'fail' };
  }
  const ver = parseVersion(result.stdout.trim());
  if (!ver) {
    return { name: 'codex-version', ok: false, message: `Could not parse codex version: ${result.stdout.trim()}`, level: 'warn' };
  }
  if (versionGte(ver, CODEX_MIN_VERSION)) {
    return { name: 'codex-version', ok: true, message: `codex ${result.stdout.trim()} >= ${CODEX_MIN_VERSION.join('.')}`, level: 'pass' };
  }
  return { name: 'codex-version', ok: false, message: `codex ${ver.join('.')} < minimum ${CODEX_MIN_VERSION.join('.')}`, level: 'warn' };
}

function main(): void {
  const useJson = process.argv.includes('--json');

  const checks: CheckResult[] = [
    checkCodexCli(),
    checkGhCli(),
    checkLinear(),
    checkNodeVersion(),
    checkCodexVersion(),
  ];

  const hardFails = checks.filter((c) => !c.ok && c.level === 'fail');
  const ok = hardFails.length === 0;

  const output: Output = { ok, checks };

  if (useJson) {
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  } else {
    for (const c of checks) {
      const icon = c.ok ? '✓' : c.level === 'warn' ? '⚠' : '✗';
      process.stdout.write(`  [${icon}] ${c.name}: ${c.message}\n`);
    }
    process.stdout.write(`\n${ok ? 'PASS' : 'FAIL'} — ${hardFails.length} failure(s)\n`);
  }

  if (!ok) process.exit(1);
}

main();
