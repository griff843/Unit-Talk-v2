/**
 * Guard on the ACTIVE agent and skill bodies, not their descriptions.
 *
 * Independent review caught the same defect in four files at once: the
 * frontmatter `description` had been migrated to the mission-native model while
 * the body below it still demanded an issue ID, read a lane manifest, scored
 * against the retired Tier C table, or ran `pnpm linear:work`. A selector that
 * advertises one contract and a body that executes another is worse than an
 * un-migrated file, because the operator only reads the description.
 *
 * Legacy copies under `.claude/commands/legacy/` are deliberately exempt: they
 * are retained as a record of the Linear-era procedure, clearly marked, and are
 * not the execution path.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Files that route or review mission-native work and must not require Linear-era inputs. */
const ACTIVE = [
  '.claude/agents/codex-return-reviewer.md',
  '.claude/agents/pr-risk-reviewer.md',
  '.claude/agents/runtime-verifier.md',
  '.agents/skills/system-state-loader/SKILL.md',
];

/**
 * Runnable commands that read Linear or lane state. A body may NAME one to say
 * it is not used ("do not run `pnpm linear:work`"); what it may not do is put
 * one in a fenced block, where it reads as a step to execute.
 */
const FORBIDDEN_COMMANDS = [
  'pnpm linear:work',
  'npm linear:work',
  'execution-state.ts',
  'pr-review-packet.ts',
  'merge-risk.ts',
  'ops:lane-start',
  'ops:lane-close',
  'ops:truth-check',
];

/** Paths that only exist in the Linear-era model. */
const FORBIDDEN_PATHS = ['docs/06_status/lanes/'];

function fencedBlocks(source: string): string[] {
  return [...source.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
}

for (const rel of ACTIVE) {
  const file = path.join(ROOT, rel);

  test(`${rel} exists and is not a stub`, () => {
    assert.ok(fs.existsSync(file), `${rel} is missing`);
    assert.ok(fs.readFileSync(file, 'utf8').length > 400, `${rel} looks empty`);
  });

  test(`${rel} executes no Linear-era command`, () => {
    const blocks = fencedBlocks(fs.readFileSync(file, 'utf8')).join('\n');
    for (const command of FORBIDDEN_COMMANDS) {
      assert.ok(
        !blocks.includes(command),
        `${rel} runs \`${command}\` — a mission-native PR has no Linear issue, lane or tier`,
      );
    }
    for (const p of FORBIDDEN_PATHS) {
      assert.ok(!blocks.includes(p), `${rel} reads ${p}, which mission-native work does not have`);
    }
  });

  test(`${rel} does not demand an issue or tier as an input`, () => {
    const source = fs.readFileSync(file, 'utf8');
    const inputs = source.match(/##+ Inputs?[^\n]*\n([\s\S]*?)(?=\n##|\n---|$)/i);
    if (!inputs) return; // no inputs section to constrain
    for (const demand of [/^\s*[-*]\s*Issue ID/im, /^\s*[-*]\s*Tier\b/im, /^\s*[-*]\s*R-level/im]) {
      assert.ok(
        !demand.test(inputs[1]),
        `${rel} asks for an input every mission-native PR lacks by design:\n${inputs[1].trim()}`,
      );
    }
  });
}

test('the reserved-surface policy is the source of risk, not a hand-kept path table', () => {
  // The old Tier C table and the policy deliberately disagree now:
  // packages/domain and packages/contracts are NOT reserved. A reviewer that
  // scores against its own copy of the table reports both as blockers.
  for (const rel of ['.claude/agents/pr-risk-reviewer.md', '.claude/agents/codex-return-reviewer.md']) {
    const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(
      source.includes('RESERVED_RISK_SURFACES.json'),
      `${rel} must classify against the machine-readable policy`,
    );
    assert.ok(
      !/\|\s*`packages\/domain\/src\/\*\*`\s*\|\s*HIGH/.test(source),
      `${rel} still scores packages/domain as HIGH from the retired Tier C table`,
    );
  }
});
