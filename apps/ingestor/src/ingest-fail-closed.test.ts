/**
 * UTV2-1155: Fail-closed startup checks for missing provider secrets.
 *
 * Proves that:
 * - ingestLeague logs a warning and returns status:'skipped' when SGO_API_KEY is absent
 *   (the startup guard in index.ts prevents this path in production)
 * - ingestOddsApiLeague logs a warning and returns status:'skipped' when ODDS_API_KEY is absent
 * - collectConfiguredSgoApiKeyCandidates returns an empty array when no SGO env vars are set,
 *   which is the condition the startup guard checks to halt the daemon
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createInMemoryIngestorRepositoryBundle } from '@unit-talk/db';

import { ingestLeague } from './ingest-league.js';
import { ingestOddsApiLeague } from './ingest-odds-api.js';
import { collectConfiguredSgoApiKeyCandidates } from './sgo-key-manager.js';

test('ingestLeague returns skipped with warning when SGO_API_KEY is absent', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const warnings: string[] = [];
  const logger = {
    warn: (msg: string) => { warnings.push(msg); },
    info: () => {},
  };

  const result = await ingestLeague('NBA', undefined, repositories, { logger });

  assert.equal(result.status, 'skipped', 'expected skipped status when apiKey is absent');
  assert.ok(
    warnings.some((w) => w.includes('SGO_API_KEY missing')),
    `Expected SGO_API_KEY warning, got: ${JSON.stringify(warnings)}`,
  );
});

test('ingestOddsApiLeague emits warning log when ODDS_API_KEY is absent', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const warnings: string[] = [];
  const logger = {
    warn: (msg: string) => { warnings.push(msg); },
    info: () => {},
  };

  const result = await ingestOddsApiLeague({
    league: 'NBA',
    repositories,
    logger,
  });

  assert.equal(result.status, 'skipped');
  assert.ok(
    warnings.some((w) => w.includes('ODDS_API_KEY')),
    `Expected ODDS_API_KEY warning, got: ${JSON.stringify(warnings)}`,
  );
});

test('collectConfiguredSgoApiKeyCandidates returns empty array when no SGO env vars set', () => {
  // This is the condition that triggers the startup fail-closed guard in index.ts.
  // When sgoApiKeys.length === 0 and autorun === true, the daemon exits with code 1.
  const candidates = collectConfiguredSgoApiKeyCandidates({
    SGO_API_KEY: undefined,
    SGO_API_KEY_FALLBACK: undefined,
    SGO_API_KEYS: undefined,
  });

  assert.equal(candidates.length, 0, 'no candidates when SGO env vars are absent');
});
