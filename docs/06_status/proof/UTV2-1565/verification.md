# PROOF: UTV2-1565

MERGE_SHA: 09f08701848f21cb7949b912134868bb3a5d88b5

The SHA above is `main`'s HEAD at the time this lane branched (merge
commit of PR #1264), an ancestor of the eventual PR merge commit — per
this repo's accepted proof-binding convention, a commit cannot embed the
hash of the merge commit it will later become part of.

## Verification

Pure lane-manifest metadata reconciliation. No runtime, domain, or DB code
touched.

## ASSERTIONS:

- [x] `docs/06_status/lanes/UTV2-1424.json` repaired: `status: merged`,
  `pr_url` bound to PR #1265, `commit_sha` bound to `7e80bd40d2d1d4f7b7a53874930f6568f2505c8c`
- [x] `docs/06_status/lanes/UTV2-1446.json` repaired: `status: merged`,
  `pr_url` bound to PR #1266, `commit_sha` bound to `0ee3e63c35f488f665325ced397425d743ade64d`
- [x] `docs/06_status/lanes/UTV2-1546.json` repaired: `status: merged`,
  `pr_url` bound to PR #1269, `commit_sha` bound to `f0c3bda609399d3e323b128db0c08ce4f0b86cce`
- [x] `docs/06_status/lanes/UTV2-1551.json` repaired: `status: merged`,
  `pr_url` bound to PR #1264, `commit_sha` bound to `09f08701848f21cb7949b912134868bb3a5d88b5`
- [x] All four repair-packet applications applied verbatim from
  `.out/ops/lane-close-repair/UTV2-<id>.repair-packet.json` (never hand-retyped)
- [x] `npx tsx scripts/ops/lane-manifest.ts validate <id> --json` PASS for
  all four repaired manifests
- [x] `pnpm verify` PASS
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` PASS

## EVIDENCE:

```text
$ npx tsx scripts/ops/lane-manifest.ts validate UTV2-1424 --json
{
  "ok": true,
  "code": "manifest_valid",
  "errors": []
}
```

```text
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none) -- no R-level artifacts required for this diff
```

```text
$ pnpm verify
[verify:parallel] all checks passed
```

## Known effect (intended, not a gap)

Once this lane merges, `UTV2-1424`/`UTV2-1446`/`UTV2-1546`/`UTV2-1551` move
from the `ACTIVE_LOCK_STATUSES` set (`started`, counted as active) to
`merged` (not counted as active), freeing the Claude/governance
concurrency caps these ghost entries were consuming. This is the intended
effect of the lane, not a side effect.

## Tier

T2 — lane-manifest metadata only.
