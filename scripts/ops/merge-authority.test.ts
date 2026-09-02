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

// ── renames ───────────────────────────────────────────────────────────────
// GitHub reports a rename as `filename` (destination) + `previous_filename`
// (source). Classifying only the destination let a reserved path walk out of
// its surface: `git mv .github/CODEOWNERS notes.txt` deletes the ownership
// boundary in a diff that, read by destination alone, touches nothing reserved.

test('renaming a reserved file to an unreserved name is still reserved', () => {
  const result = classifyDiff({
    files: [{ filename: 'docs/notes.txt', previous_filename: '.github/CODEOWNERS', status: 'renamed' }],
    policy,
  });
  assert.equal(result.authority, 'human');
  assert.ok(result.surfaces.includes('merge-authority'));
  assert.match(result.reasons.join('\n'), /\.github\/CODEOWNERS -> docs\/notes\.txt/);
});

test('renaming an unreserved file INTO a reserved path is reserved', () => {
  const result = classifyDiff({
    files: [{ filename: 'supabase/migrations/900_x.sql', previous_filename: 'scratch/x.sql', status: 'renamed' }],
    policy,
  });
  assert.equal(result.authority, 'human');
  assert.ok(result.surfaces.includes('production-ddl-and-data'));
});

test('renaming the gate workflow out of .github/workflows is reserved', () => {
  const result = classifyDiff({
    files: [{
      filename: '.github/disabled/merge-gate.yml',
      previous_filename: '.github/workflows/merge-gate.yml',
      status: 'renamed',
    }],
    policy,
  });
  assert.equal(result.authority, 'human');
  assert.ok(result.surfaces.includes('merge-authority'));
});

test('an ordinary rename between two unreserved paths stays auto', () => {
  const result = classifyDiff({
    files: [{
      filename: 'apps/smart-form/lib/b.ts',
      previous_filename: 'apps/smart-form/lib/a.ts',
      status: 'renamed',
      patch: '+const x = 1;',
    }],
    policy,
  });
  assert.equal(result.authority, 'auto');
});

test('a content rule is evaluated against the previous path too', () => {
  // A .sql file renamed to an extension outside pathGlobs must not escape the
  // destructive-SQL scan by its destination name alone.
  const result = classifyDiff({
    files: [{
      filename: 'scratch/notes.txt',
      previous_filename: 'scratch/cleanup.sql',
      status: 'modified',
      patch: '+DELETE FROM picks;',
    }],
    policy,
  });
  assert.equal(result.authority, 'human');
  assert.ok(result.surfaces.includes('destructive-sql'));
});

// ── the surfaces themselves ───────────────────────────────────────────────
// Risk-scoped, not the old Tier C list renamed. These assert both halves:
// what must stay reserved, and what must NOT be.

test('auth and authorization authority is reserved', () => {
  for (const f of [
    'apps/api/src/auth.ts',
    'apps/api/src/authority-enforcement.ts',
    'apps/api/src/automated-write-boundary.ts',
    'packages/db/src/writer-authority.ts',
    'packages/contracts/src/dual-auth.ts',
    'apps/smart-form/lib/auth-config.ts',
    'apps/smart-form/app/api/auth/[...nextauth]/route.ts',
    'apps/command-center/src/middleware.ts',
  ]) {
    const result = classifyDiff({ files: [file(f, '+const x = 1;')], policy });
    assert.equal(result.authority, 'human', `${f} must be reserved`);
    assert.ok(result.surfaces.includes('auth-and-authorization'), f);
  }
});

test('member-delivery gating is reserved, including the distribution decision', () => {
  for (const f of [
    'apps/api/src/distribution-service.ts',
    'apps/api/src/distribution-worker-service.ts',
    'apps/api/src/routes/kill-switch.ts',
  ]) {
    const result = classifyDiff({ files: [file(f, '+const x = 1;')], policy });
    assert.equal(result.authority, 'human', `${f} must be reserved`);
    assert.ok(result.surfaces.includes('member-delivery-activation'), f);
  }
});

test('worker delivery implementation is reserved while containment holds', () => {
  for (const f of [
    'apps/worker/src/runner.ts',
    'apps/worker/src/delivery-adapters.ts',
    'apps/worker/src/circuit-breaker.ts',
  ]) {
    const result = classifyDiff({ files: [file(f, '+const x = 1;')], policy });
    assert.equal(result.authority, 'human', `${f} must be reserved`);
    assert.ok(result.surfaces.includes('worker-delivery-implementation'), f);
  }
});

test('a worker TEST file is not reserved — it cannot deliver to a member', () => {
  const result = classifyDiff({
    files: [file('apps/worker/src/delivery-adapters.test.ts', '+assert.ok(true);')],
    policy,
  });
  assert.equal(result.authority, 'auto');
});

test('pure logic CI can judge is deliberately NOT reserved', () => {
  // The point of risk-scoping. Under the tier model each of these was Tier C,
  // every PR resolved to T1, and the human relay stopped meaning anything.
  for (const f of [
    'packages/domain/src/scoring.ts',
    'packages/contracts/src/canonical-pick.ts',
    'packages/db/src/lifecycle.ts',
    'packages/db/src/repositories.ts',
    'apps/api/src/board-construction-service.ts',
  ]) {
    const result = classifyDiff({ files: [file(f, '+const x = 1;')], policy });
    assert.equal(result.authority, 'auto', `${f} must NOT be reserved`);
  }
});

test('every surface in the shipped policy declares at least one path', () => {
  for (const s of policy.surfaces) {
    assert.ok(Array.isArray(s.paths) && s.paths.length > 0, `${s.id} declares no paths`);
    assert.ok(typeof s.reserved === 'string' && s.reserved.length > 0, `${s.id} has no rationale`);
  }
});

test('the policy records the two-phase bootstrap it degrades to', () => {
  // The bootstrap path in merge-gate.yml / executor-result-validator.yml is a
  // documented rollout step, not folklore. It must degrade to `human`; a
  // policy that ever said `auto` here would turn the first RMA PR into a
  // self-authorizing one.
  assert.equal(policy.bootstrap.degradesTo, 'human');
  assert.equal(policy.bootstrap.classifierPath, 'scripts/ops/merge-authority.cjs');
});

// ── incomplete evidence ───────────────────────────────────────────────────
// Both of these are the same failure shape: the API answered, but its answer
// does not describe the whole diff. Treating a partial answer as a clean one is
// how a reserved path gets merged without anyone seeing it.

test('a truncated changed-file list reserves rather than classifying the visible subset', () => {
  // GitHub's List-pull-request-files endpoint stops at 3,000 files however far
  // you paginate. Every file that DID come back is unreserved here, so without
  // the count comparison this diff classifies `auto`.
  const files = Array.from({ length: 3000 }, (_, i) => file(`apps/api/src/gen-${i}.ts`, '+const x = 1;'));
  const visible = classifyDiff({ files, policy });
  assert.equal(visible.authority, 'auto', 'the returned subset is genuinely unreserved');

  const truncated = classifyDiff({ files, policy, declaredFileCount: 3200 });
  assert.equal(truncated.authority, 'human');
  assert.ok(truncated.surfaces.includes('unclassifiable'));
  assert.match(truncated.reasons.join(' '), /truncated \(3000 of 3200 files returned\)/);
});

test('a complete file list is not treated as truncated', () => {
  const files = [file('apps/api/src/a.ts', '+const x = 1;'), file('apps/api/src/b.ts', '+const y = 2;')];
  assert.equal(classifyDiff({ files, policy, declaredFileCount: 2 }).authority, 'auto');
  // A count LARGER than declared is not truncation; it must not reserve.
  assert.equal(classifyDiff({ files, policy, declaredFileCount: 1 }).authority, 'auto');
});

test('a patchless rename is unclassifiable unless it is a pure rename', () => {
  // GitHub omits `patch` both for a 100%-similarity rename (nothing to scan)
  // and for a rename whose accompanying edit is too large to return. Only the
  // counts tell them apart. Neither path here is reserved, so the content rule
  // is the only thing standing between an added `DROP TABLE` and `auto`.
  const pureRename = {
    filename: 'apps/api/src/renamed.ts',
    previous_filename: 'apps/api/src/original.ts',
    status: 'renamed',
    additions: 0,
    deletions: 0,
  };
  assert.equal(classifyDiff({ files: [pureRename], policy }).authority, 'auto');

  for (const edited of [
    { ...pureRename, additions: 12, deletions: 0 },
    { ...pureRename, additions: undefined, deletions: undefined },
  ]) {
    const result = classifyDiff({ files: [edited], policy });
    assert.equal(result.authority, 'human', `${JSON.stringify(edited)} must not classify as auto`);
    assert.ok(result.surfaces.includes('unclassifiable'));
  }
});

test('a patchless removal stays skippable — a removed file adds no lines', () => {
  const removed = { filename: 'supabase/migrations/001_old.sql', status: 'removed' };
  // Still reserved, but by the migrations SURFACE, not by unclassifiable.
  const result = classifyDiff({ files: [removed], policy });
  assert.ok(!result.surfaces.includes('unclassifiable'));

  const removedElsewhere = { filename: 'apps/api/src/gone.ts', status: 'removed' };
  assert.equal(classifyDiff({ files: [removedElsewhere], policy }).authority, 'auto');
});

test('evaluateMergeAuthority forwards the declared file count to the classifier', () => {
  const files = [file('apps/api/src/a.ts', '+const x = 1;')];
  const decision = evaluateMergeAuthority({ files, policy, labels: [], declaredFileCount: 40 });
  assert.equal(decision.authority, 'human');
  assert.equal(decision.authorized, false);
  assert.ok(decision.surfaces.includes('unclassifiable'));
});

// ── the machinery that produces required checks ───────────────────────────
// Branch protection binds CONTEXT NAMES, not workflows, and a same-repository
// PR runs its own copy of any workflow it edits. With `checks: write` that copy
// can create a newer, successful check run under a required name. So a workflow
// this policy does not reserve is a way for a PR to satisfy the contexts that
// judge it.

test('every workflow is reserved, not only the ones that legitimately mint required checks', () => {
  for (const wf of [
    '.github/workflows/ci.yml',
    '.github/workflows/merge-gate.yml',
    '.github/workflows/executor-result-validator.yml',
    '.github/workflows/p0-protocol.yml',
    '.github/workflows/some-new-workflow.yml',
    '.github/workflows/nested/thing.yml',
    '.github/actions/setup/action.yml',
  ]) {
    const result = classifyDiff({ files: [file(wf, '+  run: echo hi')], policy });
    assert.equal(result.authority, 'human', `${wf} must be reserved`);
    assert.ok(result.surfaces.includes('merge-authority'), `${wf} must land on merge-authority`);
  }
});

test('the whole sanctioned merge-wrapper chain is reserved', () => {
  // The trusted wrapper would otherwise merge a change that makes the NEXT
  // wrapper authorize unconditionally, or skip the merge mutex.
  for (const f of [
    'scripts/ops/pre-merge-authorization.ts',
    'scripts/ops/merge-wrapper.ts',
    'scripts/ops/ops-merge-wrapper.ts',
    'scripts/ops/merge-mutex.ts',
    'scripts/ops/truth-check-lib.ts',
    'scripts/ops/executor-result-validate.ts',
  ]) {
    const result = classifyDiff({ files: [file(f, '+return true;')], policy });
    assert.equal(result.authority, 'human', `${f} must be reserved`);
    assert.ok(result.surfaces.includes('merge-authority'));
  }
});

test('package.json is reserved by CONTENT, not wholesale', () => {
  // Almost every PR edits package.json to wire a new test into test:ops.
  // Reserving the whole file would make RMA meaningless, so only lines that
  // define or repoint the merge commands reserve it.
  const wiring = classifyDiff({
    files: [file('package.json', '+    "test:ops": "tsx --test scripts/ops/a.test.ts scripts/ops/b.test.ts",')],
    policy,
  });
  assert.equal(wiring.authority, 'auto', 'ordinary package.json wiring must stay auto');

  for (const line of [
    '+    "ops:merge-wrapper": "tsx scripts/ops/evil.ts",',
    '+    "ops:merge-lock": "true",',
    '+    "something": "tsx scripts/ops/pre-merge-authorization.ts --always-yes",',
  ]) {
    const result = classifyDiff({ files: [file('package.json', line)], policy });
    assert.equal(result.authority, 'human', `${line} must reserve`);
    assert.ok(result.surfaces.includes('merge-wrapper-entrypoint'));
  }
});
