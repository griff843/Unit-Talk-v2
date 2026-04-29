import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIRS = [
  path.join(ROOT, 'app'),
  path.join(ROOT, 'components'),
  path.join(ROOT, 'lib'),
];
const FORBIDDEN_PATTERNS = [
  /provider_offer_current/i,
  /provider_offer_history/i,
  /provider_offers/i,
  /raw_provider_payload/i,
  /raw-provider-payload/i,
  /from\(\s*['"]provider_/i,
  /@supabase\/supabase-js/,
];

function readText(filePath: string) {
  return fs.readFileSync(filePath, 'utf8');
}

function walkFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs.readdirSync(dirPath, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(fullPath);
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) {
      return [];
    }
    return [fullPath];
  });
}

test('smart-form submit client writes through the canonical submissions endpoint', () => {
  const source = readText(path.join(ROOT, 'lib', 'api-client.ts'));
  assert.match(source, /fetch\(`\$\{API\}\/api\/submissions`/);
  assert.doesNotMatch(source, /\/rest\/v1\//);
});

test('smart-form browse client only uses API reference-data and submissions surfaces', () => {
  const source = readText(path.join(ROOT, 'lib', 'api-client.ts'));
  const endpointMatches = [...source.matchAll(/fetch\(`\$\{API\}(\/api\/[^`]+)`/g)].map((match) => match[1]);

  assert.ok(endpointMatches.length > 0, 'expected fetch endpoints in api-client');
  for (const endpoint of endpointMatches) {
    assert.ok(
      endpoint.startsWith('/api/reference-data/') || endpoint === '/api/submissions',
      `unexpected smart-form endpoint: ${endpoint}`,
    );
  }
});

test('smart-form source tree does not import ingestion storage or direct Supabase clients', () => {
  const files = SOURCE_DIRS.flatMap((dirPath) => walkFiles(dirPath));
  assert.ok(files.length > 0, 'expected smart-form source files');

  for (const filePath of files) {
    const source = readText(filePath);
    for (const pattern of FORBIDDEN_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${path.relative(ROOT, filePath)} matched ${pattern}`);
    }
  }
});
