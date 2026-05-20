import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execSync } from 'node:child_process';

// Helper to run the script and capture output
function runScript(args: string[] = [], env: NodeJS.ProcessEnv = {}): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execSync(
      `npx tsx ${__dirname}/runtime-contract-check.ts ${args.join(' ')}`,
      {
        encoding: 'utf8',
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    return { stdout, stderr: '', code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.status ?? 1 };
  }
}

test('--json flag emits valid JSON with ok and checks fields', () => {
  const result = runScript(['--json']);
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    assert.fail(`stdout is not valid JSON: ${result.stdout}`);
  }
  assert.ok(parsed !== null && typeof parsed === 'object', 'output is an object');
  const output = parsed as Record<string, unknown>;
  assert.ok('ok' in output, 'output has ok field');
  assert.ok('checks' in output, 'output has checks field');
  assert.ok(Array.isArray(output.checks), 'checks is an array');
});

test('--json output has exactly 5 checks', () => {
  const result = runScript(['--json']);
  const output = JSON.parse(result.stdout) as { checks: unknown[] };
  assert.strictEqual(output.checks.length, 5, 'should have exactly 5 checks');
});

test('each check has name, ok, message, and level fields', () => {
  const result = runScript(['--json']);
  const output = JSON.parse(result.stdout) as { checks: Record<string, unknown>[] };
  for (const check of output.checks) {
    assert.ok(typeof check.name === 'string', `check.name should be string, got ${typeof check.name}`);
    assert.ok(typeof check.ok === 'boolean', `check.ok should be boolean, got ${typeof check.ok}`);
    assert.ok(typeof check.message === 'string', `check.message should be string, got ${typeof check.message}`);
    assert.ok(['fail', 'warn', 'pass'].includes(check.level as string), `check.level should be fail/warn/pass, got ${check.level}`);
  }
});

test('node-version check passes (Node >= 20 required)', () => {
  const result = runScript(['--json']);
  const output = JSON.parse(result.stdout) as { checks: Array<{ name: string; ok: boolean }> };
  const nodeCheck = output.checks.find((c) => c.name === 'node-version');
  assert.ok(nodeCheck, 'node-version check should be present');
  // This test environment should have Node >= 20
  const major = parseInt(process.version.replace('v', ''), 10);
  if (major >= 20) {
    assert.strictEqual(nodeCheck.ok, true, 'node-version check should pass on Node 20+');
  }
});

test('missing LINEAR_API_TOKEN causes linear check to fail', () => {
  const result = runScript(['--json'], { LINEAR_API_TOKEN: '' });
  const output = JSON.parse(result.stdout) as { checks: Array<{ name: string; ok: boolean; message: string }> };
  const linearCheck = output.checks.find((c) => c.name === 'linear');
  assert.ok(linearCheck, 'linear check should be present');
  assert.strictEqual(linearCheck.ok, false, 'linear check should fail without token');
  assert.ok(linearCheck.message.includes('LINEAR_API_TOKEN'), 'message should mention token');
});
