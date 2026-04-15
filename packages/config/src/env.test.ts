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
