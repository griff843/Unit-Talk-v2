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
