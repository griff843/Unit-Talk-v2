# PROOF: UTV2-1634 authoritative active-lane discovery

MERGE_SHA: 5b0c20b3dab2cc67587fd5e187f16d8a31d51aec

## Summary

`readAllManifests()` read `docs/06_status/lanes/*.json` from the local working tree only. An
active lane's manifest lives on its own branch until it merges, so the lane governor saw a
near-empty board and admitted lanes that violated caps, singletons and forbidden combinations.
That is fail-open: absence of a violation was read as proof of no violation.

Discovery now resolves from authoritative remote state (open PRs and their head-ref manifests),
fails closed on every unknown, and runs ahead of every admission path including the docs-only
fast path.

## Verification

Executed on head `b457e03f3c84f8aac1e85be301952d9710f0f1a7`.

## ASSERTIONS:

- [x] Full suite green: 4,444 tests, 4,444 pass, 0 fail, 0 skipped, `PNPM_EXIT=0` captured directly to a file rather than through a pipe.
- [x] Focused in-scope files green: 80 pass, 0 fail across `shared.test.ts`, `lane-start.test.ts`, `concurrency-rules.test.ts`.
- [x] `pnpm lint` exit 0.
- [x] `pnpm type-check` exit 0.
- [x] A lane whose manifest exists only on its PR branch is counted against caps, singletons and forbidden combinations from any worktree.
- [x] The exact reported case is fixtured: a `runtime` lane active only on a PR branch is discoverable, so a `migration` lane-start can be refused.
- [x] Executor cap is enforced when N-1 manifests are unmerged.
- [x] Enumeration failure raises `ActiveLaneDiscoveryError` and refuses admission rather than reporting an empty board.
- [x] Manifest lookup reports absent only on a confirmed 404; auth, rate-limit, network, 5xx, malformed base64 and malformed JSON all fail closed.
- [x] Merged lanes still release their locks even while their PR is open.
- [x] Discovery runs before the docs-only fast path, and both overlap call sites receive the authoritative set.
- [x] Open-PR enumeration is paginated with a truncation detector that fails closed.
- [x] No repository residue after the verification run.

## EVIDENCE:

Full suite, exit code captured directly:

```
PNPM_EXIT=0
notok=0
ELIFECYCLE=0
tests=4444 pass=4444 fail=0 skipped=0
```

Focused in-scope files:

```
$ npx tsx --test scripts/ops/lane-start.test.ts scripts/ops/concurrency-rules.test.ts scripts/ops/shared.test.ts
# tests 80
# pass 80
# fail 0
```

Lint and type-check:

```
LINT_EXIT=0
TC_EXIT=0
```

Residue check after the run:

```
$ git status --short          # (empty)
$ git branch --list '*utv2-99*'   # (empty)
```

## Scope

`scripts/ops/shared.ts`, `scripts/ops/shared.test.ts`, `scripts/ops/lane-start.ts`,
`scripts/ops/lane-start.test.ts` plus this proof bundle. `concurrency-rules.ts` is in the
declared lane scope but was not modified.

## Closeout repair

The implementation merged as PR #1380 at merge SHA `5b0c20b3dab2cc67587fd5e187f16d8a31d51aec`,
but the lane could not truth-close. Three defects, all in closeout artifacts — no implementation
change:

1. The manifest carried `status:"started"`, `pr_url:null`, `commit_sha:null` — no merge binding
   (M4/M5/M6). Now bound to PR #1380 / `5b0c20b3…`, status `merged`, with `files_changed`
   populated from that PR's real diff.
2. Both proof files declared `MERGE_SHA: b457e03f3c84f8aac1e85be301952d9710f0f1a7` — the branch
   head at implementation time, **not reachable from `main`** (P3). Rebound to the real merge SHA
   via `pnpm ops:proof-generate --issue UTV2-1634 --merge-sha 5b0c20b3…`, which preserves the
   authored evidence above in place (`preserved: … (sha-rebound in place)`).
3. This verification log referenced `pnpm type-check` but not `pnpm test`, `pnpm verify`, or
   `scripts/ci/r-level-check.ts` (P12, P13, P14). Re-run below.

### Repair-head verification

Executed on repair head `e6168825` (`claude/utv2-1634-proof-packet-repair`, branched from
`origin/main` @ `5b0c20b3`), in an isolated worktree with `pnpm install --frozen-lockfile`:

```
$ pnpm type-check
TC_EXIT=0

$ pnpm test
tests=4473 pass=4473 fail=0 skipped=0
TEST_EXIT=0

$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 3
Rules matched: (none) — no R-level artifacts required for this diff
RLEVEL_EXIT=0
```

`pnpm verify` was **not** run locally. `verify` = `verify:static && test:live-db`, and
`test:live-db` executes against live Supabase; production is parked, so running it from a
workstation is not permitted. Its `verify:static` components were run individually above; the
authoritative `pnpm verify` result for this lane is the CI `verify` job on this PR.

### `file_scope_lock` now declares the lane's own control-plane paths

`files_changed` is populated from PR #1380's real diff, which — like every lane's diff —
includes `.ops/sync/UTV2-1634.yml` and `docs/06_status/lanes/UTV2-1634.json`. The pre-merge
file-scope guard grants a lane those paths *unconditionally* via `ownLaneControlPlanePatterns`,
so they never appeared in the declared lock. Truth-check's S1 scope-diff evaluation has no such
exemption, so an honestly-populated `files_changed` fails S1 on paths the pre-merge gate had
already blessed.

The three canonical control-plane patterns are therefore now declared explicitly. This is
descriptive, not a widening: the pre-merge guard reads the manifest from `base` (`origin/main`)
and never from the PR head, so a lock edited in this PR cannot loosen that gate. The underlying
defect — two gates with two different definitions of lane scope — is recorded separately, not
fixed here. No truth-check semantics were changed.
