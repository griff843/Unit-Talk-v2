/**
 * Issue a signed capper JWT for use with the smart-form login.
 *
 * Usage:
 *   UNIT_TALK_JWT_SECRET=<secret> tsx apps/api/src/scripts/issue-capper-token.ts \
 *     --capperId griff843 \
 *     --displayName "Griff" \
 *     [--email griff@example.com] \
 *     [--expires 365d]
 *
 * The token is written to stdout. Share it with the capper — they paste it
 * into the smart-form login page once and it is stored in localStorage.
 */

import { signCapperToken } from '../auth.js';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i]?.startsWith('--')) {
      const key = argv[i]!.slice(2);
      const value = argv[i + 1];
      if (value && !value.startsWith('--')) {
        args[key] = value;
        i++;
      }
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const capperId = args['capperId'];
const displayName = args['displayName'] ?? capperId;
const email = args['email'];
const expires = args['expires'];
const secret = process.env['UNIT_TALK_JWT_SECRET']?.trim();

if (!capperId) {
  console.error('Error: --capperId is required');
  process.exit(1);
}

if (!secret) {
  console.error('Error: UNIT_TALK_JWT_SECRET env var is required');
  process.exit(1);
}

const token = await signCapperToken(
  { sub: capperId, capperId, displayName: displayName ?? capperId, ...(email ? { email } : {}) },
  secret,
  expires,
);

console.log('\nCapper JWT issued successfully.\n');
console.log('Token:');
console.log(token);
console.log('\nShare this token with the capper. They paste it into the smart-form login page.');
if (expires) {
  console.log(`Expires: ${expires} from now.`);
} else {
  console.log('No expiry set — token is valid indefinitely.');
}
