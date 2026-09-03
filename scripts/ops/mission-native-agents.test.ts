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
  // Round 7 added these three. Each advertised itself as mission-native, or was
  // promoted as one, while its body still ran or demanded Linear-era state.
  '.claude/commands/operator-runbook.md',
  '.claude/agent-brief.md',
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

test('classification uses the real patch, never an empty one', () => {
  // A content rule -- destructive SQL, a repointed required-check script --
  // lives in the PATCH. Handing the classifier `patch: ""` reports `auto` for
  // a diff the Merge Gate reserves, which is the most dangerous possible
  // wrong answer for a review aid to give.
  for (const rel of ['.claude/agents/pr-risk-reviewer.md', '.claude/agents/runtime-verifier.md']) {
    const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(
      !/patch:\s*""/.test(source.replace(/hand-roll it with `patch: ""`[^\n]*/g, '')),
      `${rel} classifies with an empty patch, so content rules are invisible to it`,
    );
    assert.ok(
      source.includes('ops:classify-diff'),
      `${rel} must classify through ops:classify-diff, which carries the real patch`,
    );
  }
});

test('the DB-evidence trigger covers API services that write rows', () => {
  const source = fs.readFileSync(path.join(ROOT, '.claude/agents/runtime-verifier.md'), 'utf8');
  for (const trigger of ['apps/api/src/*-service.ts', 'packages/db/', 'supabase/', 'apps/worker/']) {
    assert.ok(source.includes(trigger), `runtime-verifier omits ${trigger} from the DB-evidence trigger`);
  }
});

test('reserved work is gated at the merge, not at the keyboard', () => {
  // Stopping a declared-reserved packet before implementation restores the
  // plan-approval gate RMA/v1 removed, and strands every reserved packet.
  const source = fs.readFileSync(path.join(ROOT, '.claude/commands/three-brain.md'), 'utf8');
  assert.ok(
    !/Before implementing anything that will classify `human`/.test(source),
    'three-brain still stops reserved work before implementation',
  );
  assert.ok(
    /gates\s+the MERGE, not the keyboard/.test(source),
    'three-brain must say plainly that approval gates the merge',
  );
});

test('the documented PM verdict template is one the gate accepts', () => {
  // validateT1Verdicts rejects a verdict missing PR: or Head SHA:, so a
  // three-line template parses and is then thrown away -- the operator follows
  // the documented procedure and the reserved merge still has no exit.
  const source = fs.readFileSync(path.join(ROOT, '.claude/commands/verification.md'), 'utf8');
  const template = source.match(/```\nPM_VERDICT:[\s\S]*?```/);
  assert.ok(template, 'verification.md must publish a PM verdict template');
  for (const field of ['PM_VERDICT:', 'schema: pm-verdict/v1', 'Issue:', 'PR:', 'Head SHA:']) {
    assert.ok(template![0].includes(field), `the published template omits ${field}`);
  }
  assert.ok(
    !/Issue: UTV2-NNN/.test(template![0]),
    'the template must not tell an operator to invent a Linear issue id',
  );
});

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

// ── round 7 ───────────────────────────────────────────────────────────────

test('the operator runbook does not gate rollback on a Linear credential', () => {
  const source = fs.readFileSync(path.join(ROOT, '.claude/commands/operator-runbook.md'), 'utf8');
  for (const block of fencedBlocks(source)) {
    assert.ok(
      !/LINEAR_API_(TOKEN|KEY).*(exit 1|required)/s.test(block),
      'the universal preflight still hard-fails without a Linear credential; rollback and ' +
        'restore do not read Linear, so that stops the operations most likely to be run ' +
        'under pressure on a credential they never use',
    );
  }
});

test('the deprecated Linear skill cannot mutate Linear', () => {
  const source = fs.readFileSync(path.join(ROOT, '.agents/skills/linear-execution/SKILL.md'), 'utf8');
  for (const block of fencedBlocks(source)) {
    for (const mutation of ['linear:update', 'linear:comment', 'linear:close']) {
      assert.ok(
        !block.includes(mutation),
        `the skill declares itself read-only and deprecated but still lists \`${mutation}\` ` +
          'as a runnable step. The description is what gets read when routing, so a body that ' +
          'contradicts it is worse than no deprecation at all.',
      );
    }
  }
  assert.ok(
    !/treat Linear as queue truth/i.test(source),
    'the skill still declares Linear to be queue truth',
  );
});

test('the agent brief does not attach lane-era requirements to a work packet', () => {
  const source = fs.readFileSync(path.join(ROOT, '.claude/agent-brief.md'), 'utf8');
  // The brief is prepended to every packet, so a stale instruction here is
  // attached to work that has none of the artifacts it names.
  for (const stale of ['lane_type:', 'expected_proof_paths', '.ops/sync/']) {
    assert.ok(
      !source.includes(stale),
      `the brief still instructs an executor to satisfy \`${stale}\`, which no longer exists`,
    );
  }
});

test('post-merge QA triggers on the changed path, not on a tier', () => {
  const source = fs.readFileSync(path.join(ROOT, '.claude/commands/three-brain.md'), 'utf8');
  assert.ok(
    !/After a T2 or T3 PR merges/.test(source),
    'Rule 8 still predicates QA on a tier label. A mission-native PR has none, so the router ' +
      'finds no value to test and silently skips the QA it advertises.',
  );
  assert.ok(
    /After ANY PR merges that touches a user-visible surface/.test(source),
    'Rule 8 should trigger on the changed path',
  );
});

test('the return reviewer never classifies risk from a filename list', () => {
  const source = fs.readFileSync(path.join(ROOT, '.claude/agents/codex-return-reviewer.md'), 'utf8');
  const reserved = source.slice(source.indexOf('### Check 2: reserved surfaces'));
  const blocks = fencedBlocks(reserved);
  assert.ok(blocks.length > 0, 'the reserved-surface check should carry a command block');
  assert.ok(
    !blocks[0]!.includes('--name-only'),
    'a filename list cannot evaluate the policy CONTENT rules, so an ordinary .ts file adding ' +
      'DELETE FROM reads as unreserved here while Merge Gate classifies it human. A reviewer ' +
      'that disagrees with the gate in the permissive direction is worse than one that declines.',
  );
  assert.ok(blocks[0]!.includes('ops:classify-diff'), 'it should run the real classifier');
});
