# PROOF: WORK-2026100701

MERGE_SHA: d7f035857c16694411d9f0a84ea4decedc1f8a45

Issue: WORK-2026100701
Tier: T1
Lane type: governance
Implementation SHA: aeede37ad7a7f8b4e0aa03d330a0f80b58570a9e
result: static_pass_live_db_deferred_to_staging_ci

## ASSERTIONS:

- [x] Protected-main CI no longer filters metadata-only pushes and uses the push SHA,
  rather than the shared main ref, as its cancellation identity.
- [x] Historical recovery is triggered only by `repository_dispatch`, whose workflow
  definition comes from the protected default branch; branch-selectable
  `workflow_dispatch` is absent.
- [x] Recovery refuses an altered/stale workflow definition, an open or unmerged PR,
  a wrong repository/base/head, a non-metadata path or rename source, an incomplete
  paginated file list, an invalid merge SHA, and a merge not reachable from the current
  protected default branch.
- [x] Both proof jobs check out and attest the exact validated merge SHA while preserving
  the separate workflow execution SHA and never rewriting `GITHUB_SHA`.
- [x] Only the protected staging job receives `staging-ci`; it pins project
  `xskgrzbteyqdufktjrjx`. No production project or production credential is referenced.
- [x] Historical G6 check publication is derived from completed native jobs queried from
  the current workflow run after revalidating its event/path/ref/head/attempt and the
  merged PR target. Missing, failed, skipped, cancelled, incomplete, stale-attempt,
  wrong-run, wrong-execution-SHA, or wrong-tested-SHA proof publishes failure, never a
  skipped/neutral/success-equivalent conclusion.
- [x] G6 implementation and policy are unchanged.

## EVIDENCE:

Measured #1720 target before repair:

```text
PR: https://github.com/griff843/Unit-Talk-v2/pull/1720
state: MERGED
base: main
merge SHA: 0ad7e1eb6cb7cba1131743a46292a8e901f99e64
check runs on merge SHA: 6
verify: absent
Writable DB proof (staging only): absent
```

Focused regression receipt:

```text
pnpm exec tsx --test 'scripts/ops/workflow-hardening.test.ts'
tests 88
pass 88
fail 0
skipped 0
```

## Verification

- `node --check scripts/ops/merge-proof-recovery.cjs` — PASS.
- YAML parse of `.github/workflows/ci.yml` and
  `.github/workflows/merge-proof-recovery.yml` — PASS.
- `pnpm exec tsx --test 'scripts/ops/workflow-hardening.test.ts'` — PASS: 88 tests,
  0 failures, 0 skipped.
- `pnpm verify:static` — PASS, including `pnpm type-check`, build, `pnpm test`, T1 local
  proof suites, Smart Form verification, and command/migration checks.
- `pnpm verify` — static portion PASS; writable live-DB portion correctly REFUSED and
  deferred before access by the staging-target guard.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS at
  implementation SHA: 13 changed files, no matching R-level rules.
- `pnpm test:db` — correctly REFUSED before DB access: local target resolved as
  `host=127.0.0.1 ref=unidentified`, not approved staging project
  `xskgrzbteyqdufktjrjx`. Writable proof is blocked/deferred to protected exact-HEAD
  `staging-ci` with `CI_SUPABASE_*` credentials.
- `git diff --check` — PASS.

## Runtime Verification

The recovery workflow itself must supply the writable receipt. The local machine is not
an approved writable target and made no DB write. Fresh exact-HEAD protected staging CI
for this reworked source is pending on the draft PR; the earlier candidate's genuine run
is retained as history but is not proof for this SHA. After governed merge, the sanctioned
recovery must run against PR #1720 and its actual merge SHA before #1720 closeout is
replayed.

## Model Routing

This is the sanctioned `ops:codex-exec` child and did not recursively invoke the wrapper.
The outer wrapper owns and persists `model-routing.json` after the child exits, preserving
actual process exit and elapsed-time provenance.

## Merge SHA Binding

Merge SHA: `d7f035857c16694411d9f0a84ea4decedc1f8a45`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1724
