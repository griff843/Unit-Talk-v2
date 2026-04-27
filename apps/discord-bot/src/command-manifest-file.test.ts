import assert from 'node:assert/strict';
import test from 'node:test';

import {
  manifestContentsMatch,
  normalizeManifestContent,
} from './command-manifest-file.js';

test('normalizeManifestContent rewrites CRLF content to LF', () => {
  assert.equal(normalizeManifestContent('a\r\nb\r\n'), 'a\nb\n');
});

test('manifestContentsMatch treats LF and CRLF renderings as equal', () => {
  const lfContent = '[\n  {\n    "name": "help"\n  }\n]\n';
  const crlfContent = lfContent.replace(/\n/g, '\r\n');

  assert.equal(manifestContentsMatch(crlfContent, lfContent), true);
});

test('manifestContentsMatch still rejects real manifest drift', () => {
  const existingContent = '[\r\n  {\r\n    "name": "help"\r\n  }\r\n]\r\n';
  const nextContent = '[\n  {\n    "name": "stats"\n  }\n]\n';

  assert.equal(manifestContentsMatch(existingContent, nextContent), false);
});
