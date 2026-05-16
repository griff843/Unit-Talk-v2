import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseFrontmatter,
  validateAgent,
  validateSkill,
  VALID_MODELS,
  SKILL_CATEGORIES,
} from './contract-validator.js';

// ── parseFrontmatter ──────────────────────────────────────────────────────────

test('parseFrontmatter: extracts fields from valid YAML frontmatter', () => {
  const content = '---\nname: test\nmodel: claude-sonnet-4-6\n---\n\nbody';
  const fm = parseFrontmatter(content);
  assert.strictEqual(fm.name, 'test');
  assert.strictEqual(fm.model, 'claude-sonnet-4-6');
});

test('parseFrontmatter: returns empty object when no frontmatter', () => {
  const fm = parseFrontmatter('No frontmatter here');
  assert.deepStrictEqual(fm, {});
});

test('parseFrontmatter: returns empty object when frontmatter delimiter missing', () => {
  const fm = parseFrontmatter('name: test\nmodel: foo');
  assert.deepStrictEqual(fm, {});
});

test('parseFrontmatter: handles CRLF line endings', () => {
  const content = '---\r\nname: crlf-agent\r\nmodel: claude-sonnet-4-6\r\n---\r\nbody';
  const fm = parseFrontmatter(content);
  assert.strictEqual(fm.name, 'crlf-agent');
});

// ── validateAgent: valid ──────────────────────────────────────────────────────

const VALID_AGENT = `---
name: test-agent
description: A test agent for unit testing purposes.
model: claude-sonnet-4-6
tools:
  - Bash
  - Read
---

Agent body content here.
`;

test('validateAgent: valid agent contract passes with no failures', () => {
  const result = validateAgent('/path/to/test-agent.md', VALID_AGENT);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.failures.length, 0);
  assert.strictEqual(result.contract?.name, 'test-agent');
  assert.strictEqual(result.contract?.model, 'claude-sonnet-4-6');
  assert.deepStrictEqual(result.contract?.tools, ['Bash', 'Read']);
});

// ── validateAgent: failure codes ─────────────────────────────────────────────

test('validateAgent A1: missing name field', () => {
  const content = `---
description: Test agent.
model: claude-sonnet-4-6
tools:
  - Read
---`;
  const result = validateAgent('/path/to/test-agent.md', content);
  assert.strictEqual(result.valid, false);
  assert.ok(result.failures.some((f) => f.code === 'A1'), 'Expected A1');
});

test('validateAgent A1: no frontmatter at all', () => {
  const result = validateAgent('/path/to/test-agent.md', 'Just a body with no frontmatter.');
  assert.strictEqual(result.valid, false);
  assert.ok(result.failures.some((f) => f.code === 'A1'), 'Expected A1');
});

test('validateAgent A2: name does not match filename', () => {
  const content = `---
name: wrong-name
description: Test agent.
model: claude-sonnet-4-6
tools:
  - Read
---`;
  const result = validateAgent('/path/to/test-agent.md', content);
  assert.strictEqual(result.valid, false);
  assert.ok(result.failures.some((f) => f.code === 'A2'), 'Expected A2');
});

test('validateAgent A3: description is empty string', () => {
  const content = `---
name: test-agent
description: ''
model: claude-sonnet-4-6
tools:
  - Read
---`;
  const result = validateAgent('/path/to/test-agent.md', content);
  assert.strictEqual(result.valid, false);
  assert.ok(result.failures.some((f) => f.code === 'A3'), 'Expected A3');
});

test('validateAgent A3: description is missing', () => {
  const content = `---
name: test-agent
model: claude-sonnet-4-6
tools:
  - Read
---`;
  const result = validateAgent('/path/to/test-agent.md', content);
  assert.strictEqual(result.valid, false);
  assert.ok(result.failures.some((f) => f.code === 'A3'), 'Expected A3');
});

test('validateAgent A4: model field missing', () => {
  const content = `---
name: test-agent
description: Test agent.
tools:
  - Read
---`;
  const result = validateAgent('/path/to/test-agent.md', content);
  assert.strictEqual(result.valid, false);
  assert.ok(result.failures.some((f) => f.code === 'A4'), 'Expected A4');
});

test('validateAgent A5: unrecognized model is rejected', () => {
  const content = `---
name: test-agent
description: Test agent.
model: gpt-4o
tools:
  - Read
---`;
  const result = validateAgent('/path/to/test-agent.md', content);
  assert.strictEqual(result.valid, false);
  assert.ok(result.failures.some((f) => f.code === 'A5'), 'Expected A5');
});

test('validateAgent A6: empty tools array fails', () => {
  const content = `---
name: test-agent
description: Test agent.
model: claude-sonnet-4-6
tools: []
---`;
  const result = validateAgent('/path/to/test-agent.md', content);
  assert.strictEqual(result.valid, false);
  assert.ok(result.failures.some((f) => f.code === 'A6'), 'Expected A6');
});

test('validateAgent A6: missing tools field fails', () => {
  const content = `---
name: test-agent
description: Test agent.
model: claude-sonnet-4-6
---`;
  const result = validateAgent('/path/to/test-agent.md', content);
  assert.strictEqual(result.valid, false);
  assert.ok(result.failures.some((f) => f.code === 'A6'), 'Expected A6');
});

test('validateAgent A7: governance agent with Edit tool fails', () => {
  const content = `---
name: codex-return-reviewer
description: Reviews Codex PRs.
model: claude-sonnet-4-6
tools:
  - Bash
  - Edit
---`;
  const result = validateAgent('/path/to/codex-return-reviewer.md', content);
  assert.strictEqual(result.valid, false);
  assert.ok(result.failures.some((f) => f.code === 'A7'), 'Expected A7');
});

test('validateAgent A7: governance agent with Write tool fails', () => {
  const content = `---
name: db-proof-reviewer
description: Validates T1 evidence bundles.
model: claude-sonnet-4-6
tools:
  - Read
  - Write
---`;
  const result = validateAgent('/path/to/db-proof-reviewer.md', content);
  assert.strictEqual(result.valid, false);
  assert.ok(result.failures.some((f) => f.code === 'A7'), 'Expected A7');
});

test('validateAgent A7: governance agent with Agent tool fails', () => {
  const content = `---
name: lane-reconciler
description: Reconciles ghost lanes.
model: claude-sonnet-4-6
tools:
  - Bash
  - Agent
---`;
  const result = validateAgent('/path/to/lane-reconciler.md', content);
  assert.strictEqual(result.valid, false);
  assert.ok(result.failures.some((f) => f.code === 'A7'), 'Expected A7');
});

test('validateAgent: non-governance agent with Edit and Write passes A7', () => {
  const content = `---
name: my-impl-agent
description: An implementation agent.
model: claude-sonnet-4-6
tools:
  - Bash
  - Edit
  - Write
---`;
  const result = validateAgent('/path/to/my-impl-agent.md', content);
  assert.ok(!result.failures.some((f) => f.code === 'A7'), 'Expected no A7');
});

// ── validateAgent: all valid Claude models accepted ───────────────────────────

for (const model of VALID_MODELS) {
  test(`validateAgent: model "${model}" is accepted`, () => {
    const content = `---
name: test-agent
description: Test agent.
model: ${model}
tools:
  - Read
---`;
    const result = validateAgent('/path/to/test-agent.md', content);
    assert.ok(
      !result.failures.some((f) => f.code === 'A4' || f.code === 'A5'),
      `Expected no model failure for ${model}`,
    );
  });
}

// ── validateSkill ─────────────────────────────────────────────────────────────

test('validateSkill: skill with no frontmatter has migration notes, is valid', () => {
  const result = validateSkill('/path/skill/SKILL.md', '# Skill\n\nJust a body.');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.failures.length, 0);
  assert.ok(result.migrationNotes.length >= 3, 'Expected S1, S2, S3 migration notes');
  assert.ok(result.migrationNotes.some((n) => n.startsWith('S1')));
  assert.ok(result.migrationNotes.some((n) => n.startsWith('S2')));
  assert.ok(result.migrationNotes.some((n) => n.startsWith('S3')));
});

test('validateSkill: skill with name and description still needs S3 note if no category', () => {
  const content = `---
name: my-skill
description: A test skill.
---`;
  const result = validateSkill('/path/skill/SKILL.md', content);
  assert.strictEqual(result.valid, true);
  assert.ok(result.migrationNotes.some((n) => n.startsWith('S3')));
  assert.ok(!result.migrationNotes.some((n) => n.startsWith('S1')));
  assert.ok(!result.migrationNotes.some((n) => n.startsWith('S2')));
});

test('validateSkill: fully specified skill has no migration notes', () => {
  const content = `---
name: my-skill
description: A test skill.
category: implementation
owner: codex-implementation
trigger: manual
---`;
  const result = validateSkill('/path/skill/SKILL.md', content);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.migrationNotes.length, 0);
  assert.strictEqual(result.contract?.name, 'my-skill');
  assert.strictEqual(result.contract?.category, 'implementation');
});

test('validateSkill S4: unrecognized category is a hard failure', () => {
  const content = `---
name: my-skill
description: A test skill.
category: unknown-type
---`;
  const result = validateSkill('/path/skill/SKILL.md', content);
  assert.strictEqual(result.valid, false);
  assert.ok(result.failures.some((f) => f.code === 'S4'), 'Expected S4');
});

for (const cat of SKILL_CATEGORIES) {
  test(`validateSkill: category "${cat}" is accepted`, () => {
    const content = `---
name: s
description: d
category: ${cat}
---`;
    const result = validateSkill('/path/skill/SKILL.md', content);
    assert.ok(!result.failures.some((f) => f.code === 'S4'), `Unexpected S4 for ${cat}`);
  });
}

// ── Integration: all four existing agents pass ────────────────────────────────

const EXISTING_AGENTS = [
  'codex-return-reviewer',
  'db-proof-reviewer',
  'lane-reconciler',
  'pr-risk-reviewer',
];

for (const agent of EXISTING_AGENTS) {
  test(`integration: existing agent "${agent}" passes contract validation`, () => {
    const filePath = `.claude/agents/${agent}.md`;
    const content = readFileSync(filePath, 'utf8');
    const result = validateAgent(filePath, content);
    assert.strictEqual(
      result.valid,
      true,
      `Expected ${agent} to pass but got: ${JSON.stringify(result.failures)}`,
    );
  });
}

// ── Integration: all existing skills are valid (migration notes OK, no failures) ─

const EXISTING_SKILLS = [
  'betting-domain',
  'branch-hygiene',
  'db-verify',
  'dispatch',
  'doc-truth-audit',
  'frontend-design',
  'linear-execution',
  'merge-conflict-resolution',
  'operator-surface',
  'outbox-worker',
  'pick-lifecycle',
  'promotion-routing',
  'proof-closeout',
  'repo-convergence',
  'runtime-delivery',
  'smart-form-submission',
  'supabase-migration',
  'system-state-loader',
  'web-design-guidelines',
];

for (const skill of EXISTING_SKILLS) {
  test(`integration: existing skill "${skill}" has no hard failures`, () => {
    const filePath = `.agents/skills/${skill}/SKILL.md`;
    const content = readFileSync(filePath, 'utf8');
    const result = validateSkill(filePath, content);
    assert.strictEqual(
      result.valid,
      true,
      `Expected ${skill} to be valid but got failures: ${JSON.stringify(result.failures)}`,
    );
  });
}
