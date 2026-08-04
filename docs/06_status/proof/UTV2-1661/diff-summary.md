# PROOF: UTV2-1661 diff summary

MERGE_SHA: 2ecdd5b888aba02fac1c9f69dfb2fff74d4f7471

## Verification

## ASSERTIONS:

- [x] Only the two declared implementation files, their tests, and truthful lane/proof metadata changed.
- [x] `.github/workflows/merge-gate.yml` is not touched; Merge Gate remains the single ratified source of per-tier merge authority.

## EVIDENCE:

```
scripts/ops/pre-merge-authorization.ts       + resolveTierFromManifest, MERGE_GATE_CONTEXT,
                                               issueIdFromHeadRef, isMergeGateGreenOnHead,
                                               LaneManifestLookupError,
                                               isConfirmedManifestAbsent,
                                               decodeLaneManifestPayload,
                                               defaultFetchLaneManifestAtHead;
                                               tier-aware authorized decision + tier receipt
scripts/ops/pre-merge-authorization.test.ts  + 29 tests (9 pre-existing unmodified)
docs/06_status/lanes/UTV2-1661.json          executor/created_by corrected to codex-cli
```

```
Full suite: 4,452 pass / 0 fail / PNPM_EXIT=0
Focused:    38 pass / 0 fail
Lint 0, type-check 0
```
