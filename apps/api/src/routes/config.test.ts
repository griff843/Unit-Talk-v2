/**
 * WORK-2026110705 (separate narrow defect): the closing-data availability
 * handler used to convert any read error into 0 (indistinguishable from "no
 * closing data") and hid its 10k-row cap. These tests pin the corrected
 * behaviour: failure is UNKNOWN, truncation is visible.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { ApiRuntimeDependencies } from '../server.js';
import { FEATURE_AVAILABILITY_ROW_CAP, computeFeatureAvailability } from './config.js';

type OfferRow = { is_closing: boolean | null; bookmaker_key: string | null };

function runtimeWith(
  listRecentOffers: (since: string, limit?: number) => Promise<OfferRow[]>,
): ApiRuntimeDependencies {
  return {
    persistenceMode: 'database',
    repositories: { providerOffers: { listRecentOffers } },
  } as unknown as ApiRuntimeDependencies;
}

test('WORK-2026110705 proof 4 (config route): a read failure is UNKNOWN, never a silent zero', async () => {
  const availability = await computeFeatureAvailability(
    runtimeWith(async () => {
      throw new Error('Failed to list recent provider offers: statement timeout');
    }),
  );

  for (const signal of Object.values(availability)) {
    assert.equal(signal.available, false);
    assert.match(signal.reason, /UNKNOWN: provider offer read failed/);
    assert.match(signal.reason, /statement timeout/);
    assert.doesNotMatch(signal.reason, /zero is_closing|none found/);
  }
});

test('WORK-2026110705 (config route): hitting the row cap is visible and a zero in a capped sample does not claim absence', async () => {
  let requestedLimit: number | undefined;
  const capped = Array.from({ length: FEATURE_AVAILABILITY_ROW_CAP }, () => ({
    is_closing: false,
    bookmaker_key: 'draftkings',
  }));
  const availability = await computeFeatureAvailability(
    runtimeWith(async (_since, limit) => {
      requestedLimit = limit;
      return capped;
    }),
  );

  assert.equal(requestedLimit, FEATURE_AVAILABILITY_ROW_CAP);
  assert.equal(availability.closingLines.available, false);
  assert.match(availability.closingLines.reason, /capped sample — absence not established/);
  assert.match(availability.sharpConsensus.reason, /absence not established/);

  const withClosing = await computeFeatureAvailability(
    runtimeWith(async () => [
      ...capped.slice(0, FEATURE_AVAILABILITY_ROW_CAP - 1),
      { is_closing: true, bookmaker_key: 'pinnacle' },
    ]),
  );
  assert.equal(withClosing.closingLines.available, true);
  assert.match(withClosing.closingLines.reason, /count is a lower bound/);
});

test('WORK-2026110705 (config route): an uncapped read keeps the plain, truthful zero / present wording', async () => {
  const none = await computeFeatureAvailability(
    runtimeWith(async () => [{ is_closing: false, bookmaker_key: 'draftkings' }]),
  );
  assert.equal(none.closingLines.available, false);
  assert.match(none.closingLines.reason, /zero is_closing rows in provider_offer_history$/);

  const some = await computeFeatureAvailability(
    runtimeWith(async () => [{ is_closing: true, bookmaker_key: 'circa' }]),
  );
  assert.equal(some.closingLines.available, true);
  assert.equal(some.sharpConsensus.available, true);
  assert.doesNotMatch(some.closingLines.reason, /lower bound/);
});
