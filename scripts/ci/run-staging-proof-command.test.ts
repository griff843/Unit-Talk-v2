/**
 * UTV2-1827 — negative tests for the governed staging proof runner.
 *
 * `admit()` is deliberately separated from the spawn so that every refusal path
 * is exercised here with no database, no network and no credential. Each test
 * below fails if the corresponding guard is removed:
 *
 *   * drop the `resolveStagingProofCommand` call  -> the unknown-key tests fail
 *   * drop the `assertStagingTarget` call         -> the production-target and
 *                                                    unresolvable-target tests fail
 *   * drop the `--receipt` requirement            -> the missing-receipt test fails
 *
 * The workflow-shape tests below cover the parts of the security model that
 * live in YAML rather than TypeScript — environment binding, ref pinning, and
 * the absence of production credentials — because a runner that refuses
 * correctly is worth nothing if the job around it hands over broader secrets.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { admit, admitRef, parseArgs, REFUSAL_EXIT_CODE } from './run-staging-proof-command.js';
import { STAGING_PROOF_COMMAND_KEYS } from './staging-proof-commands.js';

const APPROVED_STAGING_URL = 'https://xskgrzbteyqdufktjrjx.supabase.co';
const CANONICAL_PRODUCTION_URL = 'https://zfzdnfwdarxucxtaojxm.supabase.co';
const ADMITTED_KEY = 'canonical-reference-bootstrap';

const stagingEnv = (): Record<string, string | undefined> => ({
  SUPABASE_URL: APPROVED_STAGING_URL,
});

test('parseArgs reads only the two flags it declares', () => {
  const parsed = parseArgs(['--command-key', ADMITTED_KEY, '--receipt', '.out/r.json']);
  assert.equal(parsed.commandKey, ADMITTED_KEY);
  assert.equal(parsed.receiptPath, '.out/r.json');
});

test('parseArgs ignores an unrecognised flag rather than treating it as a command', () => {
  // There is no pass-through: extra argv cannot become part of the spawned
  // command, because the spawned command comes from the registry, not from here.
  const parsed = parseArgs(['--command', 'pnpm exec tsx scripts/anything.ts']);
  assert.equal(parsed.commandKey, null);
  assert.equal(parsed.receiptPath, null);
});

test('admits an allowlisted key against the approved staging project', () => {
  const decision = admit(
    { commandKey: ADMITTED_KEY, receiptPath: '.out/receipt.json' },
    stagingEnv(),
  );
  assert.equal(decision.refused, false);
  if (decision.refused) return;
  assert.equal(decision.command.key, ADMITTED_KEY);
  assert.equal(decision.assertion.observedRef, 'xskgrzbteyqdufktjrjx');
});

test('refuses an unknown command key before any spawn decision is reached', () => {
  const decision = admit(
    { commandKey: 'not-a-key', receiptPath: '.out/receipt.json' },
    stagingEnv(),
  );
  assert.equal(decision.refused, true);
  if (!decision.refused) return;
  assert.match(decision.reason, /Unknown staging proof command key/u);
});

test('refuses a free-form command line supplied in place of a key', () => {
  const decision = admit(
    {
      commandKey: 'pnpm exec tsx scripts/exfiltrate.ts',
      receiptPath: '.out/receipt.json',
    },
    stagingEnv(),
  );
  assert.equal(decision.refused, true);
});

test('refuses an arbitrary path supplied in place of a key', () => {
  const decision = admit(
    { commandKey: '../../etc/passwd', receiptPath: '.out/receipt.json' },
    stagingEnv(),
  );
  assert.equal(decision.refused, true);
});

test('refuses the canonical PRODUCTION project even with a valid key', () => {
  const decision = admit({ commandKey: ADMITTED_KEY, receiptPath: '.out/receipt.json' }, {
    SUPABASE_URL: CANONICAL_PRODUCTION_URL,
  });
  assert.equal(decision.refused, true);
  if (!decision.refused) return;
  assert.match(decision.reason, /CANONICAL PRODUCTION/u);
});

test('refuses a target whose identity cannot be resolved from its URL', () => {
  const decision = admit({ commandKey: ADMITTED_KEY, receiptPath: '.out/receipt.json' }, {
    SUPABASE_URL: 'https://xskgrzbteyqdufktjrjx.evil.example',
  });
  assert.equal(decision.refused, true);
});

test('refuses when no target is configured at all', () => {
  const decision = admit({ commandKey: ADMITTED_KEY, receiptPath: '.out/receipt.json' }, {});
  assert.equal(decision.refused, true);
});

test('refuses when no receipt path is given — an unrecorded run proves nothing', () => {
  const decision = admit({ commandKey: ADMITTED_KEY, receiptPath: null }, stagingEnv());
  assert.equal(decision.refused, true);
  if (!decision.refused) return;
  assert.match(decision.reason, /--receipt/u);
});

test('the refusal exit code is distinct from a plausible command exit code', () => {
  // A refusal must never be readable as "the proof command ran and failed".
  assert.equal(REFUSAL_EXIT_CODE, 78);
  assert.notEqual(REFUSAL_EXIT_CODE, 0);
  assert.notEqual(REFUSAL_EXIT_CODE, 1);
});

// ---------------------------------------------------------------------------
// Ref admission
// ---------------------------------------------------------------------------
//
// The registry is only as trustworthy as the commit it is read from: anyone who
// can push a branch can rewrite staging-proof-commands.ts on that branch. These
// tests fail if the ancestry requirement is dropped or made permissive.

const HEAD = 'a'.repeat(40);

test('admits a commit that is reachable from the default branch', () => {
  const decision = admitRef({ headSha: HEAD, isAncestorOfDefault: true });
  assert.equal(decision.ok, true);
});

test('refuses an unapproved ref — a commit not reachable from the default branch', () => {
  const decision = admitRef({ headSha: HEAD, isAncestorOfDefault: false });
  assert.equal(decision.ok, false);
  assert.match(decision.reason, /not reachable from the default branch/u);
});

test('refuses when ancestry cannot be determined, rather than assuming it', () => {
  // Shallow clone, missing remote ref, git failure. "Cannot tell" is a refusal:
  // the value of this gate is that it is not guessable.
  const decision = admitRef({ headSha: HEAD, isAncestorOfDefault: null });
  assert.equal(decision.ok, false);
  assert.match(decision.reason, /could not determine/u);
});

test('refuses when the checked-out commit cannot be resolved at all', () => {
  const decision = admitRef({ headSha: null, isAncestorOfDefault: true });
  assert.equal(decision.ok, false);
});

// ---------------------------------------------------------------------------
// Workflow shape
// ---------------------------------------------------------------------------

const workflowPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '.github',
  'workflows',
  'staging-proof-runner.yml',
);
const workflow = readFileSync(workflowPath, 'utf8');

test('the runner job binds the staging-ci environment', () => {
  assert.match(workflow, /^\s{4}environment:\s*staging-ci\s*$/mu);
});

test('the workflow references no production Supabase secret', () => {
  for (const forbidden of [
    'secrets.SUPABASE_URL',
    'secrets.SUPABASE_SERVICE_ROLE_KEY',
    'secrets.SUPABASE_DB_URL',
    'secrets.SUPABASE_ANON_KEY',
  ]) {
    assert.ok(!workflow.includes(forbidden), `workflow references ${forbidden}`);
  }
});

test('the dispatch input is a closed choice list matching the registry exactly', () => {
  // A `type: string` input here would reintroduce the free-form command surface
  // the registry exists to remove, even though the runner would still refuse it.
  assert.match(workflow, /command_key:[\s\S]*?type:\s*choice/u);
  for (const key of STAGING_PROOF_COMMAND_KEYS) {
    assert.ok(workflow.includes(`- ${key}`), `workflow choice list is missing ${key}`);
  }
});

test('checkout is pinned to the dispatched ref rather than the default branch', () => {
  assert.match(workflow, /ref:\s*\$\{\{\s*inputs\.ref\s*\}\}/u);
});

test('the receipt is uploaded under a run-scoped artifact name', () => {
  // A run-scoped name is what stops a previous run's receipt from being
  // substituted for this one.
  assert.match(workflow, /github\.run_id\s*\}\}-\$\{\{\s*github\.run_attempt/u);
  assert.match(workflow, /if-no-files-found:\s*error/u);
});

test('the checkout has the history the ancestry check needs', () => {
  // `merge-base --is-ancestor` on a depth-1 clone cannot answer, and the runner
  // refuses on "cannot tell" — so a shallow checkout would make every dispatch
  // fail closed. Full history plus an explicit fetch of the default branch is
  // what makes the gate answerable.
  assert.match(workflow, /fetch-depth:\s*0/u);
  assert.match(workflow, /git fetch origin main/u);
});

test('credentials are scrubbed even when the proof command fails', () => {
  assert.match(workflow, /name:\s*Scrub credentials[\s\S]*?if:\s*always\(\)/u);
});
