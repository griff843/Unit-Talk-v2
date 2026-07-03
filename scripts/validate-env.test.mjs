import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkForBom,
  parseEnvFile,
  checkMissingSharedKeys,
  checkLeakedSecrets,
} from './validate-env.mjs';

function writeFixture(name, contents, { bom = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-env-test-'));
  const filePath = path.join(dir, name);
  const body = Buffer.from(contents, 'utf8');
  const buffer = bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

test('checkForBom throws an actionable error when a file starts with a UTF-8 BOM', () => {
  const filePath = writeFixture('local.env', '# comment\nNODE_ENV=development\n', { bom: true });
  assert.throws(
    () => checkForBom(filePath),
    /local\.env has a UTF-8 BOM at byte 0 — re-save the file without a BOM/,
  );
});

test('checkForBom does not throw for a BOM-free file', () => {
  const filePath = writeFixture('local.env', '# comment\nNODE_ENV=development\n');
  assert.doesNotThrow(() => checkForBom(filePath));
});

test('parseEnvFile fails closed with the BOM error instead of silently corrupting the first key', () => {
  const filePath = writeFixture('.env.example', 'NODE_ENV=development\n', { bom: true });
  assert.throws(
    () => parseEnvFile(filePath),
    /\.env\.example has a UTF-8 BOM at byte 0/,
  );
});

test('parseEnvFile parses keys and values from a well-formed file', () => {
  const filePath = writeFixture(
    '.env.example',
    '# a comment\nNODE_ENV=development\nEMPTY_KEY=\n',
  );
  const result = parseEnvFile(filePath);
  assert.equal(result.get('NODE_ENV'), 'development');
  assert.equal(result.get('EMPTY_KEY'), '');
});

test('checkMissingSharedKeys flags required keys absent from the shared env map', () => {
  const missing = checkMissingSharedKeys(new Map([['NODE_ENV', 'development']]));
  assert.ok(missing.includes('UNIT_TALK_APP_ENV'));
  assert.ok(!missing.includes('NODE_ENV'));
});

test('checkLeakedSecrets flags discouraged keys that hold non-empty values', () => {
  const leaked = checkLeakedSecrets(
    new Map([
      ['LINEAR_API_TOKEN', 'lin_api_xxx'],
      ['SUPABASE_SERVICE_ROLE_KEY', ''],
    ]),
  );
  assert.deepEqual(leaked, ['LINEAR_API_TOKEN']);
});
