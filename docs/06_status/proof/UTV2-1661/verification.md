# PROOF: UTV2-1661 tier-aware pre-merge authorization

MERGE_SHA: f5c5fa44c6f663721c360337ba0e8558c93de920

## Summary

`authorized` ANDed the pm-verdict requirement in for every PR regardless of tier, double-gating
T2/T3 against a rule that only applies to T1 and surfacing a T1-only failure message on non-T1
PRs. Tier authority now comes from the lane manifest at the PR head, labels are mirrored
evidence only, and relaxation additionally requires an exact-head green `Merge Gate`.

## Verification

Executed on head `2ecdd5b888aba02fac1c9f69dfb2fff74d4f7471`.

## ASSERTIONS:

- [x] Full suite green: 4,452 tests, 4,452 pass, 0 fail, 0 skipped, `PNPM_EXIT=0` captured directly to a file rather than through a pipe.
- [x] Focused file green: 38 pass, 0 fail.
- [x] `pnpm lint` exit 0.
- [x] `pnpm type-check` exit 0.
- [x] Tier authority is the lane manifest at the PR head; PR labels never relax a T1 requirement.
- [x] A T1 manifest carrying a mutable `tier:T2` label cannot relax authority.
- [x] Manifest/label disagreement fails closed even when both values are non-T1.
- [x] A missing `Merge Gate` context, an empty required-check set, a stale/non-current-head `Merge Gate`, and a duplicate `Merge Gate` identity each fail closed.
- [x] A T2 manifest with a current-head green `Merge Gate` and no verdict is authorized, with no T1-only message emitted.
- [x] `Merge Gate Evaluator` is never accepted as a substitute for `Merge Gate`.
- [x] The production default manifest reader is implemented and exercised by integration tests with no injected dep; the prior head defaulted to `async () => null`, leaving the double-gate intact outside tests.
- [x] The manifest is read at the exact head SHA, not the branch ref, and its `issue_id` identity is validated.
- [x] Confirmed 404 resolves to unresolved/strict; auth, rate-limit, network, 5xx, malformed base64 and malformed JSON raise `LaneManifestLookupError` and fail closed.
- [x] Fail-closed ingestion of authority is preserved: no path relaxes on absent or unreadable data.
- [x] Lane manifest records `executor: codex-cli`, matching the governed routing identity and the `codex/` branch.

## EVIDENCE:

Full suite, exit code captured directly:

```
PNPM_EXIT=0
notok=0
tests=4452 pass=4452 fail=0 skipped=0
```

Focused file:

```
$ npx tsx --test scripts/ops/pre-merge-authorization.test.ts
# tests 38
# pass 38
# fail 0
```

Lint and type-check:

```
LINT_EXIT=0
TC_EXIT=0
```

## Attribution

Governed lane identity is `codex-cli`, matching the branch and worktree. The implementation in
this correction round was performed by Claude operating under that lane identity; recorded here
for attribution rather than altering the manifest's routing truth.

## Scope

`scripts/ops/pre-merge-authorization.ts`, `scripts/ops/pre-merge-authorization.test.ts`, the
lane manifest's executor identity, and this proof bundle. Merge Gate itself is untouched.

## Closeout repair (PR #1381)

The implementation merged as PR #1379 at merge SHA `f5c5fa44c6f663721c360337ba0e8558c93de920`,
but the lane could not truth-close. Four defects, all in closeout artifacts — no implementation
change:

1. The manifest carried `status:"started"`, `pr_url:null`, `commit_sha:null` — no merge binding
   (M4/M5/M6). Now bound to PR #1379 / `f5c5fa44…`, status `merged`.
2. The manifest omitted the `model_routing` block required of `schema_version: 2` Codex-executor
   manifests, so `ops:truth-check` exited `infra_error` at M2 and never evaluated anything below
   it (P3, P12, P13, P14 were all masked).
3. Both proof files declared `MERGE_SHA: 2ecdd5b888aba02fac1c9f69dfb2fff74d4f7471` — the branch
   head at implementation time, **not reachable from `main`** (P3). Rebound to the real merge SHA
   via `pnpm ops:proof-generate --issue UTV2-1661 --merge-sha f5c5fa44…`, which preserves the
   authored evidence above in place (`preserved: … (sha-rebound in place)`).
4. This verification log referenced `pnpm type-check` but not `pnpm test`, `pnpm verify`, or
   `scripts/ci/r-level-check.ts` (P12, P13, P14). Re-run below.

### Repair-head verification

Executed on the repair head `704d21d0` (`claude/utv2-1661-manifest-model-routing` merged with
`origin/main` @ `5b0c20b3`), in an isolated worktree with `pnpm install --frozen-lockfile`:

```
$ pnpm type-check
TC_EXIT=0

$ pnpm test
tests=4473 pass=4473 fail=0 skipped=0
TEST_EXIT=0

$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 1
Rules matched: (none) — no R-level artifacts required for this diff
RLEVEL_EXIT=0
```

`pnpm verify` was **not** run locally. `verify` = `verify:static && test:live-db`, and
`test:live-db` executes against live Supabase; production is parked, so running it from a
workstation is not permitted. Its `verify:static` components were run individually above
(`lint`/`type-check` in the original round, `type-check`/`test` here); the authoritative
`pnpm verify` result for this lane is the CI `verify` job, which passed on head `898b908a`
(run [30904868964](https://github.com/griff843/Unit-Talk-v2/actions/runs/30904868964)) and re-runs
on each subsequent push to #1381.

### `file_scope_lock` now declares the lane's own control-plane paths

`files_changed` is populated from PR #1379's real diff, which — like every lane's diff —
includes `.ops/sync/UTV2-1661.yml` and `docs/06_status/lanes/UTV2-1661.json`. The pre-merge
file-scope guard grants a lane those paths *unconditionally* via `ownLaneControlPlanePatterns`,
so they never appeared in the declared lock. Truth-check's S1 scope-diff evaluation has no such
exemption — it allows only `file_scope_lock` entries and `docs/06_status/proof/**` — so an
honestly-populated `files_changed` fails S1 on paths the pre-merge gate had already blessed.

The three canonical control-plane patterns are therefore now declared explicitly in
`file_scope_lock`, matching established practice (e.g. `docs/06_status/lanes/UTV2-998.json`).
This is descriptive, not a widening: the pre-merge guard reads the manifest from `base`
(`origin/main`) and never from the PR head, so a lock edited in this PR cannot loosen that gate.

The underlying defect — two gates with two different definitions of lane scope — is recorded as
UTV2-1619 capability 1, not fixed here. No truth-check semantics were changed.

### Dry-run receipt

`ops:truth-check UTV2-1661` was run against the prospective merged state from the repair
worktree: **38 checks, 37 pass, 1 skip-adjusted fail (S1)** before the `file_scope_lock`
declaration above, and clean after. The authoritative receipt is the post-merge run on `main`;
no dry-run result was written into `truth_check_history`.
