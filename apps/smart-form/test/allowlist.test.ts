import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findAllowedCapper,
  normalizeEmail,
  parseAllowedCapperEmails,
} from '../lib/auth-allowlist.ts';

test('normalizeEmail trims and lowercases emails', () => {
  assert.equal(normalizeEmail('  Griff@UnitTalk.com '), 'griff@unittalk.com');
});

test('parseAllowedCapperEmails builds a de-duped allowlist from explicit mappings', () => {
  assert.deepEqual(
    parseAllowedCapperEmails(
      'Griff@UnitTalk.com=griff843, alex.smith+props@UnitTalk.com=alex-props, griff@unittalk.com=griff843',
    ),
    [
      { email: 'griff@unittalk.com', capperId: 'griff843' },
      { email: 'alex.smith+props@unittalk.com', capperId: 'alex-props' },
    ],
  );
});

test('findAllowedCapper matches only allowlisted emails', () => {
  const allowed = parseAllowedCapperEmails('griff@unittalk.com=griff843');

  assert.deepEqual(findAllowedCapper('GRIFF@unittalk.com', allowed), {
    email: 'griff@unittalk.com',
    capperId: 'griff843',
  });
  assert.equal(findAllowedCapper('unknown@unittalk.com', allowed), null);
  assert.equal(findAllowedCapper(null, allowed), null);
});

// --- UTV2-1824 acceptance controls ---

test('UTV2-1824: an authorized login resolves to its explicitly mapped canonical id, not the email local-part', () => {
  // The whole point of this lane. The local-part here is deliberately NOT the
  // canonical id: under the previous derivation this resolved to the
  // local-part, which then became the persisted `submittedBy` of a real pick.
  // No credential is asserted here — the address is a shape, and authorization
  // itself remains environment-controlled.
  const allowed = parseAllowedCapperEmails('someone.else@example.com=griff843');
  const capper = findAllowedCapper('Someone.Else@Example.com', allowed);

  assert.ok(capper, 'an explicitly mapped login must be admitted');
  assert.equal(capper.capperId, 'griff843');
  assert.notEqual(
    capper.capperId,
    'someone-else',
    'the canonical id must not be derived from the email local-part',
  );
});

test('UTV2-1824: an entry with no explicit mapping is rejected and admits nobody', () => {
  // Fail closed. The dangerous regression is not "returns a different id" but
  // "silently falls back to the local-part and lets the login through".
  for (const value of [
    'someone.else@example.com',
    'someone.else@example.com=',
    'someone.else@example.com=   ',
    '=griff843',
    'not-an-email=griff843',
  ]) {
    const allowed = parseAllowedCapperEmails(value);
    assert.deepEqual(allowed, [], `expected no approved cappers for ${JSON.stringify(value)}`);
    assert.equal(
      findAllowedCapper('someone.else@example.com', allowed),
      null,
      `an unmapped entry must not admit the login: ${JSON.stringify(value)}`,
    );
  }
});

test('UTV2-1824: a non-canonical capper id is refused rather than sanitised', () => {
  // Sanitising is what produced this defect: the old code repaired whatever it
  // was given instead of refusing it. A mapping that does not already carry a
  // canonical id must admit nobody.
  for (const value of [
    'someone.else@example.com=Griff 843',
    'someone.else@example.com=griff.843',
    'someone.else@example.com=-griff843',
    'someone.else@example.com=griff843=extra',
  ]) {
    assert.deepEqual(
      parseAllowedCapperEmails(value),
      [],
      `expected a non-canonical id to be refused: ${JSON.stringify(value)}`,
    );
  }
});

test('an empty or unset ALLOWED_CAPPER_EMAILS admits nobody', () => {
  // UTV2-1786: sign-in authority is environment-controlled only. There is no
  // compiled-in allowlist, so an unconfigured deployment must fail closed
  // rather than fall back to a hard-coded account. This test fails if any
  // permanent allowlist entry is reintroduced.
  for (const value of [undefined, '', '   ', ',,']) {
    const allowed = parseAllowedCapperEmails(value);
    assert.deepEqual(allowed, [], `expected no approved cappers for ${JSON.stringify(value)}`);
    assert.equal(findAllowedCapper('someone.else@example.com', allowed), null);
    assert.equal(findAllowedCapper('anyone@example.com', allowed), null);
  }
});

test('the allowlist module exports no compiled-in capper constant', async () => {
  const allowlistModule: Record<string, unknown> = await import('../lib/auth-allowlist.ts');
  const emailBearingExports = Object.entries(allowlistModule).filter(
    ([, value]) => typeof value !== 'function' && (JSON.stringify(value ?? null) ?? '').includes('@'),
  );
  assert.deepEqual(
    emailBearingExports.map(([name]) => name),
    [],
    'auth-allowlist must not export a constant containing an email address',
  );
});

test('UTV2-1824: the local-part derivation helper is gone from the module surface', async () => {
  // The defect was an exported function that any future caller could reach
  // for. Removing the call site is not enough while the function still exists.
  const allowlistModule: Record<string, unknown> = await import('../lib/auth-allowlist.ts');
  assert.equal(
    'deriveCapperIdFromEmail' in allowlistModule,
    false,
    'deriveCapperIdFromEmail must not be exported',
  );
});
