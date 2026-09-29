import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgentSearchArgs } from './agent-search.js';

test('agent search excludes generated and historical state by default', () => {
  const args = buildAgentSearchArgs(['promotion_target', 'apps', 'docs']);

  assert.deepStrictEqual(args.slice(0, 3), ['--line-number', '--color=never', '--smart-case']);
  assert.deepStrictEqual(args.slice(-3), ['promotion_target', 'apps', 'docs']);
  assert.ok(args.includes('!**/dist/**'));
  assert.ok(args.includes('!docs/archive/**'));
  assert.ok(args.includes('!docs/06_status/**'));
  assert.ok(args.includes('!.ops/sync/**'));
});

test('agent search history mode restores governance history but still excludes generated output', () => {
  const args = buildAgentSearchArgs(['--history', 'promotion_target']);

  assert.ok(!args.includes('--history'));
  assert.ok(!args.includes('!docs/archive/**'));
  assert.ok(!args.includes('!docs/06_status/**'));
  assert.ok(args.includes('!**/dist/**'));
  assert.ok(args.includes('!.out/**'));
});
