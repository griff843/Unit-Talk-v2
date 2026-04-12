import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './ops/shared.js';

test('codex-status no longer references legacy lane registry identifiers', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'codex-status.ts'), 'utf8');
  for (const banned of [
    'LANES_FILE',
    'readRegistry',
    'writeRegistry',
    'LaneEntry',
    'LaneRegistry',
  ]) {
    assert.ok(!source.includes(banned), `unexpected legacy identifier still present: ${banned}`);
  }
  assert.match(source, /readAllManifests/, 'must import readAllManifests from shared.ts');
  assert.match(source, /ACTIVE_LOCK_STATUSES/, 'must import ACTIVE_LOCK_STATUSES from shared.ts');
});

test('codex-status imports lane_type filter for codex-cli', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'codex-status.ts'), 'utf8');
  assert.match(source, /lane_type\s*===\s*['"]codex-cli['"]/, 'must filter by lane_type codex-cli');
});
