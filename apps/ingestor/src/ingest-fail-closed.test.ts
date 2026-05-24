/**
 * UTV2-1155: Fail-closed startup checks for missing provider secrets.
 *
 * Proves that:
 * - ingestLeague logs a warning and returns status:'skipped' when SGO_API_KEY is absent
 * - ingestOddsApiLeague logs a warning and returns status:'skipped' when ODDS_API_KEY is absent
 * - collectConfiguredSgoApiKeyCandidates returns an empty array when no SGO env vars are set,
 *   which is one condition the startup guard checks before halting the daemon
 * - the real startup module exits only when autorun has no configured provider mode
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createInMemoryIngestorRepositoryBundle } from '@unit-talk/db';

import { ingestLeague } from './ingest-league.js';
import { ingestOddsApiLeague } from './ingest-odds-api.js';
import { collectConfiguredSgoApiKeyCandidates } from './sgo-key-manager.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '../../..');
const startupEntry = resolve(currentDir, 'index.ts');
const tsxBin = resolve(repoRoot, 'node_modules/.bin/tsx');

interface StartupProbeOptions {
  autorun: boolean;
  oddsApiKey?: string | undefined;
}

function runStartupProbe(options: StartupProbeOptions) {
  const probeDir = mkdtempSync(join(tmpdir(), 'utv2-ingestor-startup-'));
  const runnerPath = join(probeDir, 'runner.mjs');
  writeFileSync(
    runnerPath,
    `
      process.chdir(${JSON.stringify(probeDir)});
      globalThis.fetch = async () => new Response('[]', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-requests-remaining': '500',
          'x-requests-last': '1'
        }
      });
      await import(${JSON.stringify(startupEntry)});
    `,
    'utf8',
  );

  try {
    return spawnSync(tsxBin, [runnerPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        NODE_ENV: 'test',
        UNIT_TALK_APP_ENV: 'local',
        UNIT_TALK_LEGACY_WORKSPACE: 'legacy-test',
        LINEAR_TEAM_KEY: 'UTV2',
        LINEAR_TEAM_NAME: 'Unit Talk V2',
        NOTION_WORKSPACE_NAME: 'Unit Talk',
        SLACK_WORKSPACE_NAME: 'Unit Talk',
        UNIT_TALK_INGESTOR_AUTORUN: options.autorun ? 'true' : 'false',
        UNIT_TALK_INGESTOR_MAX_CYCLES: '1',
        UNIT_TALK_INGESTOR_LEAGUES: 'NBA',
        UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_MODE: 'fail_closed',
        ...(options.oddsApiKey ? { ODDS_API_KEY: options.oddsApiKey } : {}),
      },
    });
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

function parseFatalJson(stderr: string) {
  const fatalMarker = stderr.indexOf('"status": "fatal"');
  assert.notEqual(fatalMarker, -1, `expected fatal JSON in stderr, got: ${stderr}`);
  const start = stderr.lastIndexOf('{', fatalMarker);
  assert.notEqual(start, -1, `expected fatal JSON in stderr, got: ${stderr}`);
  return JSON.parse(stderr.slice(start)) as {
    status?: string;
    error?: string;
    providers?: { sgo?: string; oddsApi?: string };
  };
}

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
  // This is one condition in the startup fail-closed guard in index.ts. The
  // daemon exits only when autorun is true and no provider credential exists.
  const candidates = collectConfiguredSgoApiKeyCandidates({
    SGO_API_KEY: undefined,
    SGO_API_KEY_FALLBACK: undefined,
    SGO_API_KEYS: undefined,
  });

  assert.equal(candidates.length, 0, 'no candidates when SGO env vars are absent');
});

test('startup exits non-zero with fatal JSON when autorun has no configured provider', () => {
  const result = runStartupProbe({ autorun: true });

  assert.equal(result.status, 1);
  const fatal = parseFatalJson(result.stderr);
  assert.equal(fatal.status, 'fatal');
  assert.match(fatal.error ?? '', /startup_provider_missing/);
  assert.match(fatal.error ?? '', /ODDS_API_KEY/);
  assert.equal(fatal.providers?.sgo, 'missing');
  assert.equal(fatal.providers?.oddsApi, 'missing');
});

test('startup preserves Odds API-only autorun mode', () => {
  const result = runStartupProbe({ autorun: true, oddsApiKey: 'odds-only-test-key' });

  assert.equal(result.status, 0, `stderr=${result.stderr}\nstdout=${result.stdout}`);
  assert.doesNotMatch(result.stderr, /startup_provider_missing/);
  assert.doesNotMatch(result.stderr, /"status": "fatal"/);
  assert.match(result.stdout, /"oddsApi": "configured"/);
});

test('startup summary does not exit fatally when non-autorun has no SGO key', () => {
  const result = runStartupProbe({ autorun: false });

  assert.equal(result.status, 0, `stderr=${result.stderr}\nstdout=${result.stdout}`);
  assert.doesNotMatch(result.stderr, /startup_provider_missing/);
  assert.doesNotMatch(result.stderr, /"status": "fatal"/);
  assert.match(result.stdout, /"autorun": false/);
  assert.match(result.stdout, /"sgo": "missing"/);
});
