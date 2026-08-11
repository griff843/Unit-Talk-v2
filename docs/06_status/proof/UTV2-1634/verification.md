# PROOF: UTV2-1634 bounded retry for transient active-lane discovery failures

MERGE_SHA: 763289224622ecefd1cc08cd8432bb4ecf1ed6de

> Increment 2 of UTV2-1634 (reopened 2026-08-11). Bound to the authoritative
> merge SHA of PR #1403.
> Increment 1 (authoritative active-lane discovery) merged at `5b0c20b3` and its
> proof is superseded by this file, not contradicted.

Issue: UTV2-1634
Tier: T2
Lane type: governance
Branch: claude/utv2-1634-lane-discovery-retry
Generated at: 2026-08-11T17:30:00Z
result: pass

## Summary

Increment 1 made active-lane discovery authoritative by resolving the board from
open PRs and their head-ref manifests, failing closed on every unknown. That is
correct and is preserved unchanged here.

What it did not account for is **cost per unit of board size**. Discovery makes
one call to list open PRs and one more **per open PR** to read that PR's lane
manifest — N+1 sequential network calls for N open PRs — with no retry. A single
transient error on any one of them aborted the entire admission.

The abort probability therefore compounds with the size of the board: at a
per-call transient failure rate `p`, admission succeeds only with probability
`(1-p)^(N+1)`. With 15 open PRs this made `ops:lane-start` effectively unusable.

This increment adds bounded retry around both calls. **No validation is
weakened** — only the definition of "the call failed" changes, from "one attempt
failed" to "every attempt failed".

## Verification

ASSERTIONS:

- [x] A transient failure followed by success returns the value instead of aborting admission
- [x] A permanent failure still fails closed, rethrowing the original error unchanged
- [x] Normal discovery is unchanged — one call, no sleeping on the happy path
- [x] A confirmed 404 remains a definitive answer and is never retried
- [x] Permanent auth failures (401/403) are never retried
- [x] The caller's fail-closed `ActiveLaneDiscoveryError` path is preserved verbatim
- [x] `pnpm type-check`, `pnpm lint`, `pnpm test`, and `r-level-check` all pass

## Runtime Verification

EVIDENCE:

### 1. The defect, measured on the live board

With 15 open PRs, `ops:lane-start` aborted on 5 of 6 consecutive attempts:

```text
attempt 1: flake
attempt 2: flake
attempt 3: flake
attempt 4: flake
attempt 5: flake
STARTED on attempt 6
```

Each abort was a single transient read, naming a different PR each time:

```text
Could not read the lane manifest for UTV2-1652 at ref "codex/utv2-1652-normal-close-worktree-cleanup",
and the failure is not a confirmed 404. Refusing to treat an unreadable manifest as an absent one.
Underlying error: Get "https://api.github.com/repos/griff843/Unit-Talk-v2/contents/...": dial tcp
140.82.114.5:443: i/o timeout
```

Meanwhile a **single** `gh api` call succeeded 8/8:

```text
api.github.com reachability: 8/8 ok, 0/8 failed
```

Board size, not the network, was the dominant term.

### 2. End-to-end reliability, before and after

`resolveActiveLaneManifests` run 6 times against the live board:

```text
before (no retry):                   1/6 succeeded
after (4 attempts, linear 250ms):    3/6 succeeded
after (6 attempts, exp 500ms→4s):    6/6 succeeded, 0/6 failed
  active lanes discovered: 6
```

The intermediate measurement is why the constants are what they are: the
transport stalls outlast a ~1.5s budget, so linear backoff was tuned up to
capped exponential rather than guessed.

### 3. The three required behaviours, proven by test

```text
ok - UTV2-1634 retry: a transient failure followed by success returns the value
ok - UTV2-1634 retry: a permanent transient failure still fails closed with the original error
ok - UTV2-1634 retry: normal discovery is unchanged — one call, no sleeping
ok - UTV2-1634 retry: a non-retryable failure is rethrown immediately without retrying
ok - UTV2-1634 retry: a confirmed 404 is a definitive answer, never retried
ok - UTV2-1634 retry: transport and server faults are retryable, and unknown errors default to retryable
ok - UTV2-1634 retry: backoff doubles and is capped
```

The fail-closed test asserts identity (`thrown === original`), not merely that
something threw — so the caller's error message and wrapping are provably
unchanged after the budget is exhausted.

### 4. Full suite for the changed module

```text
# tests 65
# pass 65
# fail 0
```

58 tests existed before this increment; all still pass, including increment 1's
fail-closed coverage (`only a confirmed 404 counts as manifest-absent`).

### 5. Gate commands

```text
pnpm type-check   exit=0
pnpm lint         exit=0
pnpm test         exit=0
```

### 6. `r-level-check`

```text
Verdict: PASS
Changed files: 1
Rules matched: (none) — no R-level artifacts required for this diff
```

### 7. `pnpm verify` — live-DB stage refused locally by design

`pnpm verify` includes `test:live-db`, gated by `ci:assert-staging`, which refuses
any target that is not the staging project:

```text
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx.
```

That is the containment guard behaving correctly. This lane touches no database
code, no migration, and no runtime path — its diff is one file plus its unit test.

## Scope

- `scripts/ops/shared.ts` — retry wrapper, failure classifier, tuned constants; both discovery calls wrapped
- `scripts/ops/shared.test.ts` — 7 new tests

No production code, no schema, no workflow, no migration.
