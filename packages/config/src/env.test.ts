import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadEnvironment } from './env.js';

test('loadEnvironment preserves both configured SGO API keys in priority order', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-env-'));

  fs.writeFileSync(
    path.join(rootDir, '.env.example'),
    [
      'UNIT_TALK_LEGACY_WORKSPACE=C:\\\\dev\\\\unit-talk-production',
      'LINEAR_TEAM_KEY=UTV2',
      'LINEAR_TEAM_NAME=unit-talk-v2',
      'NOTION_WORKSPACE_NAME=unit-talk-v2',
      'SLACK_WORKSPACE_NAME=unit-talk-v2',
      'SGO_API_KEY=template-key',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(rootDir, '.env'),
    ['SGO_API_KEY=primary-key', 'SGO_API_KEY=secondary-key'].join('\n'),
  );
  fs.writeFileSync(path.join(rootDir, 'local.env'), 'SGO_API_KEY_FALLBACK=fallback-key\n');

  const env = loadEnvironment(rootDir);

  assert.equal(env.SGO_API_KEY, 'secondary-key');
  assert.equal(env.SGO_API_KEY_FALLBACK, 'fallback-key');
  assert.deepEqual(env.SGO_API_KEYS, ['template-key', 'primary-key', 'secondary-key', 'fallback-key']);

  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('loadEnvironment exposes provider-offer staging mode from env files', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-env-stage-'));

  fs.writeFileSync(
    path.join(rootDir, '.env.example'),
    [
      'UNIT_TALK_LEGACY_WORKSPACE=C:\\\\dev\\\\unit-talk-production',
      'LINEAR_TEAM_KEY=UTV2',
      'LINEAR_TEAM_NAME=unit-talk-v2',
      'NOTION_WORKSPACE_NAME=unit-talk-v2',
      'SLACK_WORKSPACE_NAME=unit-talk-v2',
      'UNIT_TALK_PROVIDER_OFFER_STAGING_MODE=off',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(rootDir, '.env'),
    'UNIT_TALK_PROVIDER_OFFER_STAGING_MODE=stage_only\n',
  );

  const env = loadEnvironment(rootDir);

  assert.equal(env.UNIT_TALK_PROVIDER_OFFER_STAGING_MODE, 'stage_only');

  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('loadEnvironment exposes provider ingestion DB and archive policy env vars', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-env-provider-policy-'));

  fs.writeFileSync(
    path.join(rootDir, '.env.example'),
    [
      'UNIT_TALK_LEGACY_WORKSPACE=C:\\\\dev\\\\unit-talk-production',
      'LINEAR_TEAM_KEY=UTV2',
      'LINEAR_TEAM_NAME=unit-talk-v2',
      'NOTION_WORKSPACE_NAME=unit-talk-v2',
      'SLACK_WORKSPACE_NAME=unit-talk-v2',
      'UNIT_TALK_INGESTOR_DB_STATEMENT_TIMEOUT_MS=15000',
      'UNIT_TALK_INGESTOR_DB_LOCK_TIMEOUT_MS=5000',
      'UNIT_TALK_INGESTOR_DB_MAX_BATCH_SIZE=500',
      'UNIT_TALK_INGESTOR_DB_MERGE_CHUNK_SIZE=250',
      'UNIT_TALK_INGESTOR_DB_RETRY_MAX_ATTEMPTS=2',
      'UNIT_TALK_INGESTOR_DB_RETRY_BACKOFF_MS=1000',
      'UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_MODE=fail_open',
      'UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_DIR=out/provider-payload-archive',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(rootDir, '.env'),
    [
      'UNIT_TALK_INGESTOR_DB_STATEMENT_TIMEOUT_MS=22000',
      'UNIT_TALK_INGESTOR_DB_LOCK_TIMEOUT_MS=7000',
      'UNIT_TALK_INGESTOR_DB_MAX_BATCH_SIZE=321',
      'UNIT_TALK_INGESTOR_DB_MERGE_CHUNK_SIZE=123',
      'UNIT_TALK_INGESTOR_DB_RETRY_MAX_ATTEMPTS=4',
      'UNIT_TALK_INGESTOR_DB_RETRY_BACKOFF_MS=2500',
      'UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_MODE=fail_closed',
      'UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_DIR=tmp/provider-archive',
    ].join('\n'),
  );

  const env = loadEnvironment(rootDir);

  assert.equal(env.UNIT_TALK_INGESTOR_DB_STATEMENT_TIMEOUT_MS, '22000');
  assert.equal(env.UNIT_TALK_INGESTOR_DB_LOCK_TIMEOUT_MS, '7000');
  assert.equal(env.UNIT_TALK_INGESTOR_DB_MAX_BATCH_SIZE, '321');
  assert.equal(env.UNIT_TALK_INGESTOR_DB_MERGE_CHUNK_SIZE, '123');
  assert.equal(env.UNIT_TALK_INGESTOR_DB_RETRY_MAX_ATTEMPTS, '4');
  assert.equal(env.UNIT_TALK_INGESTOR_DB_RETRY_BACKOFF_MS, '2500');
  assert.equal(env.UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_MODE, 'fail_closed');
  assert.equal(env.UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_DIR, 'tmp/provider-archive');

  fs.rmSync(rootDir, { recursive: true, force: true });
});
