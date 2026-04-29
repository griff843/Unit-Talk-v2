import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_ARCHIVE_REGISTRY } from './registry.js';

test('all built-in archive sources are registered', () => {
  assert.equal(DEFAULT_ARCHIVE_REGISTRY.getAllSources().length, 2);
});

test('all replay packs link to valid archive sources and scenarios', () => {
  for (const pack of DEFAULT_ARCHIVE_REGISTRY.getAllReplayPacks()) {
    assert.ok(DEFAULT_ARCHIVE_REGISTRY.getSource(pack.archiveSourceId));
    assert.ok(pack.scenarioId);
  }
});

test('slate replay pack is registered for regression use', () => {
  const pack = DEFAULT_ARCHIVE_REGISTRY.getReplayPack('v2-slate-replay-pack');
  assert.ok(pack);
  assert.equal(pack.scenarioId, 'slate-replay');
  assert.equal(pack.executionMode, 'replay');
});

test('getFixturePath resolves under the verification package fixtures directory', () => {
  const fixturePath = DEFAULT_ARCHIVE_REGISTRY.getFixturePath('v2-lifecycle-fixture');
  assert.match(fixturePath, /packages[\\/]verification[\\/]test-fixtures[\\/]v2-lifecycle-events\.jsonl$/);
});
