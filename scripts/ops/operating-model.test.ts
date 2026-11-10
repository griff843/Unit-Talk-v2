import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRisk,
  evaluateIndependentReview,
  evaluateLeanGate,
  loadPullRequestPolicy,
  resolveOperatingMode,
  reviewerRequestsProtected,
  scanUiContent,
  standardRuleFor,
} from './operating-model.cjs';
import { TIER_C_EXACT_PATHS, TIER_C_PATH_PREFIXES } from './merge-risk.js';

const ACTIVATED = '2026-12-01T00:00:00Z';
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

test('classify: the allow-list admits plain docs, add-only unit tests and clean UI components', () => {
  const result = classifyRisk({
    files: [
      file('docs/03_product/board-layout-notes.md'),
      file('docs/archive/old.md', { status: 'removed', additions: 0, deletions: 4 }),
      addedTest('apps/api/src/odds-math.test.ts'),
      addedTest('packages/domain/src/market/market-key.test.ts'),
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

// ── Independent review ─────────────────────────────────────────────────────

test('review: a trusted-bot review bound to the exact head passes', () => {
  const result = ir({ reviews: [review()] });
  assert.equal(result.pass, true, result.reasons.join(' '));
  assert.deepEqual(result.reviewers, ['chatgpt-codex-connector']);
});

test('review: fails closed with no review, a stale-head review, an untrusted identity, or a missing head', () => {
  assert.equal(ir({ reviews: [] }).pass, false);
  assert.equal(ir({ reviews: [review({ commit_id: OLD_HEAD })] }).pass, false);
  assert.equal(ir({ reviews: [review({ user: { login: 'griff843', type: 'User' } })] }).pass, false);
  assert.equal(ir({ reviews: [review({ user: { login: 'some-app[bot]', type: 'Bot' } })] }).pass, false);
  assert.equal(ir({ reviews: [review({ user: { login: CODEX, type: 'User' } })] }).pass, false);
  assert.equal(ir({ reviews: [review({ state: 'DISMISSED' })] }).pass, false);
  assert.equal(ir({ reviews: [review({ submitted_at: null })] }).pass, false);
  assert.equal(evaluateIndependentReview({ reviews: [review()], headSha: '' }).pass, false);
  assert.equal(ir({ reviews: [review()], prAuthorLogin: CODEX }).pass, false, 'implementer can never be the reviewer');
});

test('review (adversarial): an author-resolved P0/P1 thread does not clear without a LATER clean pass at head', () => {
  // Finding raised in review 5 at T0 on the current head, author resolves it, no later pass.
  const findingReview = review({ id: 5, submitted_at: T0, body: 'Here are some automated review suggestions.' });
  const resolved = finding({}, { isResolved: true });
  const blocked = ir({ reviews: [findingReview], threads: [resolved] });
  assert.equal(blocked.pass, false, 'the finding review itself is not a clean pass');
  // Unresolved P1 blocks even with a later clean pass.
  assert.equal(ir({ reviews: [findingReview, review({ id: 6, submitted_at: T2 })], threads: [finding()] }).pass, false);
  // Resolved + later clean review at head => pass.
  assert.equal(ir({ reviews: [findingReview, review({ id: 6, submitted_at: T2 })], threads: [resolved] }).pass, true);
  // Later clean review at an OLD head does not count.
  assert.equal(ir({ reviews: [findingReview, review({ id: 6, submitted_at: T2, commit_id: OLD_HEAD })], threads: [resolved] }).pass, false);
  // Bot logins as GraphQL reports them (no [bot] suffix) are recognised as findings.
  assert.equal(ir({ reviews: [review({ id: 6, submitted_at: T2 })], threads: [finding({ author: { login: CODEX_GQL } })] }).pass, false);
});

test('review (adversarial): P0/P1 in a review BODY, CHANGES_REQUESTED, or a dismissed review need a later pass too', () => {
  const p0Body = review({ id: 7, submitted_at: T1, body: '**P0:** this drops settlement rows' });
  assert.equal(ir({ reviews: [p0Body] }).pass, false);
  const dismissed = review({ id: 7, submitted_at: T1, state: 'DISMISSED', body: '![P1 Badge] bad' });
  assert.equal(ir({ reviews: [dismissed, review({ id: 8, submitted_at: T0 })] }).pass, false, 'pass predates the dismissed finding');
  assert.equal(ir({ reviews: [dismissed, review({ id: 8, submitted_at: T2 })] }).pass, true);
  assert.equal(ir({ reviews: [review({ id: 9, state: 'CHANGES_REQUESTED', submitted_at: T1 }), review({ id: 10, submitted_at: T0 })] }).pass, false);
});

test('review (adversarial): trusted artifacts edited by another account are never clean', () => {
  const edited = finding({ body: 'nit', editor: { login: 'griff843' } }, { isResolved: true });
  assert.equal(ir({ reviews: [review({ id: 6, submitted_at: T2 })], threads: [edited] }).pass, false);
  assert.equal(ir({ reviews: [review({ editor: { login: 'griff843' } })] }).pass, false);
  assert.equal(ir({ comments: [summary({}, { editor: { login: 'griff843' } })] }).pass, false);
});

test('review: clean PR with no review object passes on the connector summary for the exact head (no deadlock)', () => {
  assert.equal(ir({ comments: [summary({})] }).pass, true);
  assert.equal(ir({ comments: [summary({ commit_sha: OLD_HEAD })] }).pass, false, 'stale summary');
  assert.equal(ir({ comments: [summary({ has_any_findings: true })] }).pass, false, 'summary with findings is not a pass');
  assert.equal(ir({ comments: [summary({ status: 'running' })] }).pass, false, 'running is not completed');
  assert.equal(ir({ comments: [summary({}, { author: { login: 'griff843', __typename: 'User' } })] }).pass, false, 'spoofed summary by a user');
  // A later summary pass clears an earlier, resolved finding; an earlier one does not.
  const resolved = finding({}, { isResolved: true });
  assert.equal(ir({ reviews: [review({ id: 5, submitted_at: T0 })], threads: [resolved], comments: [summary({}, { updatedAt: T3 })] }).pass, true);
  assert.equal(ir({ reviews: [review({ id: 5, submitted_at: T2 })], threads: [finding({ pullRequestReview: { databaseId: 5 } }, { isResolved: true })], comments: [summary({}, { updatedAt: T1 })] }).pass, false);
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
      const nodes = query.includes('reviewThreads') ? threads.map(t => ({ isResolved: t.isResolved, comments: { nodes: t.comments } }))
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
