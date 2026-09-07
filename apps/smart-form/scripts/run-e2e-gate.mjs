#!/usr/bin/env node
// UTV2-1850 — the execution site for apps/smart-form's Playwright suite.
//
// The suite exists and works (`pnpm test:e2e:fixture`, 25 specs), and until this
// lane nothing ran it: UTV2-1847 rewrote the Playwright config but touched no
// package script and no workflow, and the three qa workflows each run the
// qa-agent's own Playwright project rather than this one.
//
// `verify:static` already invokes `pnpm --filter @unit-talk/smart-form verify`,
// so this package's own `verify` script is an execution site that is reached by
// the required `verify` check with no workflow edit. That is exactly why the
// wiring is gated rather than unconditional: running Playwright there would also
// require `playwright install chromium --with-deps` inside a REQUIRED check,
// which changes what that check does and how long it takes. `ci.yml` never
// mentions Playwright today. That is a decision about required-check behaviour,
// not a scripting detail, and UTV2-1850 acceptance 4 says explicitly that if it
// cannot be made defensibly within this lane's tier it is left opt-in and
// recorded rather than slipped in.
//
// So: the wiring is complete and fails closed the moment the flag is set, and
// setting it in CI is a separate, reviewable one-line change.
//
// Fail-closed direction matters here. The gate defaults to NOT running, which is
// a coverage decision, never a correctness one -- when it does run, a failing
// suite fails `verify`. It cannot report success for a suite that failed.

import { spawnSync } from 'node:child_process';

export const E2E_ENV_FLAG = 'UNIT_TALK_SMART_FORM_E2E';

/**
 * Pure. Decides whether the e2e suite runs, from the environment alone.
 *
 * Exactly `'1'` enables it. Anything else -- unset, empty, `'0'`, `'true'`,
 * `'yes'` -- does not. A permissive truthiness check would let a stray value
 * turn Playwright on inside a required check by accident, which is the thing
 * this gate exists to keep deliberate.
 */
export function resolveE2eGate(env) {
  const raw = env[E2E_ENV_FLAG];
  if (raw === '1') {
    return { run: true, reason: `${E2E_ENV_FLAG}=1` };
  }
  return {
    run: false,
    reason: raw === undefined
      ? `${E2E_ENV_FLAG} is not set`
      : `${E2E_ENV_FLAG} is ${JSON.stringify(raw)}, not "1"`,
  };
}

function main() {
  const gate = resolveE2eGate(process.env);
  if (!gate.run) {
    process.stdout.write(
      `smart-form e2e: not run (${gate.reason}).\n`
      + `Set ${E2E_ENV_FLAG}=1 to run it. It requires a Playwright browser:\n`
      + '  pnpm exec playwright install chromium --with-deps\n',
    );
    return 0;
  }
  process.stdout.write(`smart-form e2e: running (${gate.reason})\n`);
  const result = spawnSync('pnpm', ['test:e2e:fixture'], { stdio: 'inherit' });
  if (result.error) {
    process.stderr.write(`smart-form e2e: failed to start playwright: ${result.error.message}\n`);
    return 1;
  }
  // A signal death has a null status. Treating that as success would report a
  // killed suite as a passing one, which is the failure this file must not have.
  return result.status === null ? 1 : result.status;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
