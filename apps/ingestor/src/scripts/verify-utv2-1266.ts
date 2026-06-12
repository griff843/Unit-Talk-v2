// UTV2-1266 proof script — verifies SGO request contract changes
// Run: tsx apps/ingestor/src/scripts/verify-utv2-1266.ts
import assert from 'node:assert/strict';
import {
  buildSgoOddsRequestUrl,
  SGO_PLAYER_PROP_ODD_ID_PATTERNS,
} from '../sgo-request-contract.js';
import { sanitizeSGOUsageForLog } from '../sgo-fetcher.js';

const BASE_OPTS = {
  apiKey: 'test-key',
  league: 'NBA',
  snapshotAt: '2026-01-15T20:00:00.000Z',
};

// 1. includeAltLines must be absent from all request modes
const liveUrl = buildSgoOddsRequestUrl(BASE_OPTS);
assert.equal(
  liveUrl.searchParams.has('includeAltLines'),
  false,
  'includeAltLines must not be set in live mode',
);

const historicalUrl = buildSgoOddsRequestUrl({ ...BASE_OPTS, historical: true });
assert.equal(
  historicalUrl.searchParams.has('includeAltLines'),
  false,
  'includeAltLines must not be set in historical mode',
);

// 2. includeOpenCloseOdds must remain in historical mode
assert.equal(
  historicalUrl.searchParams.get('includeOpenCloseOdds'),
  'true',
  'includeOpenCloseOdds must be present in historical mode for CLV',
);

// 3. includeOpposingOdds must remain in all modes (paired markets)
assert.equal(
  liveUrl.searchParams.get('includeOpposingOdds'),
  'true',
  'includeOpposingOdds must be present in live mode',
);
assert.equal(
  historicalUrl.searchParams.get('includeOpposingOdds'),
  'true',
  'includeOpposingOdds must be present in historical mode',
);

// 4. bookmakerID=pinnacle present when pinnacleOnly=true
const pinnacleUrl = buildSgoOddsRequestUrl({ ...BASE_OPTS, pinnacleOnly: true });
assert.equal(
  pinnacleUrl.searchParams.get('bookmakerID'),
  'pinnacle',
  'bookmakerID=pinnacle must be set when pinnacleOnly=true',
);

// 5. bookmakerID absent when pinnacleOnly is not set
assert.equal(
  liveUrl.searchParams.has('bookmakerID'),
  false,
  'bookmakerID must be absent when pinnacleOnly is not set',
);

// 6. pinnacleOnly works in combination with historical (no conflict)
const historicalPinnacleUrl = buildSgoOddsRequestUrl({
  ...BASE_OPTS,
  historical: true,
  pinnacleOnly: true,
});
assert.equal(historicalPinnacleUrl.searchParams.get('bookmakerID'), 'pinnacle');
assert.equal(historicalPinnacleUrl.searchParams.has('includeAltLines'), false);
assert.equal(historicalPinnacleUrl.searchParams.get('includeOpenCloseOdds'), 'true');

// 7. playerPropOddIdPatterns sets oddID param with comma-joined patterns
const mlbPatterns = [...SGO_PLAYER_PROP_ODD_ID_PATTERNS.MLB];
const playerPropUrl = buildSgoOddsRequestUrl({
  ...BASE_OPTS,
  league: 'MLB',
  playerPropOddIdPatterns: mlbPatterns,
});
assert.equal(
  playerPropUrl.searchParams.get('oddID'),
  mlbPatterns.join(','),
  'playerPropOddIdPatterns must set oddID param with comma-joined patterns',
);
assert.equal(
  playerPropUrl.searchParams.has('bookmakerID'),
  false,
  'playerPropOddIdPatterns must not set bookmakerID',
);

// 8. playerPropOddIdPatterns takes precedence over pinnacleOnly
// (Pinnacle has no player-prop data — combining would return empty responses)
const mixedUrl = buildSgoOddsRequestUrl({
  ...BASE_OPTS,
  league: 'MLB',
  playerPropOddIdPatterns: mlbPatterns,
  pinnacleOnly: true,
});
assert.equal(
  mixedUrl.searchParams.get('oddID'),
  mlbPatterns.join(','),
  'oddID must be set when playerPropOddIdPatterns provided',
);
assert.equal(
  mixedUrl.searchParams.has('bookmakerID'),
  false,
  'pinnacleOnly must be ignored when playerPropOddIdPatterns is set',
);

// 9. sanitizeSGOUsageForLog redacts sensitive fields
const rawUsage = {
  plan: 'pro',
  objectsUsed: 42,
  keyID: 'secret-key-abc123',
  email: 'user@example.com',
  customerID: 'cust-999',
  resetAt: '2026-07-01T00:00:00Z',
};
const sanitized = sanitizeSGOUsageForLog(rawUsage) as Record<string, unknown>;
assert.equal(sanitized['keyID'], '[REDACTED]', 'keyID must be redacted');
assert.equal(sanitized['email'], '[REDACTED]', 'email must be redacted');
assert.equal(sanitized['customerID'], '[REDACTED]', 'customerID must be redacted');
assert.equal(sanitized['plan'], 'pro', 'non-sensitive fields must be preserved');
assert.equal(sanitized['objectsUsed'], 42, 'non-sensitive fields must be preserved');

// 10. SGO_PLAYER_PROP_ODD_ID_PATTERNS exported and non-empty for MLB and NBA
assert.ok(SGO_PLAYER_PROP_ODD_ID_PATTERNS.MLB.length > 0, 'MLB patterns must be non-empty');
assert.ok(SGO_PLAYER_PROP_ODD_ID_PATTERNS.NBA.length > 0, 'NBA patterns must be non-empty');

console.log('UTV2-1266 verification: ALL ASSERTIONS PASSED');
console.log('  ✓ includeAltLines absent (live mode)');
console.log('  ✓ includeAltLines absent (historical mode)');
console.log('  ✓ includeOpenCloseOdds preserved (historical mode)');
console.log('  ✓ includeOpposingOdds preserved (live + historical)');
console.log('  ✓ bookmakerID=pinnacle present when pinnacleOnly=true');
console.log('  ✓ bookmakerID absent when pinnacleOnly not set');
console.log('  ✓ pinnacleOnly + historical: no conflict');
console.log('  ✓ playerPropOddIdPatterns sets oddID param');
console.log('  ✓ playerPropOddIdPatterns takes precedence over pinnacleOnly');
console.log('  ✓ pinnacleOnly ignored when playerPropOddIdPatterns set');
console.log('  ✓ sanitizeSGOUsageForLog redacts keyID/email/customerID');
console.log('  ✓ SGO_PLAYER_PROP_ODD_ID_PATTERNS exported for MLB and NBA');
