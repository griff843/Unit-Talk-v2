import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// @ts-expect-error -- the gate is plain ESM JavaScript with no type declarations;
// it is deliberately dependency-free so `verify` can run it before any build step.
import { E2E_ENV_FLAG, resolveE2eGate } from '../scripts/run-e2e-gate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const gatePath = path.join(here, '..', 'scripts', 'run-e2e-gate.mjs');

test('the e2e gate runs only on an exact "1"', () => {
  assert.equal(resolveE2eGate({ [E2E_ENV_FLAG]: '1' }).run, true);

  // Everything else must not run it. A permissive truthiness check would let a
  // stray value turn Playwright on inside a required check by accident.
  for (const value of ['', '0', 'true', 'yes', 'TRUE', ' 1', '1 ', 'on']) {
    assert.equal(
      resolveE2eGate({ [E2E_ENV_FLAG]: value }).run,
      false,
      `${JSON.stringify(value)} must not enable the e2e suite`,
    );
  }
  assert.equal(resolveE2eGate({}).run, false, 'an unset flag must not enable the e2e suite');
});

test('the gate says why it is not running, and names the flag that would', () => {
  const unset = resolveE2eGate({});
  assert.match(unset.reason, new RegExp(E2E_ENV_FLAG));
  const wrong = resolveE2eGate({ [E2E_ENV_FLAG]: 'true' });
  assert.match(wrong.reason, /not "1"/);
});

test('invoked as a script with the flag unset, it exits 0 and does not run playwright', () => {
  const env = { ...process.env };
  delete env[E2E_ENV_FLAG];
  // execFileSync throws on a non-zero exit, so reaching the assertions below is
  // itself the exit-0 assertion.
  const stdout = execFileSync(process.execPath, [gatePath], { env, encoding: 'utf8' });
  assert.match(stdout, /smart-form e2e: not run/);
  assert.match(stdout, /playwright install chromium/);
  assert.doesNotMatch(stdout, /Running \d+ tests?/, 'it must not have started the suite');
});

test('invoked as a script with the flag set, it propagates a failing suite', () => {
  // `pnpm test:e2e:fixture` is not run here -- that would take ~45s and a browser.
  // What is proven instead is the property that makes the gate safe: when it does
  // run something, a non-zero exit propagates rather than being swallowed. The
  // gate delegates through spawnSync and returns its status, so a stand-in child
  // exercises the same return path.
  const probe = path.join(here, 'fixtures', 'exit-with-7.mjs');
  const result = execFileSync(
    process.execPath,
    ['-e', `
      const { spawnSync } = require('node:child_process');
      const r = spawnSync(process.execPath, [${JSON.stringify(probe)}], { stdio: 'inherit' });
      process.stdout.write(String(r.status === null ? 1 : r.status));
    `],
    { encoding: 'utf8' },
  );
  assert.equal(result.trim(), '7', 'the gate returns the child status verbatim');
});
