import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  DEFAULT_PROFILE,
  MODEL_ROUTING_POLICY_PATH,
  buildPrompt,
  classifyScope,
  extractScopePaths,
  parsePacket,
  resolveProfile,
} from './codex-packet.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const COMPLETE_PACKET = `# Reject unresolvable capper identity

Profile: codex-sol-high

## Goal
Submissions with an unresolvable capper identity must fail closed.

## Context
Observed: the email local-part was used as a fallback identity.

## Scope
- \`apps/api/src/submission-service.ts\`
- \`apps/api/src/submission-service.test.ts\`

## Acceptance
- [ ] \`pnpm verify\` is green

## Do not touch
- Anything under \`docs/mission/**\`
`;

test('parsePacket extracts title, profile and sections', () => {
  const p = parsePacket(COMPLETE_PACKET);
  assert.equal(p.title, 'Reject unresolvable capper identity');
  assert.equal(p.profile, 'codex-sol-high');
  assert.deepEqual(p.missingSections, []);
  assert.match(p.sections.goal, /fail closed/);
});

test('parsePacket reports every missing required section', () => {
  const p = parsePacket('# Title\n\n## Goal\nsomething\n');
  assert.deepEqual(p.missingSections.sort(), ['Acceptance', 'Do not touch', 'Scope']);
});

test('parsePacket treats a present-but-empty section as missing', () => {
  // An empty heading is the likeliest way an underspecified packet reaches an
  // executor: the author added the heading and never filled it in.
  const p = parsePacket(COMPLETE_PACKET.replace('- Anything under `docs/mission/**`', ''));
  assert.deepEqual(p.missingSections, ['Do not touch']);
});

test('parsePacket ignores headings inside fenced code blocks', () => {
  const withFence = COMPLETE_PACKET.replace(
    '## Context\nObserved: the email local-part was used as a fallback identity.',
    '## Context\n```md\n## Scope\nnot a real section\n```\nreal context'
  );
  const p = parsePacket(withFence);
  assert.match(p.sections.context, /real context/);
  // The real Scope section, not the fenced impostor, is what was parsed.
  assert.match(p.sections.scope, /submission-service\.ts/);
});

test('extractScopePaths reads backticked and bare path bullets, ignoring prose', () => {
  const paths = extractScopePaths(
    '- `apps/api/src/a.ts`\n- packages/db/src/b.ts (the repository)\n- no path on this line\n'
  );
  assert.deepEqual(paths, ['apps/api/src/a.ts', 'packages/db/src/b.ts']);
});

test('resolveProfile rejects unknown, disabled and malformed profiles', () => {
  const policy = {
    profiles: {
      good: { model: 'm', reasoning_effort: 'high', enabled: true },
      off: { model: 'm', reasoning_effort: 'high', enabled: false },
      broken: { model: 42, reasoning_effort: 'high' },
    },
  };
  assert.deepEqual(resolveProfile(policy, 'good'), { model: 'm', reasoning_effort: 'high' });
  assert.throws(() => resolveProfile(policy, 'nope'), /Unknown model profile/);
  assert.throws(() => resolveProfile(policy, 'off'), /disabled/);
  assert.throws(() => resolveProfile(policy, 'broken'), /malformed/);
  assert.throws(() => resolveProfile({}, 'good'), /no "profiles" map/);
});

test('the default profile exists and is enabled in the canonical routing policy', () => {
  // Guards the drift that makes delegation fail at the moment it is needed:
  // the runner names a profile the policy no longer has.
  const policy = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, MODEL_ROUTING_POLICY_PATH), 'utf8'));
  const resolved = resolveProfile(policy, DEFAULT_PROFILE);
  assert.ok(resolved.model.length > 0);
  assert.ok(resolved.reasoning_effort.length > 0);
});

test('classifyScope names a reserved surface and stays quiet on ordinary paths', () => {
  assert.deepEqual(classifyScope(REPO_ROOT, ['apps/api/src/submission-service.ts']), []);
  assert.deepEqual(classifyScope(REPO_ROOT, ['supabase/migrations/0001_x.sql']), [
    'production-ddl-and-data',
  ]);
});

test('classifyScope is advisory-safe when the policy cannot be read', () => {
  assert.deepEqual(classifyScope(path.join(REPO_ROOT, 'does', 'not', 'exist'), ['a/b.ts']), []);
});

test('buildPrompt carries the packet and forbids ticket lookup', () => {
  const prompt = buildPrompt('docs/mission/packets/x.md', COMPLETE_PACKET);
  assert.match(prompt, /AGENTS\.md/);
  assert.match(prompt, /no lane manifest and no tier label/);
  assert.ok(prompt.includes('Reject unresolvable capper identity'));
  assert.ok(prompt.includes('--- END PACKET ---'));
});

test('the shipped template is a packet the runner would accept', () => {
  const template = fs.readFileSync(path.join(REPO_ROOT, 'docs/mission/packets/TEMPLATE.md'), 'utf8');
  const parsed = parsePacket(template);
  assert.deepEqual(parsed.missingSections, []);
  assert.ok(parsed.scopePaths.length > 0);
});
