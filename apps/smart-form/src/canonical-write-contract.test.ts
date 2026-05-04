/**
 * UTV2-794: Contract test — Smart Form writes only through canonical API path.
 *
 * This test scans the Smart Form source tree for any direct database write
 * patterns that would bypass the canonical API control-plane path. It fails
 * if any such pattern is introduced, enforcing the invariant mechanically.
 *
 * Smart Form must ONLY write to the database by calling:
 *   POST apps/api /api/submissions
 *
 * Forbidden patterns:
 * - Direct Supabase client instantiation or usage
 * - Imports of @unit-talk/db or @supabase/supabase-js
 * - Direct references to ingestion/provider storage tables
 * - DB repository class usage for writes
 * - REST API v1 direct table access patterns
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// All directories containing Smart Form application code (not tests/scripts)
const SOURCE_DIRS = [
  path.join(ROOT, 'app'),
  path.join(ROOT, 'components'),
  path.join(ROOT, 'lib'),
];

/**
 * Patterns that constitute a canonical write path violation.
 * Each entry is a tuple of [pattern, description].
 */
const FORBIDDEN_WRITE_PATTERNS: Array<[RegExp, string]> = [
  // Direct Supabase client usage
  [/@supabase\/supabase-js/, 'direct @supabase/supabase-js import'],
  [/createClient\s*\(/, 'direct Supabase createClient() call'],
  [/\.from\s*\(\s*['"][a-z_]+['"]\s*\)\s*\.(insert|update|upsert|delete)/, 'direct Supabase table write (.insert/.update/.upsert/.delete)'],
  [/\/rest\/v1\//, 'direct Supabase REST v1 table access'],

  // DB package imports
  [/from\s+['"]@unit-talk\/db['"]/, 'direct @unit-talk/db package import'],
  [/require\s*\(\s*['"]@unit-talk\/db['"]\s*\)/, 'direct @unit-talk/db require()'],

  // Ingestion / provider storage tables — Smart Form must never touch these
  [/provider_offer_current/, 'reference to provider_offer_current ingestion table'],
  [/provider_offer_history/, 'reference to provider_offer_history ingestion table'],
  [/provider_offers\b/, 'reference to provider_offers ingestion table'],
  [/raw_provider_payload/, 'reference to raw_provider_payload ingestion table'],
  [/raw-provider-payload/, 'reference to raw-provider-payload (kebab form)'],

  // Direct picks / audit table writes (Smart Form must use API for these)
  [/\.from\s*\(\s*['"]picks['"]/, 'direct write to picks table (must use API)'],
  [/\.from\s*\(\s*['"]audit_log['"]/, 'direct write to audit_log table (must use API)'],
  [/\.from\s*\(\s*['"]submission_events['"]/, 'direct write to submission_events table (must use API)'],
  [/\.from\s*\(\s*['"]pick_lifecycle['"]/, 'direct write to pick_lifecycle table (must use API)'],
];

/**
 * Canonical write path — the only permitted submission endpoint.
 */
const REQUIRED_SUBMISSION_ENDPOINT = /fetch\(`\$\{API\}\/api\/submissions`/;

function readText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function walkSourceFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs.readdirSync(dirPath, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      return walkSourceFiles(fullPath);
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) {
      return [];
    }
    return [fullPath];
  });
}

test('smart-form source tree contains no direct DB write patterns', () => {
  const files = SOURCE_DIRS.flatMap((dirPath) => walkSourceFiles(dirPath));
  assert.ok(files.length > 0, 'expected smart-form source files to exist');

  const violations: string[] = [];

  for (const filePath of files) {
    const source = readText(filePath);
    const relPath = path.relative(ROOT, filePath);
    for (const [pattern, description] of FORBIDDEN_WRITE_PATTERNS) {
      if (pattern.test(source)) {
        violations.push(`${relPath}: ${description} (pattern: ${pattern})`);
      }
    }
  }

  assert.equal(
    violations.length,
    0,
    `Smart Form canonical write path violations found:\n${violations.join('\n')}`,
  );
});

test('smart-form submit path calls canonical /api/submissions endpoint (not direct DB)', () => {
  const apiClientPath = path.join(ROOT, 'lib', 'api-client.ts');
  assert.ok(fs.existsSync(apiClientPath), 'lib/api-client.ts must exist');

  const source = readText(apiClientPath);

  // Must use canonical API endpoint
  assert.match(
    source,
    REQUIRED_SUBMISSION_ENDPOINT,
    'api-client.ts must POST to ${API}/api/submissions',
  );

  // Must not use any REST v1 direct table access
  assert.doesNotMatch(
    source,
    /\/rest\/v1\//,
    'api-client.ts must not use direct Supabase REST v1 access',
  );
});

test('smart-form does not import @unit-talk/db anywhere in the dependency graph', () => {
  // Also check package.json to ensure the package is not listed as a dependency.
  const packageJsonPath = path.join(ROOT, 'package.json');
  const packageJson = JSON.parse(readText(packageJsonPath)) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  assert.ok(
    !('@unit-talk/db' in allDeps),
    'smart-form must not declare @unit-talk/db as a dependency — writes go through the API',
  );
});

test('smart-form audit events are not written directly — must use canonical API path', () => {
  // Audit events and lifecycle events must go through the API.
  // This test verifies no file in the source tree bypasses this.
  const files = SOURCE_DIRS.flatMap((dirPath) => walkSourceFiles(dirPath));

  for (const filePath of files) {
    const source = readText(filePath);
    const relPath = path.relative(ROOT, filePath);

    assert.doesNotMatch(
      source,
      /\.from\s*\(\s*['"]audit_log['"]/,
      `${relPath}: direct audit_log table access bypasses canonical audit path`,
    );
    assert.doesNotMatch(
      source,
      /\.from\s*\(\s*['"]pick_lifecycle['"]/,
      `${relPath}: direct pick_lifecycle table access bypasses canonical lifecycle path`,
    );
  }
});
