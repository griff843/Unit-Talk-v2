import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DELEGATION_STATE_PATH,
  readDelegationState,
  requireDelegationActive,
} from './delegation-state.js';
import { ROOT } from './shared.js';

function makeTmpStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'delegation-state-test-'));
}

function writeState(dir: string, contents: string, fileName = 'DELEGATION_STATE.json'): string {
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, contents, 'utf8');
  return filePath;
}

test('DELEGATION_STATE_PATH points at the canonical docs/05_operations location', () => {
  assert.strictEqual(
    DELEGATION_STATE_PATH,
    path.join(ROOT, 'docs', '05_operations', 'DELEGATION_STATE.json'),
  );
});

test('the real shipped DELEGATION_STATE.json exists and parses as a well-formed state (never malformed/missing)', () => {
  // Self-consistency check on the actual file this repo ships (UTV2-1546).
  // Deliberately does NOT assert a specific `delegation` value: that value is
  // expected to change over time as a human ratifies or suspends autonomous
  // delegation (see the file's own `updated_at`/`updated_by`/`reason`
  // fields). What must always hold is that the shipped file exists and is
  // strictly well-formed -- never missing, never malformed.
  assert.ok(fs.existsSync(DELEGATION_STATE_PATH), 'DELEGATION_STATE.json must exist on disk');
  const result = readDelegationState();
  assert.notStrictEqual(result.code, 'DELEGATION_STATE_MISSING');
  assert.notStrictEqual(result.code, 'DELEGATION_STATE_MALFORMED');
  assert.ok(
    result.state?.delegation === 'active' || result.state?.delegation === 'suspended',
    'shipped DELEGATION_STATE.json must have a valid delegation value',
  );
});

// --- missing file ---

test('missing file resolves to fail-closed DELEGATION_STATE_MISSING', () => {
  const dir = makeTmpStateDir();
  const missingPath = path.join(dir, 'does-not-exist.json');
  const result = readDelegationState(missingPath);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'DELEGATION_STATE_MISSING');
  assert.match(result.message, /not found/i);
  assert.strictEqual(result.state, undefined);
});

// --- malformed file ---

test('unparseable JSON resolves to fail-closed DELEGATION_STATE_MALFORMED', () => {
  const dir = makeTmpStateDir();
  const filePath = writeState(dir, '{ this is not valid json');
  const result = readDelegationState(filePath);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'DELEGATION_STATE_MALFORMED');
  assert.match(result.message, /not valid JSON/i);
});

test('a JSON array (not an object) resolves to fail-closed DELEGATION_STATE_MALFORMED', () => {
  const dir = makeTmpStateDir();
  const filePath = writeState(dir, '["active"]');
  const result = readDelegationState(filePath);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'DELEGATION_STATE_MALFORMED');
  assert.match(result.message, /must be a JSON object/i);
});

test('a JSON object missing the delegation field resolves to fail-closed DELEGATION_STATE_MALFORMED', () => {
  const dir = makeTmpStateDir();
  const filePath = writeState(dir, JSON.stringify({ schema_version: 1 }));
  const result = readDelegationState(filePath);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'DELEGATION_STATE_MALFORMED');
  assert.match(result.message, /invalid "delegation" value/i);
});

test('a delegation value that is not exactly "active" or "suspended" fails closed (no partial match, no case-insensitivity)', () => {
  const dir = makeTmpStateDir();
  for (const badValue of ['Active', 'ACTIVE', 'enabled', 'true', '1', '', null, 0, true]) {
    const filePath = writeState(dir, JSON.stringify({ delegation: badValue }));
    const result = readDelegationState(filePath);
    assert.strictEqual(result.ok, false, `delegation=${JSON.stringify(badValue)} must fail closed`);
    assert.strictEqual(result.code, 'DELEGATION_STATE_MALFORMED');
  }
});

test('an empty file resolves to fail-closed DELEGATION_STATE_MALFORMED, not a crash', () => {
  const dir = makeTmpStateDir();
  const filePath = writeState(dir, '');
  const result = readDelegationState(filePath);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'DELEGATION_STATE_MALFORMED');
});

// --- suspended ---

test('delegation: "suspended" resolves to a blocked DELEGATION_SUSPENDED result carrying the parsed state', () => {
  const dir = makeTmpStateDir();
  const filePath = writeState(
    dir,
    JSON.stringify({
      schema_version: 1,
      delegation: 'suspended',
      updated_at: '2026-07-19T00:00:00.000Z',
      updated_by: 'test',
      reason: 'default',
    }),
  );
  const result = readDelegationState(filePath);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'DELEGATION_SUSPENDED');
  assert.strictEqual(result.state?.delegation, 'suspended');
  assert.match(result.message, /suspended/i);
});

// --- active ---

test('delegation: "active" resolves to an unblocked DELEGATION_ACTIVE result carrying the parsed state', () => {
  const dir = makeTmpStateDir();
  const filePath = writeState(
    dir,
    JSON.stringify({
      schema_version: 1,
      delegation: 'active',
      updated_at: '2026-07-19T00:00:00.000Z',
      updated_by: 'test',
      reason: 'ratified',
    }),
  );
  const result = readDelegationState(filePath);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, 'DELEGATION_ACTIVE');
  assert.strictEqual(result.state?.delegation, 'active');
});

// --- requireDelegationActive: context prefix + pass-through ---

test('requireDelegationActive prefixes the message with the call-site context on failure', () => {
  const dir = makeTmpStateDir();
  const filePath = writeState(dir, JSON.stringify({ delegation: 'suspended' }));
  const result = requireDelegationActive('preflight', filePath);
  assert.strictEqual(result.ok, false);
  assert.match(result.message, /^\[preflight\]/);
});

test('requireDelegationActive passes through unchanged on success (no context prefix noise)', () => {
  const dir = makeTmpStateDir();
  const filePath = writeState(dir, JSON.stringify({ delegation: 'active' }));
  const result = requireDelegationActive('claude-exec', filePath);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, 'DELEGATION_ACTIVE');
});

test('requireDelegationActive fails closed with a context prefix even when the file is missing', () => {
  const dir = makeTmpStateDir();
  const result = requireDelegationActive('lane-start', path.join(dir, 'missing.json'));
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'DELEGATION_STATE_MISSING');
  assert.match(result.message, /^\[lane-start\]/);
});

// --- stale-token: delegation is independent of, and not bypassed by, preflight-token
// freshness. A caller holding an otherwise-valid (non-expired) preflight token must
// still be blocked when delegation is suspended -- readDelegationState/
// requireDelegationActive never look at, accept, or require any token/expiry input at
// all, so there is no code path by which token freshness could influence the result.

test('readDelegationState has no token/expiry parameter and cannot be short-circuited by a fresh or stale preflight token', () => {
  const dir = makeTmpStateDir();
  const filePath = writeState(dir, JSON.stringify({ delegation: 'suspended' }));
  // Calling with only (filePath) -- the full, real signature -- still blocks. There is
  // no second "token" argument to pass that could ever unblock this independent of the
  // delegation value itself.
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'delegation-state.ts'), 'utf8');
  const signatureStart = source.indexOf('export function readDelegationState');
  const signatureEnd = source.indexOf('{', signatureStart);
  assert.doesNotMatch(
    source.slice(signatureStart, signatureEnd),
    /token/i,
    'readDelegationState must not accept or depend on any token/expiry argument',
  );
  const result = readDelegationState(filePath);
  assert.strictEqual(result.ok, false);
});

test('lane-start.ts runs the delegation check before it ever reads/validates a preflight token', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  const delegationCallIndex = source.indexOf('requireDelegationActive(');
  const tokenValidationIndex = source.indexOf('validatePreflightToken(');
  assert.ok(delegationCallIndex >= 0, 'lane-start.ts must call requireDelegationActive');
  assert.ok(tokenValidationIndex >= 0, 'lane-start.ts must still call validatePreflightToken');
  assert.ok(
    delegationCallIndex < tokenValidationIndex,
    'delegation kill switch must be checked before preflight token validation, so a stale-but-otherwise-valid token can never bypass it',
  );
});

test('preflight.ts runs the delegation check before it removes or writes the preflight token', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  const delegationCallIndex = source.indexOf('requireDelegationActive(');
  const firstTokenWriteIndex = source.indexOf('writeJsonFile(\n        tokenPath');
  assert.ok(delegationCallIndex >= 0, 'preflight.ts must call requireDelegationActive');
  assert.ok(firstTokenWriteIndex > 0, 'preflight.ts must still write a token on PASS');
  assert.ok(
    delegationCallIndex < firstTokenWriteIndex,
    'delegation kill switch must be checked before any preflight token is written',
  );
});

// --- existing-lane-execution: codex-exec.ts/claude-exec.ts execute a lane whose
// manifest (and worktree) already exist -- exactly the "resume" path these two entry
// points always take. The delegation check must still gate the actual executor spawn
// even though the manifest, lease, and worktree all already exist from an earlier,
// pre-suspension lane-start.

test('codex-exec.ts checks delegation after loading the existing manifest but strictly before spawning codex', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'codex-exec.ts'), 'utf8');
  const manifestReadIndex = source.indexOf('readManifest(issueId)');
  const delegationCallIndex = source.indexOf('requireDelegationActive(');
  const spawnIndex = source.indexOf("spawnSync('codex', codexArgs");
  assert.ok(manifestReadIndex >= 0, 'codex-exec.ts must read the existing manifest');
  assert.ok(delegationCallIndex >= 0, 'codex-exec.ts must call requireDelegationActive');
  assert.ok(spawnIndex >= 0, 'codex-exec.ts must spawn the codex CLI');
  assert.ok(
    manifestReadIndex < delegationCallIndex,
    'delegation check runs on the existing-manifest (resume) path, not only for brand-new lanes',
  );
  assert.ok(
    delegationCallIndex < spawnIndex,
    'delegation kill switch must gate the codex spawn even for an already-started lane',
  );
});

test('claude-exec.ts checks delegation after loading the existing manifest but strictly before spawning claude', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'claude-exec.ts'), 'utf8');
  const manifestReadIndex = source.indexOf('readManifest(issueId)');
  const delegationCallIndex = source.indexOf('requireDelegationActive(');
  const spawnIndex = source.indexOf("runner('claude', claudeArgs");
  assert.ok(manifestReadIndex >= 0, 'claude-exec.ts must read the existing manifest');
  assert.ok(delegationCallIndex >= 0, 'claude-exec.ts must call requireDelegationActive');
  assert.ok(spawnIndex >= 0, 'claude-exec.ts must spawn the claude CLI');
  assert.ok(
    manifestReadIndex < delegationCallIndex,
    'delegation check runs on the existing-manifest (resume) path, not only for brand-new lanes',
  );
  assert.ok(
    delegationCallIndex < spawnIndex,
    'delegation kill switch must gate the claude spawn even for an already-started lane',
  );
});

test('codex-exec.ts and claude-exec.ts exit with code 2 when delegation is suspended, matching the existing PRECONDITION_FAILED exit-code convention', () => {
  const codexSource = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'codex-exec.ts'), 'utf8');
  const claudeSource = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'claude-exec.ts'), 'utf8');

  const codexDelegationBlock = codexSource.slice(
    codexSource.indexOf('requireDelegationActive('),
    codexSource.indexOf('requireDelegationActive(') + 400,
  );
  assert.match(codexDelegationBlock, /DELEGATION_SUSPENDED/);
  assert.match(codexDelegationBlock, /process\.exit\(2\)/);

  const claudeDelegationBlock = claudeSource.slice(
    claudeSource.indexOf('requireDelegationActive('),
    claudeSource.indexOf('requireDelegationActive(') + 400,
  );
  assert.match(claudeDelegationBlock, /DELEGATION_SUSPENDED/);
  assert.match(claudeDelegationBlock, /return 2/);
});

test('lane-start.ts runs the delegation check before any lease reservation, worktree creation, or manifest write', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-start.ts'), 'utf8');
  const delegationCallIndex = source.indexOf('requireDelegationActive(');
  const reserveLeaseIndex = source.indexOf('reserveLease(');
  const createBranchIndex = source.indexOf('createBranchAndWorktree(');
  const createManifestIndex = source.indexOf('createManifest(');
  assert.ok(delegationCallIndex >= 0, 'lane-start.ts must call requireDelegationActive');
  for (const [label, index] of [
    ['reserveLease', reserveLeaseIndex],
    ['createBranchAndWorktree', createBranchIndex],
    ['createManifest', createManifestIndex],
  ] as const) {
    assert.ok(index >= 0, `lane-start.ts must still call ${label}`);
    assert.ok(
      delegationCallIndex < index,
      `delegation kill switch must run before ${label}`,
    );
  }
});

test('preflight.ts declares a distinct check id for the delegation kill switch and fails the verdict closed', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'preflight.ts'), 'utf8');
  assert.match(source, /id: 'PK1'/, 'preflight.ts should record the delegation check under its own check id');
  assert.match(source, /requireDelegationActive\('preflight'\)/);
});
