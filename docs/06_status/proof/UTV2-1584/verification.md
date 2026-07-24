# PROOF: UTV2-1584

| Field | Value |
| --- | --- |
| Issue | UTV2-1584 |
| Tier | T1 |
| Branch | codex/utv2-1584-existing-branch-readmission |
| Commit SHA(s) | `5cbe30fcc8535eb2caa8f1c7e94520438ee02789` (implementation source SHA) |

MERGE_SHA: 5cbe30fcc8535eb2caa8f1c7e94520438ee02789

## Verification

PM review returned CHANGES_REQUIRED at head `33e9dba5d0c44289f471e2dbb3caaa471cbfb0f2`: the readmission authority check verified the PR's head/base repository but never verified its base ref was `main`, so a same-repository PR targeting another branch could pass. That gap is fixed at this head; the rest of this document reflects the corrected implementation.

The lane adds the explicit `--readmit-existing-branch` mode to preflight and
lane-start while preserving fresh admission and ordinary resume behavior. The
implementation binds readmission to a clean current `main`, exact branch and
PR identity, continuation-eligible Linear state, absence of worktree/lease/
issue-owned merge mutex, immutable authority inputs, and refreshed remote
SHAs. Reconstruction uses the existing branch, preserves its implementation
commits, creates isolated pnpm state and fresh lane metadata, and rolls back
partial worktree/lease/metadata state on failure.

## ASSERTIONS:

- [x] Explicit opt-in is required; no force or unsafe flag substitutes for readmission.
- [x] Existing branch and current `origin/main` SHAs are fetched and rebound before lane-start side effects.
- [x] Exact issue, branch, open PR, repository, divergence, scope, tier, executor, and lane type are token-bound.
- [x] Branch-only scope paths are normalized structurally before worktree creation and then verified against the fetched existing-branch ref.
- [x] Existing worktree, active/stale-reclaim lease, issue-owned merge mutex, terminal Linear state, unrelated history, and mismatched metadata fail closed.
- [x] Any non-passing readmission preflight result invalidates an older token so stale authorization cannot survive an infrastructure or not-applicable outcome.
- [x] Existing commits and proof files are preserved while a fresh governed worktree, lease, manifest, and sync record are created.
- [x] Requested `lane_type: governance` remains authoritative; prior `hygiene` metadata is history only.
- [x] Post-worktree failures release the lease, remove partial worktree state, and restore root metadata snapshots.
- [x] The open PR's base ref is bound into the token from the live PR object and re-verified independently at lane-start, so a same-repository PR targeting anything other than `main` (e.g. `release`, `staging`) fails closed, and a malformed/tampered token cannot substitute for the live re-check.
- [x] Focused preflight and lane-start suites pass all 56 tests, including branch-only target scope, stale-token invalidation, and PR base-ref binding cases.
- [x] `pnpm type-check`, `pnpm test`, `pnpm test:db`, and full `pnpm verify` pass.
- [x] R-level evaluation passes with no matching R1-R5 runtime/domain/UI rules.
- [x] `git diff --check` passes with no whitespace errors.

## EVIDENCE:

```text
$ npx tsx --test scripts/ops/preflight.test.ts scripts/ops/lane-start.test.ts
1..56
# tests 56
# pass 56
# fail 0
```

```text
$ pnpm test:db
1..7
# tests 7
# pass 7
# fail 0
# skipped 0
# duration_ms 112720.776897
```

```text
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 10
Rules matched: (none) — no R-level artifacts required for this diff
```

```text
$ pnpm verify
PASS — verify:static and test:live-db completed with exit code 0.
The UTV2-1282 window-content assertion skipped because live provider data is
older than 72 hours; the test contract classifies that condition as stale
provider data rather than a code regression.
```

The runtime-health snapshot is recorded separately from the passing test
evidence: `pnpm pipeline:health -- --json` reported `DOWN` because there is no
recent worker heartbeat and historical outbox rows are stranded. The issue
packet identifies that condition as pre-existing; this lane does not change
worker or delivery behavior.
