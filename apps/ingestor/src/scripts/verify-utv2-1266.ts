// UTV2-1266 proof script — verifies SGO request contract changes
// Run: tsx apps/ingestor/src/scripts/verify-utv2-1266.ts
import assert from 'node:assert/strict';
import { buildSgoOddsRequestUrl } from '../sgo-request-contract.js';

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

console.log('UTV2-1266 verification: ALL ASSERTIONS PASSED');
console.log('  ✓ includeAltLines absent (live mode)');
console.log('  ✓ includeAltLines absent (historical mode)');
console.log('  ✓ includeOpenCloseOdds preserved (historical mode)');
console.log('  ✓ includeOpposingOdds preserved (live + historical)');
console.log('  ✓ bookmakerID=pinnacle present when pinnacleOnly=true');
console.log('  ✓ bookmakerID absent when pinnacleOnly not set');
console.log('  ✓ pinnacleOnly + historical: no conflict');
