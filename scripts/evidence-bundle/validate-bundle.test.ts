// Tests for scripts/evidence-bundle/validate-bundle.mjs
// Run: tsx --test scripts/evidence-bundle/validate-bundle.test.ts
//
// Uses node:test + node:assert/strict — matches repo convention (no Jest, no Vitest).

import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error — importing a sibling .mjs module with no types
import { validateBundle, parseBundle, parseMarkdownTable, parseFieldTable } from './validate-bundle.mjs';

function validBundle(): string {
  return `# UTV2-532 — Evidence Bundle

## Metadata

| Field | Value |
|---|---|
| Issue ID | UTV2-532 |
| Tier | T2 |
| Phase / Gate | Governance — evidence-bundle standardization |
| Owner | claude/test-lane |
| Date | 2026-04-11 |
| Verifier Identity | claude/session-abc123 |
| Commit SHA(s) | deadbee |
| Related PRs | #999 |

## Scope

**Claims:**
- template, generator, validator all shipped

**Does NOT claim:**
- retrofit of existing bundles

## Assertions

| # | Assertion | Evidence Type | Source | Result | Evidence Ref |
|---|---|---|---|---|---|
| 1 | template file exists | repo-truth | docs/05_operations | PASS | [E1](#e1) |
| 2 | validator rejects placeholder | test | scripts/evidence-bundle/validate-bundle.test.ts | PASS | [E2](#e2) |
| 3 | legacy bundle retrofit | fixture | n/a | WAIVED | approved by: PM on 2026-04-11 |

## Evidence Blocks

### E1 template file exists

repo-truth evidence: file exists on main.

### E2 validator rejects placeholder

Test evidence: this test file contains a case that asserts placeholder detection.

### E3 legacy bundle retrofit

Waiver: out of scope for UTV2-532 — tracked as follow-up.
Approved by: PM on 2026-04-11.

## Acceptance Criteria Mapping

| Acceptance Criterion (verbatim from Linear) | Assertion # |
|---|---|
| canonical template exists | 1 |
| validator enforces shape rules | 2 |

## Stop Conditions Encountered

None

## Sign-off

**Verifier:** claude/session-abc123 — 2026-04-11 12:00 UTC
**PM acceptance:** pending
`;
}

test('parseBundle extracts all seven required sections', () => {
  const sections = parseBundle(validBundle());
  for (const name of [
    'Metadata',
    'Scope',
    'Assertions',
    'Evidence Blocks',
    'Acceptance Criteria Mapping',
    'Stop Conditions Encountered',
    'Sign-off',
  ]) {
    assert.ok(sections.has(name), `missing section ${name}`);
  }
});

test('parseMarkdownTable parses assertions table', () => {
  const sections = parseBundle(validBundle());
  const { rows } = parseMarkdownTable(sections.get('Assertions')!);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]['#'], '1');
  assert.equal(rows[0]['Result'], 'PASS');
});

test('parseFieldTable parses metadata', () => {
  const sections = parseBundle(validBundle());
  const fields = parseFieldTable(sections.get('Metadata')!);
  assert.equal(fields.get('Issue ID'), 'UTV2-532');
  assert.equal(fields.get('Verifier Identity'), 'claude/session-abc123');
});

test('valid bundle produces zero findings', () => {
  const findings = validateBundle(validBundle());
  assert.deepEqual(findings, [], `expected zero findings, got: ${JSON.stringify(findings, null, 2)}`);
});

test('missing metadata field is flagged', () => {
  const broken = validBundle().replace('| Tier | T2 |\n', '');
  const findings = validateBundle(broken);
  const codes = findings.map((f: { code: string }) => f.code);
  assert.ok(codes.includes('metadata-field-missing'), `expected metadata-field-missing, got ${codes.join(',')}`);
});

test('PASS assertion without matching evidence block is flagged', () => {
  // Remove the "### E1" block heading
  const broken = validBundle().replace('### E1 template file exists', '### Z1 template file exists');
  const findings = validateBundle(broken);
  const codes = findings.map((f: { code: string }) => f.code);
  assert.ok(
    codes.includes('missing-evidence-block'),
    `expected missing-evidence-block, got ${codes.join(',')}`,
  );
});

test('WAIVED without approver is flagged', () => {
  const broken = validBundle().replace(
    '| 3 | legacy bundle retrofit | fixture | n/a | WAIVED | approved by: PM on 2026-04-11 |',
    '| 3 | legacy bundle retrofit | fixture | n/a | WAIVED | see notes |',
  );
  const findings = validateBundle(broken);
  const codes = findings.map((f: { code: string }) => f.code);
  assert.ok(
    codes.includes('waived-without-approver'),
    `expected waived-without-approver, got ${codes.join(',')}`,
  );
});

test('verifier identity of literal "claude" is flagged', () => {
  const broken = validBundle().replace(
    '| Verifier Identity | claude/session-abc123 |',
    '| Verifier Identity | claude |',
  );
  const findings = validateBundle(broken);
  const codes = findings.map((f: { code: string }) => f.code);
  assert.ok(
    codes.includes('verifier-too-generic'),
    `expected verifier-too-generic, got ${codes.join(',')}`,
  );
});

test('placeholder TODO in evidence ref is flagged', () => {
  const broken = validBundle().replace('[E1](#e1)', 'TODO');
  const findings = validateBundle(broken);
  const codes = findings.map((f: { code: string }) => f.code);
  assert.ok(
    codes.includes('placeholder-evidence-ref'),
    `expected placeholder-evidence-ref, got ${codes.join(',')}`,
  );
});

test('empty assertions table is flagged', () => {
  const broken = validBundle().replace(
    /## Assertions[\s\S]*?## Evidence Blocks/,
    `## Assertions

| # | Assertion | Evidence Type | Source | Result | Evidence Ref |
|---|---|---|---|---|---|

## Evidence Blocks`,
  );
  const findings = validateBundle(broken);
  const codes = findings.map((f: { code: string }) => f.code);
  assert.ok(codes.includes('assertions-empty'), `expected assertions-empty, got ${codes.join(',')}`);
});

test('missing acceptance criteria mapping rows is flagged', () => {
  const broken = validBundle().replace(
    /## Acceptance Criteria Mapping[\s\S]*?## Stop Conditions Encountered/,
    `## Acceptance Criteria Mapping

| Acceptance Criterion (verbatim from Linear) | Assertion # |
|---|---|

## Stop Conditions Encountered`,
  );
  const findings = validateBundle(broken);
  const codes = findings.map((f: { code: string }) => f.code);
  assert.ok(
    codes.includes('acceptance-mapping-empty'),
    `expected acceptance-mapping-empty, got ${codes.join(',')}`,
  );
});
