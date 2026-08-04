# PROOF: UTV2-1634 authoritative active-lane discovery

MERGE_SHA: b457e03f3c84f8aac1e85be301952d9710f0f1a7

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
