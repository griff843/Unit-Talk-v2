import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  classifyMainCommit,
  emergencyRecordReferencesSha,
  type CommitClassificationInput,
} from './direct-main-push-guard.js';
import { createTempWorkspace } from '../ops/temp-workspace.js';

const INCIDENT_SHA = '74eb6cd65da829cb969a4a7819494a1d3747ccb2';

function input(overrides: Partial<CommitClassificationInput> = {}): CommitClassificationInput {
  return {
    sha: INCIDENT_SHA,
    authorLogin: 'griff843',
    message: 'chore(proof): bind proof to merge SHA and add T1 runtime proof',
    associatedPrNumbers: [],
    ...overrides,
  };
}

// ── legitimate GitHub merge / squash merge commits ──────────────────────────────

test('classifyMainCommit: a commit with an associated PR is pr_merge, regardless of author', () => {
  const result = classifyMainCommit(input({ associatedPrNumbers: [1216] }));
  assert.strictEqual(result.code, 'pr_merge');
  assert.match(result.reason, /#1216/);
});

// ── explicitly authorized automation ─────────────────────────────────────────────

const LANE_CLOSE_MESSAGE = 'chore(lanes): close UTV2-9999 — lane closed, sync file removed';
const LANE_CLOSE_SCOPED_FILES = [
  'docs/06_status/lanes/UTV2-9999.json',
  'docs/06_status/proof/UTV2-9999/evidence.json',
  '.ops/sync/UTV2-9999.yml',
];

test('classifyMainCommit: github-actions[bot] with the allow-listed lane-close message AND only in-scope changed files is authorized_automation', () => {
  const result = classifyMainCommit(
    input({
      authorLogin: 'github-actions[bot]',
      message: LANE_CLOSE_MESSAGE,
      associatedPrNumbers: [],
      changedFiles: LANE_CLOSE_SCOPED_FILES,
    }),
  );
  assert.strictEqual(result.code, 'authorized_automation');
});

test('classifyMainCommit: the scheduled readiness-ledger commit is authorized only for the ledger file itself (UTV2-1626)', () => {
  const authorized = classifyMainCommit(
    input({
      authorLogin: 'github-actions[bot]',
      message: 'ops(readiness): refresh ledger [skip ci]',
      associatedPrNumbers: [],
      changedFiles: ['docs/06_status/readiness/readiness-score.json'],
    }),
  );
  assert.strictEqual(authorized.code, 'authorized_automation');

  const widened = classifyMainCommit(
    input({
      authorLogin: 'github-actions[bot]',
      message: 'ops(readiness): refresh ledger [skip ci]',
      associatedPrNumbers: [],
      changedFiles: ['docs/06_status/readiness/readiness-score.json', '.github/workflows/merge-gate.yml'],
    }),
  );
  assert.strictEqual(widened.code, 'unauthorized_direct_push');
});

test('classifyMainCommit: github-actions[bot] with an UNLISTED message pattern is NOT auto-authorized', () => {
  const result = classifyMainCommit(
    input({
      authorLogin: 'github-actions[bot]',
      message: 'chore: some other automated change not on the allow-list',
      associatedPrNumbers: [],
      changedFiles: LANE_CLOSE_SCOPED_FILES,
    }),
  );
  assert.strictEqual(result.code, 'unauthorized_direct_push');
});

test('classifyMainCommit: a human identity is never treated as automation even with a matching message text', () => {
  const result = classifyMainCommit(
    input({
      authorLogin: 'griff843',
      message: LANE_CLOSE_MESSAGE,
      associatedPrNumbers: [],
      changedFiles: LANE_CLOSE_SCOPED_FILES,
    }),
  );
  assert.strictEqual(result.code, 'unauthorized_direct_push');
});

// ── message pattern alone is never sufficient -- changed files must also match ──

test('classifyMainCommit: github-actions[bot] with the allow-listed message but a file OUTSIDE its known scope is NOT authorized_automation', () => {
  const result = classifyMainCommit(
    input({
      authorLogin: 'github-actions[bot]',
      message: LANE_CLOSE_MESSAGE,
      associatedPrNumbers: [],
      changedFiles: [...LANE_CLOSE_SCOPED_FILES, 'apps/api/src/server.ts'],
    }),
  );
  assert.strictEqual(result.code, 'unauthorized_direct_push');
});

test('classifyMainCommit: github-actions[bot] with the allow-listed message but NO changedFiles evidence is NOT authorized (never authorizes on message text alone)', () => {
  const result = classifyMainCommit(
    input({
      authorLogin: 'github-actions[bot]',
      message: LANE_CLOSE_MESSAGE,
      associatedPrNumbers: [],
      // changedFiles intentionally omitted
    }),
  );
  assert.strictEqual(result.code, 'unauthorized_direct_push');
});

// ── documented emergency exceptions ──────────────────────────────────────────────

function makeTmpIncidentsRoot(): { root: string; incidentsDir: string } {
  const root = createTempWorkspace('direct-main-push-guard-test-');
  const incidentsDir = path.join(root, 'docs', '06_status', 'INCIDENTS');
  fs.mkdirSync(incidentsDir, { recursive: true });
  return { root, incidentsDir };
}

test('emergencyRecordReferencesSha: true only when the file exists, is under INCIDENTS/, and mentions the SHA', () => {
  const { root, incidentsDir } = makeTmpIncidentsRoot();
  const recordPath = path.join(incidentsDir, 'INC-2026-01-01-example.md');
  fs.writeFileSync(recordPath, `mentions ${INCIDENT_SHA} as an emergency bypass`);

  assert.strictEqual(
    emergencyRecordReferencesSha('docs/06_status/INCIDENTS/INC-2026-01-01-example.md', INCIDENT_SHA, root),
    true,
  );
  assert.strictEqual(
    emergencyRecordReferencesSha('docs/06_status/INCIDENTS/does-not-exist.md', INCIDENT_SHA, root),
    false,
  );
  assert.strictEqual(
    emergencyRecordReferencesSha('docs/06_status/INCIDENTS/INC-2026-01-01-example.md', 'some-other-sha', root),
    false,
  );
});

test('emergencyRecordReferencesSha: refuses to follow a trailer path outside docs/06_status/INCIDENTS/', () => {
  const { root } = makeTmpIncidentsRoot();
  const outsidePath = path.join(root, 'secrets.env');
  fs.writeFileSync(outsidePath, INCIDENT_SHA);
  assert.strictEqual(emergencyRecordReferencesSha('../secrets.env', INCIDENT_SHA, root), false);
  assert.strictEqual(emergencyRecordReferencesSha('secrets.env', INCIDENT_SHA, root), false);
});

test('classifyMainCommit: a commit with a valid Emergency-Bypass-Record trailer is documented_emergency_exception', () => {
  const result = classifyMainCommit(
    input({
      message: [
        'fix(prod): emergency hotfix for live outage',
        '',
        'Emergency-Bypass-Record: docs/06_status/INCIDENTS/INC-2026-01-01-example.md',
      ].join('\n'),
    }),
    { checkEmergencyRecord: () => true },
  );
  assert.strictEqual(result.code, 'documented_emergency_exception');
});

test('classifyMainCommit: an Emergency-Bypass-Record trailer that does not resolve to a real, matching doc is still unauthorized', () => {
  const result = classifyMainCommit(
    input({
      message: [
        'chore(proof): bind proof to merge SHA',
        '',
        'Emergency-Bypass-Record: docs/06_status/INCIDENTS/does-not-exist.md',
      ].join('\n'),
    }),
    { checkEmergencyRecord: () => false },
  );
  assert.strictEqual(result.code, 'unauthorized_direct_push');
});

// ── unauthorized human direct pushes: the exact incident this guard was built for ─

test('classifyMainCommit: reproduces the real incident -- no PR, human author, no bypass trailer -> unauthorized_direct_push', () => {
  const result = classifyMainCommit(
    input({
      sha: INCIDENT_SHA,
      authorLogin: 'griff843',
      message:
        'chore(proof): UTV2-1533 bind proof to merge SHA and add T1 runtime proof\n\n' +
        'Binds evidence.json/verification.md to the real merge commit 8ca5acf3...',
      associatedPrNumbers: [],
    }),
  );
  assert.strictEqual(result.code, 'unauthorized_direct_push');
  assert.match(result.reason, /no associated PR/);
});

test('classifyMainCommit: an unknown/null author login with no PR is unauthorized_direct_push (fails closed, not silently trusted)', () => {
  const result = classifyMainCommit(input({ authorLogin: null, associatedPrNumbers: [] }));
  assert.strictEqual(result.code, 'unauthorized_direct_push');
});


// ── .claude/settings.json permissions (WORK-2026102601, R3) ─────────────────────
// Static regression guard for the defense-in-depth permission rules. These rules match command
// text, so interpreter wrappers can evade them; the primary boundaries are scoped credentials
// and server-side branch protection. This pins what the rules must keep stopping and what
// governed workflows must keep running. Harness behaviour (deny in default and
// bypassPermissions mode) is recorded in the lane proof, not re-run here.
//
// `permissions.ask` is an interactive confirmation prompt ONLY. It is not Griff's authorization
// and does not replace the governed production migration/change approval or any other reserved
// action (docs/mission/intent.md, DB_MIGRATION_WORKFLOW.md, SUPABASE_BRANCH_COST_POLICY.md):
// those operator-approval requirements remain binding and are verified independently of this file.
//
// `mcp__claude_ai_Supabase__execute_sql` is write-capable and is NOT restricted by these rules.
// Closing that gap needs connector scoping (R2), not this change.
type Permissions = { deny?: string[]; ask?: string[] };

const settings = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '.claude/settings.json'), 'utf8')) as {
  hooks?: unknown;
  permissions?: Permissions;
};
const deny = settings.permissions?.deny ?? [];
const ask = settings.permissions?.ask ?? [];

// `Bash(<pattern>)` where `*` matches any run of characters, anchored at both ends.
function bashPatterns(rules: string[]): RegExp[] {
  return rules
    .map((rule) => /^Bash\((.*)\)$/.exec(rule)?.[1])
    .filter((pattern): pattern is string => pattern !== undefined)
    .map((pattern) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`));
}
const matches = (rules: string[], command: string) => bashPatterns(rules).some((re) => re.test(command));

const MUST_DENY = [
  'git push origin main',
  'git push origin HEAD:main',
  'git push origin HEAD:refs/heads/main',
  'git push origin feature-x --force',
  'git push --force-with-lease origin feature-x',
  'git push -f origin feature-x',
  'git -C . push origin main',
  'git -c core.x=1 push origin main',
  "sh -c 'git push origin main'",
  "bash -c 'git push origin main'",
  'gh pr merge 1778 --admin --squash',
  'gh api -X DELETE repos/griff843/Unit-Talk-v2/git/refs/heads/x',
  'supabase db reset --linked',
  'supabase migration repair --status applied 20260101000000',
  'supabase functions deploy x',
  'supabase secrets set A=b',
  "curl -s -X POST http://127.0.0.1:9/api/discord/kill-switch -d '{}'",
  'curl -s -X POST http://127.0.0.1:9/api/picks/x/retry-delivery',
];
const MUST_ASK = ['supabase db push --project-ref abc', 'supabase db push --linked'];
const MUST_STILL_RUN = [
  'git push origin HEAD:claude/work-x-feature',
  'git push -u origin main-sync-fix',
  'git push origin work/utv2-1-fix',
  'git fetch origin && git pull --ff-only origin main',
  'gh pr merge 5 --squash --auto',
  'gh pr view 5 --json state',
  'gh api repos/griff843/Unit-Talk-v2/branches/main/protection',
  'supabase db reset',
  'supabase migration list --linked',
  'curl -s http://127.0.0.1:4000/health',
];
const MUST_DENY_TOOLS = [
  'mcp__claude_ai_Supabase__deploy_edge_function',
  'mcp__claude_ai_Supabase__create_edge_function_secret',
  'mcp__claude_ai_Supabase__create_branch',
  'mcp__claude_ai_Supabase__merge_branch',
  'mcp__claude_ai_Supabase__reset_branch',
  'mcp__claude_ai_Supabase__create_project',
  'mcp__claude_ai_Supabase__pause_project',
  'mcp__claude_ai_Supabase__restore_project',
];
const MUST_ASK_TOOLS = ['mcp__claude_ai_Supabase__apply_migration', 'mcp__claude_ai_Supabase__delete_branch'];
const MUST_STAY_AVAILABLE_READ_TOOLS = [
  'mcp__claude_ai_Supabase__list_tables',
  'mcp__claude_ai_Supabase__query_logs',
];
const WRITE_CAPABLE_TOOL_NOT_RESTRICTED = 'mcp__claude_ai_Supabase__execute_sql';

test('claude settings permissions: dangerous direct and wrapped commands are denied', () => {
  for (const command of MUST_DENY) {
    assert.ok(matches(deny, command), `not denied: ${command}`);
  }
});

// Interactive confirmation only: the prompt is not an authorization record and grants nothing.
test('claude settings permissions: operator-approval commands prompt interactively instead of being hard-denied', () => {
  for (const command of MUST_ASK) {
    assert.ok(matches(ask, command), `not ask-gated: ${command}`);
    assert.ok(!matches(deny, command), `hard-denied, would block the operator-authorized flow: ${command}`);
  }
});

test('claude settings permissions: governed engineering workflows are not blocked or prompted', () => {
  for (const command of MUST_STILL_RUN) {
    assert.ok(!matches(deny, command), `wrongly denied: ${command}`);
    assert.ok(!matches(ask, command), `wrongly prompted: ${command}`);
  }
});

test('claude settings permissions: listed Supabase MCP write tools are denied or prompt; read-only tools stay available', () => {
  for (const tool of MUST_DENY_TOOLS) assert.ok(deny.includes(tool), `not denied: ${tool}`);
  for (const tool of MUST_ASK_TOOLS) assert.ok(ask.includes(tool), `not ask-gated: ${tool}`);
  for (const tool of MUST_STAY_AVAILABLE_READ_TOOLS) {
    assert.ok(!deny.includes(tool) && !ask.includes(tool), `read tool restricted: ${tool}`);
  }
});

// Documents a known limitation; asserts no read-only isolation. execute_sql can write (DML/DDL).
test('claude settings permissions: execute_sql is write-capable and is not restricted by these rules (limitation, needs R2)', () => {
  assert.ok(
    !deny.includes(WRITE_CAPABLE_TOOL_NOT_RESTRICTED) && !ask.includes(WRITE_CAPABLE_TOOL_NOT_RESTRICTED),
    'execute_sql is now restricted: update this test and the limitation text deliberately',
  );
});

test('claude settings permissions: existing hooks are untouched by the permissions block', () => {
  assert.ok(settings.hooks, 'hooks block missing');
});
