# PROOF: UTV2-1566

MERGE_SHA: 0394d860b5ba4415258e46d2546663b4f53e154d

The SHA above is `main`'s HEAD at the time this lane branched, an ancestor
of the eventual PR merge commit — per this repo's accepted proof-binding
convention, a commit cannot embed the hash of the merge commit it will
later become part of.

## Verification

Pure lane-manifest/proof metadata reconciliation. No runtime, domain, or
DB code touched.

## ASSERTIONS:

- [x] `UTV2-1424`, `UTV2-1446`, `UTV2-1546` reach `status: done` with real
  `closed_at`, passing `truth_check_history` entry, released lease/lock,
  no worktree
- [x] `UTV2-1563`, `UTV2-1564` (discovered via `ops:substrate-guard`
  during this lane's preflight — merged PRs #1276/#1277, manifests stuck
  `started`) reconciled and reach `status: done`
- [x] `UTV2-1550` (discovered via a full `.ops/leases/*.json` sweep —
  merged PR #1239, manifest stuck `merged`/`closed_at: null`) has its
  proof correctly rebound to its own merge SHA; `ops:truth-check` still
  fails `G4` for reasons unrelated to proof binding (see diff-summary.md)
  — left `status: merged`, not force-closed
- [x] `UTV2-1551` has its proof correctly rebound to its own merge SHA;
  `ops:truth-check` still fails `R1`/`R2`/`L3`/`S1` for reasons unrelated
  to proof binding (genuine missing T1 runtime proof) — left
  `status: merged`, not force-closed
- [x] 9 stale dispatch leases released (`UTV2-1398`, `UTV2-1501`,
  `UTV2-1503`, `UTV2-1506`, `UTV2-1550`, `UTV2-1551`, `UTV2-1554`,
  `UTV2-1563`, `UTV2-1564`)
- [x] `pnpm verify` PASS
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` PASS

## EVIDENCE:

```text
$ pnpm ops:lane-close UTV2-1424 --repair-merged
{ "ok": true, "code": "lane_closed", "outcome": "closed_with_warnings",
  "status": "done", "closed_at": "2026-07-20T23:19:42.175Z" }

$ pnpm ops:lane-close UTV2-1446 --repair-merged
{ "ok": true, "code": "lane_closed", "outcome": "closed_with_warnings",
  "status": "done", "closed_at": "2026-07-20T23:19:48.121Z" }

$ pnpm ops:lane-close UTV2-1546 --repair-merged
{ "ok": true, "code": "lane_closed", "outcome": "closed_with_warnings",
  "status": "done", "closed_at": "2026-07-20T23:19:54.114Z" }

$ pnpm ops:lane-close UTV2-1563 --repair-merged
{ "ok": true, "code": "lane_closed", "outcome": "closed_with_warnings",
  "status": "done", "closed_at": "2026-07-20T23:20:06.297Z" }

$ pnpm ops:lane-close UTV2-1564 --repair-merged
{ "ok": true, "code": "lane_closed", "outcome": "closed_with_warnings",
  "status": "done", "closed_at": "2026-07-20T23:20:12.430Z" }
```

```text
$ pnpm ops:truth-check UTV2-1551 --explain (excerpt)
[FAIL] R1 - runtime_proof.queries must be non-empty: run pnpm test:db and include live query evidence
[FAIL] R2 - runtime_proof.row_counts must be non-empty: include monitored-table row counts from pnpm test:db
[FAIL] L3 - Linear state Ready to Close is not In PM Review or Done
[FAIL] S1 - files_changed outside file_scope_lock: .ops/sync/UTV2-1551.yml, docs/06_status/lanes/UTV2-1551.json
VERDICT: fail (43 checks, 4 failures)
```

```text
$ pnpm ops:truth-check UTV2-1550 --explain (excerpt)
[FAIL] G4 required checks missing or failing: Executor Result Validation, Merge Gate, P0 Protocol
VERDICT: fail (43 checks, 1 failures)

$ gh api repos/griff843/Unit-Talk-v2/commits/1d555828.../check-runs \
  --jq '.check_runs[] | select(.name=="Merge Gate") | {conclusion, status}'
{"conclusion":"failure","status":"completed"}   # x3, all post-merge re-runs
{"conclusion":"skipped","status":"completed"}   # x5
# no "success" conclusion recorded against the merge SHA itself
```

```text
$ pnpm ops:lease release --issue UTV2-1563 --actor operator --reason "..."
{ "ok": true, "code": "lease_released" }
(repeated for UTV2-1398, UTV2-1501, UTV2-1503, UTV2-1506, UTV2-1550,
 UTV2-1551, UTV2-1554, UTV2-1564 — all "ok": true, "code": "lease_released")
```

```text
$ pnpm verify
(exit code 0; full node:test TAP output included lint/type-check/build/test,
 e.g. tail excerpt:)
# tests 6
# pass 6
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

```text
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff
```

## Tier

T2 — lane-manifest/proof metadata only, no runtime/domain/DB code touched.

## Known remaining ghost/blocked lanes (not fixed by this PR)

- `UTV2-1551`, `UTV2-1550` — genuine gaps (T1 runtime proof; check-runs
  evaluation), tracked for separate follow-up
- `UTV2-1554`, `UTV2-1560` — pre-existing, substantively broken
  (failing Merge Gate / File scope lock; UTV2-1560's continuation PR is
  additionally `CONFLICTING`/`DIRTY` with failing Live Schema Parity and
  Runtime Verifier Gate), each with an already-abandoned prior close
  attempt — needs real investigation, out of scope here
