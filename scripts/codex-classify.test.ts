import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './ops/shared.js';

test('codex-classify no longer references legacy lane registry identifiers', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'codex-classify.ts'), 'utf8');
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

test('codex-classify does not reference legacy /3 capacity cap', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'codex-classify.ts'), 'utf8');
  assert.ok(!source.includes('/3'), 'legacy capacity cap /3 must be removed');
});
