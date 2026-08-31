import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveCapperIdFromEmail,
  findAllowedCapper,
  normalizeEmail,
  parseAllowedCapperEmails,
} from '../lib/auth-allowlist.ts';

test('normalizeEmail trims and lowercases emails', () => {
  assert.equal(normalizeEmail('  Griff@UnitTalk.com '), 'griff@unittalk.com');
});

test('parseAllowedCapperEmails builds a de-duped allowlist with derived capper ids', () => {
  assert.deepEqual(
    parseAllowedCapperEmails('Griff@UnitTalk.com, alex.smith+props@UnitTalk.com, griff@unittalk.com'),
    [
      { email: 'griff@unittalk.com', capperId: 'griff' },
      { email: 'alex.smith+props@unittalk.com', capperId: 'alex-smith-props' },
    ],
  );
});

test('findAllowedCapper matches only allowlisted emails', () => {
  const allowed = parseAllowedCapperEmails('griff@unittalk.com');

  assert.deepEqual(findAllowedCapper('GRIFF@unittalk.com', allowed), {
    email: 'griff@unittalk.com',
    capperId: 'griff',
  });
  assert.equal(findAllowedCapper('unknown@unittalk.com', allowed), null);
  assert.equal(findAllowedCapper(null, allowed), null);
});

test('deriveCapperIdFromEmail returns a stable local-part id', () => {
  assert.equal(deriveCapperIdFromEmail('Capper.Name+NBA@UnitTalk.com'), 'capper-name-nba');
});

test('an empty or unset ALLOWED_CAPPER_EMAILS admits nobody', () => {
  // UTV2-1786: sign-in authority is environment-controlled only. There is no
  // compiled-in allowlist, so an unconfigured deployment must fail closed
  // rather than fall back to a hard-coded account. This test fails if any
  // permanent allowlist entry is reintroduced.
  for (const value of [undefined, '', '   ', ',,']) {
    const allowed = parseAllowedCapperEmails(value);
    assert.deepEqual(allowed, [], `expected no approved cappers for ${JSON.stringify(value)}`);
    assert.equal(findAllowedCapper('griffadavi@gmail.com', allowed), null);
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
