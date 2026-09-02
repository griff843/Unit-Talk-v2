import test from 'node:test';
import assert from 'node:assert/strict';
import {
  globToRegExp,
  loadPolicy,
  classifyDiff,
  evaluateMergeAuthority,
} from './merge-authority.cjs';


const policy = loadPolicy();

function file(filename: string, patch?: string, status = 'modified') {
  return { filename, patch, status };
}

// ── glob semantics ────────────────────────────────────────────────────────
// These are the primitive the whole boundary rests on. If `**/` stopped
// matching zero directories, `supabase/**/*.sql` would silently stop
// reserving `supabase/foo.sql`.

test('** spans separators and also matches zero directories', () => {
  assert.ok(globToRegExp('supabase/**/*.sql').test('supabase/foo.sql'));
  assert.ok(globToRegExp('supabase/**/*.sql').test('supabase/a/b/foo.sql'));
  assert.ok(globToRegExp('supabase/migrations/**').test('supabase/migrations/001.sql'));
});

test('single * does not span separators', () => {
  assert.ok(globToRegExp('apps/*/package.json').test('apps/api/package.json'));
  assert.ok(!globToRegExp('apps/*/package.json').test('apps/api/sub/package.json'));
});

test('dots are literal, not wildcards', () => {
  assert.ok(globToRegExp('**/.env').test('apps/api/.env'));
  assert.ok(!globToRegExp('**/.env').test('apps/api/xenv'));
});

// ── auto authority ────────────────────────────────────────────────────────

test('an ordinary app diff is authorized automatically', () => {
  const result = classifyDiff({
    files: [file('apps/smart-form/lib/form-utils.ts', '+const x = 1;')],
    policy,
  });
  assert.equal(result.authority, 'auto');
  assert.deepEqual(result.reasons, []);
});

test('auto authority yields an authorized verdict with no label and no verdict comment', () => {
  const result = evaluateMergeAuthority({
    files: [file('apps/smart-form/lib/form-utils.ts', '+const x = 1;')],
    policy,
    labels: [],
    verdictApproved: false,
  });
  assert.equal(result.authority, 'auto');
  assert.equal(result.authorized, true);
  assert.deepEqual(result.errors, []);
});

// ── each reserved surface actually reserves ───────────────────────────────
// One case per surface. A surface that stops matching must fail here rather
// than silently start auto-merging.

const RESERVED_CASES: Array<[string, string]> = [
  ['production-ddl-and-data', 'supabase/migrations/20260902_add_thing.sql'],
  ['member-delivery-activation', 'apps/api/src/routes/kill-switch.ts'],
  ['secrets', 'apps/api/.env.production'],
  ['pricing-and-tier-authority', 'docs/05_operations/MEMBER_TIER_MODEL_CONTRACT.md'],
  ['production-containment', 'docs/05_operations/STANDING_GUARDRAILS.md'],
  ['merge-authority', '.github/workflows/merge-gate.yml'],
];

for (const [surfaceId, filename] of RESERVED_CASES) {
  test(`${surfaceId} is reserved when ${filename} is touched`, () => {
    const result = classifyDiff({ files: [file(filename, '+x')], policy });
    assert.equal(result.authority, 'human');
    assert.ok(
      result.surfaces.includes(surfaceId),
      `expected surface ${surfaceId}, got ${result.surfaces.join(',')}`
    );
  });
}

test('RMA cannot widen its own authority: editing the policy file is reserved', () => {
  const result = classifyDiff({
    files: [file('docs/05_operations/RESERVED_RISK_SURFACES.json', '+x')],
    policy,
  });
  assert.equal(result.authority, 'human');
  assert.ok(result.surfaces.includes('merge-authority'));
});

test('RMA cannot widen its own authority: editing the classifier is reserved', () => {
  const result = classifyDiff({ files: [file('scripts/ops/merge-authority.cjs', '+x')], policy });
  assert.equal(result.authority, 'human');
});

// ── destructive SQL content rule ──────────────────────────────────────────

test('destructive SQL in an added line is reserved even outside reserved paths', () => {
  const result = classifyDiff({
    files: [file('scripts/cleanup.ts', "+  await db.query('DELETE FROM picks');")],
    policy,
  });
  assert.equal(result.authority, 'human');
  assert.ok(result.surfaces.includes('destructive-sql'));
});

test('destructive SQL only in a REMOVED line does not reserve', () => {
  const result = classifyDiff({
    files: [file('scripts/cleanup.ts', "-  await db.query('DELETE FROM picks');\n+  return;")],
    policy,
  });
  assert.equal(result.authority, 'auto');
});

test('DROP TABLE is reserved', () => {
  const result = classifyDiff({
    files: [file('scripts/x.ts', '+const sql = `DROP TABLE picks`;')],
    policy,
  });
  assert.equal(result.authority, 'human');
});

// ── fail-closed behaviour ─────────────────────────────────────────────────
// The point of a fail-closed control is that absence of evidence reserves.

test('a missing changed-file list reserves the merge', () => {
  const result = classifyDiff({ files: undefined as never, policy });
  assert.equal(result.authority, 'human');
  assert.ok(result.surfaces.includes('unclassifiable'));
});

test('an empty changed-file list reserves the merge', () => {
  const result = classifyDiff({ files: [], policy });
  assert.equal(result.authority, 'human');
});

test('a file with no available patch reserves the merge', () => {
  const result = classifyDiff({ files: [file('scripts/huge.ts', undefined)], policy });
  assert.equal(result.authority, 'human');
  assert.ok(result.surfaces.includes('unclassifiable'));
});

test('a deleted file with no patch does not reserve on that basis alone', () => {
  const result = classifyDiff({ files: [file('apps/web/src/old.ts', undefined, 'removed')], policy });
  assert.equal(result.authority, 'auto');
});

test('a malformed policy reserves the merge rather than throwing', () => {
  const result = evaluateMergeAuthority({
    files: [file('apps/web/src/x.ts', '+x')],
    policy: { schema: 'reserved-risk-surfaces/v1', surfaces: null } as never,
    labels: [],
    verdictApproved: false,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authority, 'human');
});

// ── reserved-path approval requirements ───────────────────────────────────

test('reserved diff with neither label nor verdict is blocked, citing both', () => {
  const result = evaluateMergeAuthority({
    files: [file('supabase/migrations/001.sql', '+x')],
    policy,
    labels: [],
    verdictApproved: false,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.errors.length, 2);
});

test('reserved diff with label but no verdict is still blocked', () => {
  const result = evaluateMergeAuthority({
    files: [file('supabase/migrations/001.sql', '+x')],
    policy,
    labels: ['griff-approved'],
    verdictApproved: false,
  });
  assert.equal(result.authorized, false);
});

test('reserved diff with verdict but no label is still blocked', () => {
  const result = evaluateMergeAuthority({
    files: [file('supabase/migrations/001.sql', '+x')],
    policy,
    labels: [],
    verdictApproved: true,
  });
  assert.equal(result.authorized, false);
});

test('reserved diff with both label and head-bound verdict is authorized', () => {
  const result = evaluateMergeAuthority({
    files: [file('supabase/migrations/001.sql', '+x')],
    policy,
    labels: ['griff-approved'],
    verdictApproved: true,
  });
  assert.equal(result.authorized, true);
  assert.equal(result.authority, 'human');
});

test('caller-supplied verdict errors are surfaced verbatim', () => {
  // Head-SHA binding and latest-verdict-wins live in merge-gate-verdict.cjs and
  // are covered by its suite; this asserts the plumbing carries their reasons
  // through instead of masking them with a generic message.
  const result = evaluateMergeAuthority({
    files: [file('supabase/migrations/001.sql', '+x')],
    policy,
    labels: ['griff-approved'],
    verdictApproved: false,
    verdictErrors: ['Most recent PM verdict is "CHANGES_REQUIRED", not "APPROVED".'],
  });
  assert.equal(result.authorized, false);
  assert.match(result.errors.join(' '), /CHANGES_REQUIRED/);
});

test('the legacy t1-approved label still satisfies the label requirement', () => {
  const result = evaluateMergeAuthority({
    files: [file('supabase/migrations/001.sql', '+x')],
    policy,
    labels: ['t1-approved'],
    verdictApproved: true,
  });
  assert.equal(result.authorized, true);
});

// ── kill switch ───────────────────────────────────────────────────────────

test('governance:pause blocks an otherwise auto-authorized diff', () => {
  const result = evaluateMergeAuthority({
    files: [file('apps/web/src/x.ts', '+x')],
    policy,
    labels: ['governance:pause'],
    verdictApproved: false,
  });
  assert.equal(result.authorized, false);
  assert.match(result.errors.join(' '), /governance:pause/);
});

// ── surface exclusions ────────────────────────────────────────────────────
// `.env.example` is a committed template of variable NAMES. Reserving it
// priced a docs edit like a credential rotation; that over-reservation is
// what made the previous model collapse into "everything is T1".

test('.env.example is not treated as a secret', () => {
  const result = classifyDiff({ files: [file('apps/smart-form/.env.example', '+FOO=')], policy });
  assert.equal(result.authority, 'auto');
});

test('a real .env file is still reserved', () => {
  const result = classifyDiff({ files: [file('apps/smart-form/.env.production', '+FOO=x')], policy });
  assert.equal(result.authority, 'human');
  assert.ok(result.surfaces.includes('secrets'));
});

test('an exclusion in one surface cannot release a file another surface reserves', () => {
  // deploy.yml is reserved as `secrets`; it is not excludable via .env globs.
  const result = classifyDiff({ files: [file('.github/workflows/deploy.yml', '+x')], policy });
  assert.equal(result.authority, 'human');
});
