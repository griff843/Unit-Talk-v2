# PROOF: UTV2-1634 diff summary

MERGE_SHA: 5b0c20b3dab2cc67587fd5e187f16d8a31d51aec

## Verification

## ASSERTIONS:

- [x] Only in-scope files were modified; `concurrency-rules.ts` was left untouched.
- [x] No production runtime, migration, workflow or delivery path is touched by this change.

## EVIDENCE:

```
scripts/ops/shared.ts            + resolveActiveLaneManifests, ActiveLaneDiscoveryError,
                                   issueIdFromBranchName, isConfirmedManifestNotFound,
                                   OPEN_PR_LISTING_LIMIT; activeManifestOverlap gains an
                                   optional authoritative candidate list
scripts/ops/shared.test.ts       + 22 tests covering discovery, 404 discrimination and
                                   fail-closed behaviour
scripts/ops/lane-start.ts        discovery wired ahead of every admission path; both overlap
                                   sites take the authoritative set; unused import removed
scripts/ops/lane-start.test.ts   + ordering/one-call-site/fast-path assertions; two
                                   pre-existing assertions updated to the new call shapes
```

```
Full suite: 4,444 pass / 0 fail / PNPM_EXIT=0
Focused:    80 pass / 0 fail
Lint 0, type-check 0
```
