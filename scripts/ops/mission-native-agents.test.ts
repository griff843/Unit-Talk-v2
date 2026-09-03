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
  // Round 8: CLAUDE.md's mission-native skill table promotes /pr-unblock, so it
  // is an execution path and belongs under the same guard as the rest.
  '.claude/commands/pr-unblock.md',
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

test('the legacy proof-closeout skill does not advertise itself for ordinary work', () => {
  // Round 8 review: the body was correctly marked legacy, but the SELECTOR was
  // not. `description` said "Use when verifying implementation, ... checking
  // runtime health" and `trigger` repeated it verbatim. Selection happens on
  // those two fields, so an ordinary verification task still landed here — and
  // the body then routed straight into `ops:brief`, `proof:t1 --issue
  // <UTV2-ID>` and lane closeout, reintroducing exactly the ticket-and-lane
  // workflow a mission-native packet does not have. A legacy label on the body
  // is worth nothing if the selector still volunteers for the common case.
  const source = fs.readFileSync(
    path.join(ROOT, '.agents/skills/proof-closeout/SKILL.md'),
    'utf8',
  );
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? '';
  assert.notEqual(frontmatter, '', 'no frontmatter found');

  const description = /^description:\s*(.*)$/m.exec(frontmatter)?.[1] ?? '';
  const trigger = /^trigger:\s*(.*)$/m.exec(frontmatter)?.[1] ?? '';

  assert.match(description, /LEGACY/, 'description must mark the skill legacy');

  // The selector must be conditioned on a bundle that already exists, not on
  // the activity of verifying.
  assert.match(
    trigger,
    /docs\/06_status\/proof\//,
    'trigger must condition on an existing proof bundle, not on verification in general',
  );

  for (const field of [description, trigger]) {
    assert.doesNotMatch(
      field,
      /verifying implementation|checking runtime health/i,
      `selector still advertises ordinary verification: ${field}`,
    );
  }

  // And the body must send the common case somewhere else rather than run it.
  assert.match(source, /Ordinary verification/i);
  assert.doesNotMatch(source, /pnpm proof:t1/, 'body still runs the ticket-keyed T1 proof flow');
  assert.doesNotMatch(source, /C:\/Dev\//, 'body still carries a non-portable Windows path');
});

test('the operator runbook does not gate every operation on credentials three of them never use', () => {
  // Round 8 review: removing the Linear check from the universal preflight was
  // not enough. The same block still exited on GITHUB_TOKEN, SUPABASE_URL and
  // SUPABASE_SERVICE_ROLE_KEY, and the runbook forbids skipping it — so an
  // emergency `rollback` (which needs only SUPABASE_DB_URL), a
  // `restore-verify` (its own BACKUP_RESTORE_VERIFY_* set) and an in-memory
  // `replay` (repo defaults only) all stayed unusable on a host that has none
  // of them. Those are precisely the operations most likely to be run under
  // pressure on a degraded host.
  const source = fs.readFileSync(path.join(ROOT, '.claude/commands/operator-runbook.md'), 'utf8');
  const universal = source.slice(
    source.indexOf('## Universal preflight'),
    source.indexOf('## health-check'),
  );
  assert.notEqual(universal, '', 'universal preflight section not found');

  for (const credential of ['GITHUB_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY']) {
    for (const block of fencedBlocks(universal)) {
      assert.ok(
        !new RegExp(`\\$\\{${credential}:-\\}`).test(block),
        `universal preflight still asserts ${credential}`,
      );
    }
  }

  // And it must not universally run the GitHub-reaching brief either.
  for (const block of fencedBlocks(universal)) {
    assert.doesNotMatch(block, /pnpm ops:brief/, 'universal preflight still reaches GitHub');
  }

  // Each operation must carry its own assertions instead.
  for (const op of ['health-check', 'rollback', 'replay', 'restore-verify']) {
    const start = source.indexOf(`## ${op}`);
    assert.notEqual(start, -1, `operation section missing: ${op}`);
    const next = source.indexOf('\n## ', start + 1);
    const section = source.slice(start, next === -1 ? undefined : next);
    assert.match(section, /### Preflight assertions/, `${op} has no preflight assertions block`);
  }
});

test('pr-unblock does not demand a human verdict for an auto diff', () => {
  // Round 8 review: promoting /pr-unblock as mission-native exposed a
  // re-authorization procedure whose last step was an unconditional "request PM
  // verdict / t1-approved". Under risk-scoped authority only a `human` diff
  // needs one, so on an ordinary auto PR that step invents a human dependency
  // the policy does not impose — and the wait is pure cost.
  const source = fs.readFileSync(path.join(ROOT, '.claude/commands/pr-unblock.md'), 'utf8');
  const start = source.indexOf('## Step 3 — re-authorization after a head change');
  assert.notEqual(start, -1, 'step 3 section not found');
  const next = source.indexOf('\n---', start);
  const section = source.slice(start, next === -1 ? undefined : next);

  // The procedure must reclassify at the new head rather than reuse a stale answer.
  assert.match(section, /ops:classify-diff/, 'step 3 does not reclassify at the new head');
  // And it must branch, naming both outcomes.
  assert.match(section, /`auto`/, 'step 3 does not name the auto outcome');
  assert.match(section, /`human`/, 'step 3 does not name the human outcome');
  // The prohibition itself.
  assert.match(
    section,
    /Do \*\*not\*\* request a human verdict/,
    'step 3 does not tell the reader to skip the verdict on an auto diff',
  );
});

test('runtime-verifier distinguishes an approval-blocked Merge Gate from a broken one', () => {
  // Round 8 review: under risk-scoped authority Merge Gate is DESIGNED to fail
  // on an `authority: human` PR until the label and head-bound verdict exist —
  // that failure is how a reserved diff waits. A rule reading "any failure on a
  // required check = FAILED" therefore returned FAILED for every reserved PR,
  // making this agent useless on exactly the PRs it matters most on, and making
  // its own `VERIFIED -> proceed to the merge gate` handoff unreachable: the
  // gate cannot go green before the label, and the label is not requested until
  // the agent says VERIFIED. A deadlock written into a procedure.
  const source = fs.readFileSync(path.join(ROOT, '.claude/agents/runtime-verifier.md'), 'utf8');

  assert.match(source, /\bWAITING\b/, 'no WAITING verdict');
  assert.match(
    source,
    /Never infer WAITING from `authority: human` alone/,
    'the WAITING path is not conditioned on what the gate actually says',
  );
  // It must read the gate's own reason rather than assume from the authority.
  assert.match(source, /select\(\.name=="Merge Gate"\) \| \.output\.summary/);
  // And the frontmatter must advertise the third verdict, since selection and
  // the caller's expectations are set there.
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? '';
  assert.match(frontmatter, /WAITING/, 'frontmatter still promises only VERIFIED or FAILED');
});

test('the operator runbook asserts the credentials each command actually uses', () => {
  // Round 8 review, and a defect I introduced in round 8's own fix: the rollback
  // section asserted SUPABASE_DB_URL alone and claimed the operation connects
  // over it. It does not. rollback-validate.ts reads SUPABASE_DB_URL only for
  // its production guard and builds its client from
  // createServiceRoleDatabaseConnectionConfig, whose resolver requires all three
  // REST variables. The live command failed AFTER a passing preflight, on the
  // exact minimal host the section claimed to support.
  const source = fs.readFileSync(path.join(ROOT, '.claude/commands/operator-runbook.md'), 'utf8');
  const section = (name: string) => {
    const start = source.indexOf(`## ${name}`);
    assert.notEqual(start, -1, `missing section: ${name}`);
    const next = source.indexOf('\n## ', start + 1);
    return source.slice(start, next === -1 ? undefined : next);
  };

  const rollback = section('rollback');
  for (const v of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    assert.ok(rollback.includes(v), `rollback does not assert ${v} for its live path`);
  }
  // ...and must still keep the dry run cheap, or the fix has just recreated the
  // problem it was meant to solve.
  assert.match(rollback, /Dry run/i);

  // Capture reaches the live provider, and with no key the CLI substitutes the
  // literal `replay-key` rather than failing — a silent bad default.
  const replay = section('replay');
  assert.ok(
    replay.includes('SGO_API_KEY') && replay.includes('SGO_API_KEYS'),
    'replay does not assert a provider key for --action capture',
  );
});
