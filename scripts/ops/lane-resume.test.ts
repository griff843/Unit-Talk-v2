import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './shared.js';

// UTV2-1526 PM review finding #1: resuming a blocked Codex lane must reuse the
// manifest's existing model_routing untouched -- it must never require the operator to
// respecify a model profile, and must never silently reconstruct/change it. This file
// previously had no tests at all.

test('lane-resume re-invokes ops:lane-start without --model-profile, passing the existing executor through unchanged', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-resume.ts'), 'utf8');

  assert.match(
    source,
    /'--executor',\s*\n\s*current\.executor/,
    'lane-resume must pass the manifest\'s existing executor straight through to ops:lane-start',
  );
  assert.doesNotMatch(
    source,
    /--model-profile/,
    'lane-resume must not pass --model-profile -- ops:lane-start\'s resume branch (already-existing branch+worktree) ' +
      'never requires or reconstructs model_routing; requiring it here would force the operator to respecify a model ' +
      'the lane already has, or would silently create room to change it',
  );
  assert.doesNotMatch(
    source,
    /model_routing/,
    'lane-resume must never read or construct a model_routing block itself -- it only forwards existing manifest fields',
  );
});

test('lane-resume only operates on lanes already in blocked status, never constructing a new manifest', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'lane-resume.ts'), 'utf8');
  assert.match(
    source,
    /current\.status !== 'blocked'/,
    'lane-resume must refuse to act on anything but an already-blocked lane',
  );
  assert.doesNotMatch(
    source,
    /createManifest/,
    'lane-resume must never call createManifest directly -- it only re-invokes ops:preflight and ops:lane-start ' +
      'as subprocesses, both of which take the resume/existing-manifest path for an already-blocked lane',
  );
});
