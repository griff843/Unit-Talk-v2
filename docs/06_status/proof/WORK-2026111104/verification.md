# PROOF: WORK-2026111104

MERGE_SHA: e72318d5fd3bad21934167c3a4584014ea58ba82

> Pre-merge the merge row is intentionally the placeholder; the code commit below carries
> the verified implementation identity. `post-merge-lane-close.yml` binds the merge SHA.

Issue: WORK-2026111104
Tier: T2
Lane type: governance
Branch: claude/work-2026111104-work-lane-discovery
Code commit: f655fc5c553b558419e00b9cd50227b98ad15458 (base `main` 328b71064)
result: pass — red on `main` without the fix, green with it; lint, type-check and `test:ops` exit 0.

## ASSERTIONS:

- [x] A test that fails on `main` shows an open WORK lane PR whose manifest exists only at its head is invisible to `resolveActiveLaneManifests` and `activeManifestOverlap` (`WORK-2026111104: a WORK lane whose manifest exists ONLY on its PR head ...`).
- [x] `issueIdFromBranchName` derives its namespaces from `ISSUE_ID_NAMESPACES`.
- [x] With the fix, the WORK lane is discovered from its PR head (`source: open_pr_head`, PR 1842) and its lock overlaps a conflicting scope.
- [x] Fail-closed: a manifest read that throws for a WORK branch raises `ActiveLaneDiscoveryError` naming the issue and PR (`WORK-2026111104 fail-closed: ...`).
- [x] Non-lane branches (`main`, `dependabot/...`, `claude/readiness-contract-measurement`, `codex/website-primary-logo-owner-source`, `claude/workflow-cleanup`, `claude/work-abc-slug`) still resolve to `null`.
- [x] `pnpm lint`, `pnpm type-check` and `pnpm test:ops` exit 0.
- [x] `pnpm verify:static` exit 0 and `scripts/ci/r-level-check.ts` PASS (no rules matched); `pnpm verify` blocked only at the staging-identity guard.

## EVIDENCE:

```text
# New tests with the shared.ts fix removed (current main code)
$ tsx --test --test-name-pattern "WORK-2026111104" scripts/ops/shared.test.ts
not ok 1 - WORK-2026111104 issueIdFromBranchName recognizes repo-minted WORK-### lane branches
not ok 2 - WORK-2026111104: a WORK lane whose manifest exists ONLY on its PR head is discovered, so its file lock refuses an overlapping lane-start
not ok 3 - WORK-2026111104 fail-closed: an unreadable WORK lane manifest throws rather than being skipped
# pass 0
# fail 3

# With the fix
$ tsx --test scripts/ops/shared.test.ts
# tests 145
# pass 145
# fail 0
```

Live read-only check (2026-11-12, patched discovery against GitHub, clean `main` checkout): `WORK-2026091001 visible: false`; `activeManifestOverlap('WORK-2026111104', [shared.ts, shared.test.ts, work order])` returned `null`. Preflight PL6 independently passed before lane start.

## Verification

Run on code commit `f655fc5c5`:

```text
$ pnpm lint          # exit 0
$ pnpm type-check    # exit 0
$ pnpm test:ops      # exit 0
# tests 3798
# pass 3788
# fail 0
# skipped 10
```

Canonical gate and R-level check, run at `1b49c74c3` (code identical to `f655fc5c5`):

```text
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 7
Rules matched: (none) — no R-level artifacts required for this diff

$ pnpm verify:static   # exit 0 (lint, type-check, build, full pnpm test)

$ pnpm verify          # exit 1 after verify:static passed
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx.
```

`pnpm verify` is not claimed green locally: its static stage passed and its writable-DB stage is deferred to CI's staging job (`Writable DB proof (staging only)`).

Also run before rebase on the same patch: `lane-link-pr` 26/26, `lane-start` 78/78, `lane-maximizer` 94/94, `execution-state` 13/13.

Not run locally: `pnpm test:db` / writable-DB proof (no runtime or DB path touched; CI's staging job covers it).

## Merge SHA Binding

Merge SHA: `e72318d5fd3bad21934167c3a4584014ea58ba82`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1845
