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

// ---------------------------------------------------------------------------
// --strict semantic checks
// ---------------------------------------------------------------------------

/** Build a bundle with rich evidence blocks that satisfy all semantic checks. */
function semanticBundle(): string {
  return `# UTV2-600 — Evidence Bundle

## Metadata

| Field | Value |
|---|---|
| Issue ID | UTV2-600 |
| Tier | T1 |
| Phase / Gate | Phase 7 — governance |
| Owner | claude/semantic-lane |
| Date | 2026-04-13 |
| Verifier Identity | claude/session-sem001 |
| Commit SHA(s) | abc1234 |
| Related PRs | #100 |

## Scope

**Claims:**
- semantic checks work

**Does NOT claim:**
- nothing

## Assertions

| # | Assertion | Evidence Type | Source | Result | Evidence Ref |
|---|---|---|---|---|---|
| 1 | db query works | db-query | live DB \`feownrheeefbcsehtsiw\` | PASS | [E1](#e1) |
| 2 | test passes | test | scripts/foo.test.ts | PASS | [E2](#e2) |
| 3 | fixture valid | fixture | data/snap.json | PASS | [E3](#e3) |
| 4 | http call ok | http | api endpoint | PASS | [E4](#e4) |
| 5 | repo truth | repo-truth | git history | PASS | [E5](#e5) |

## Evidence Blocks

### E1 db query works

Project ref: \`feownrheeefbcsehtsiw\`
Run at: 2026-04-13T10:30:00Z
\`\`\`sql
SELECT count(*) FROM picks;
\`\`\`
Result: 42 rows

### E2 test passes

File: scripts/foo.test.ts
Command: tsx --test scripts/foo.test.ts
Output:
ok 3 - all assertions passed

### E3 fixture valid

Path: data/snapshots/picks.json
Content hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

### E4 http call ok

curl -s https://api.example.com/health
HTTP 200 OK
Response: {"status":"ok"}

### E5 repo truth

git log --oneline -3
abc1234 feat: something
def5678 fix: another thing

## Acceptance Criteria Mapping

| Acceptance Criterion (verbatim from Linear) | Assertion # |
|---|---|
| semantic checks work | 1 |

## Stop Conditions Encountered

None

## Sign-off

**Verifier:** claude/session-sem001 — 2026-04-13
**PM acceptance:** pending
`;
}

test('default validation of semantic bundle produces zero findings', () => {
  const findings = validateBundle(semanticBundle());
  assert.deepEqual(findings, [], `expected zero findings, got: ${JSON.stringify(findings, null, 2)}`);
});

test('strict validation of well-formed semantic bundle produces zero findings', () => {
  const findings = validateBundle(semanticBundle(), { strict: true });
  assert.deepEqual(findings, [], `expected zero findings, got: ${JSON.stringify(findings, null, 2)}`);
});

// --- db-query semantic negatives ---

test('strict: db-query missing sql fence is flagged', () => {
  const broken = semanticBundle().replace('```sql', '```text');
  const findings = validateBundle(broken, { strict: true });
  const codes = findings.map((f: { code: string }) => f.code);
  assert.ok(codes.includes('semantic-db-query-missing-sql-fence'), `got ${codes.join(',')}`);
});

test('strict: db-query missing project ref is flagged', () => {
  // Replace only the evidence block project ref, not the one in the assertions table
  const broken = semanticBundle().replace(
    'Project ref: `feownrheeefbcsehtsiw`',
    'Project ref: `some-other-project`',
  );
  const findings = validateBundle(broken, { strict: true });
  const codes = findings.map((f: { code: string }) => f.code);
  assert.ok(codes.includes('semantic-db-query-missing-project-ref'), `got ${codes.join(',')}`);
});

test('strict: db-query missing timestamp is flagged', () => {
  const broken = semanticBundle().replace('2026-04-13T10:30:00Z', 'yesterday');
  const findings = validateBundle(broken, { strict: true });
  const codes = findings.map((f: { code: string }) => f.code);
  assert.ok(codes.includes('semantic-db-query-missing-timestamp'), `got ${codes.join(',')}`);
});

// --- test semantic negatives ---

test('strict: test missing test-file-path is flagged', () => {
  // Replace evidence block file refs but not the assertions table Source column
  const broken = semanticBundle()
    .replace('File: scripts/foo.test.ts', 'File: scripts/foo.ts')
    .replace('tsx --test scripts/foo.test.ts', 'tsx --test scripts/foo.ts');
  const findings = validateBundle(broken, { strict: true });
  const codes = findings.map((f: { code: string }) => f.code);
  assert.ok(codes.includes('semantic-test-missing-test-file-path'), `got ${codes.join(',')}`);
});

test('strict: test missing test-command is flagged', () => {
  const broken = semanticBundle().replace('tsx --test', 'npx run');
  const findings = validateBundle(broken, { strict: true });
  const codes = findings.map((f: { code: string }) => f.code);
  assert.ok(codes.includes('semantic-test-missing-test-command'), `got ${codes.join(',')}`);
});

test('strict: test missing test-output is flagged', () => {
  const broken = semanticBundle().replace('ok 3 - all assertions passed', 'all passed');
  const findings = validateBundle(broken, { strict: true });
  const codes = findings.map((f: { code: string }) => f.code);
  assert.ok(codes.includes('semantic-test-missing-test-output'), `got ${codes.join(',')}`);
});

// --- fixture semantic negatives ---

test('strict: fixture missing content-hash is flagged', () => {
  const broken = semanticBundle().replace('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'checksum: unknown');
  const findings = validateBundle(broken, { strict: true });
  const codes = findings.map((f: { code: string }) => f.code);
  assert.ok(codes.includes('semantic-fixture-missing-content-hash'), `got ${codes.join(',')}`);
});

// --- http semantic negatives ---

test('strict: http missing http-method is flagged', () => {
  const broken = semanticBundle().replace('curl -s', 'request');
  const findings = validateBundle(broken, { strict: true });
  const codes = findings.map((f: { code: string }) => f.code);
  assert.ok(codes.includes('semantic-http-missing-http-method'), `got ${codes.join(',')}`);
});

test('strict: http missing status-code is flagged', () => {
  const broken = semanticBundle().replace('HTTP 200 OK', 'response OK');
  const findings = validateBundle(broken, { strict: true });
  const codes = findings.map((f: { code: string }) => f.code);
  assert.ok(codes.includes('semantic-http-missing-status-code'), `got ${codes.join(',')}`);
});

// --- repo-truth semantic negatives ---

test('strict: repo-truth missing git-command is flagged', () => {
  const broken = semanticBundle().replace('git log --oneline -3', 'checked the history');
  const findings = validateBundle(broken, { strict: true });
  const codes = findings.map((f: { code: string }) => f.code);
  assert.ok(codes.includes('semantic-repo-truth-missing-git-command'), `got ${codes.join(',')}`);
});

// --- confirm non-strict is unchanged ---

test('non-strict validation ignores semantic issues', () => {
  // Break every semantic element but keep mechanical structure intact
  let broken = semanticBundle();
  broken = broken.replace('```sql', '```text');
  broken = broken.replace('tsx --test', 'npx run');
  broken = broken.replace('ok 3', 'done 3');
  const findings = validateBundle(broken);
  // Should have zero findings — all mechanical checks still pass
  assert.deepEqual(findings, [], `expected zero findings in non-strict mode, got: ${JSON.stringify(findings, null, 2)}`);
});
