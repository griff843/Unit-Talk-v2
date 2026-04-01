#!/usr/bin/env node
/**
 * Checks that no app imports another app's package.
 * Exits non-zero if any cross-app import is found.
 *
 * Usage: node scripts/check-cross-app-imports.mjs
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const APP_PACKAGES = [
  '@unit-talk/api',
  '@unit-talk/worker',
  '@unit-talk/operator-web',
  '@unit-talk/command-center',
  '@unit-talk/smart-form',
  '@unit-talk/discord-bot',
  '@unit-talk/alert-agent',
  '@unit-talk/ingestor',
];

const APPS_DIR = join(process.cwd(), 'apps');

async function* walkTs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.next') continue;
      yield* walkTs(full);
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      yield full;
    }
  }
}

const violations = [];

for await (const filePath of walkTs(APPS_DIR)) {
  const content = await readFile(filePath, 'utf8');
  for (const pkg of APP_PACKAGES) {
    // Match import/require of another app package
    const pattern = new RegExp(`(?:from|require\\()\\s*['"]${pkg.replace('/', '\\/')}(?:\\/|['"])`, 'g');
    let match;
    while ((match = pattern.exec(content)) !== null) {
      // Allow an app to NOT import itself — but the check fires on cross-app only.
      // Determine which app this file belongs to by its path.
      const rel = relative(APPS_DIR, filePath);
      const appName = rel.split(/[\\/]/)[0];
      const ownPkg = `@unit-talk/${appName}`;
      if (pkg !== ownPkg) {
        const lineNum = content.slice(0, match.index).split('\n').length;
        violations.push({ file: filePath, line: lineNum, pkg });
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Cross-app import violations found:\n');
  for (const v of violations) {
    console.error(`  ${relative(process.cwd(), v.file)}:${v.line}  imports ${v.pkg}`);
  }
  console.error(`\n${violations.length} violation(s). Apps must not import from other apps.`);
  process.exit(1);
} else {
  console.log('No cross-app import violations found.');
}
