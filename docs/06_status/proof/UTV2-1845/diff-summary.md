# DIFF SUMMARY: UTV2-1845

MERGE_SHA: 9a233bd90063d818d19cc026ec22f216671b6dea

## Files changed

| File | Change |
|---|---|
| `scripts/ops/shared.ts` | `CheckResult['status']` gains `blocked_by_containment`, with a comment stating that it resolves to the same verdict as `infra_error` and exists only to stop reporting a policy state as a broken dependency |
| `scripts/ops/preflight.ts` | new exported `isContainmentPlaceholderSupabaseUrl()`; `runT1Checks` selects the new outcome for the placeholder and is exported so its branch selection is testable; `resolveVerdict` maps the new outcome to `INFRA` |
| `scripts/ops/preflight.test.ts` | seven tests, four of them inversions |
| `docs/governance/PT1_CONTAINMENT_ADMISSION_DECISION.md` | new — the reserved admission decision, prepared and not applied |

## What is not in this diff

No `.github/workflows/**` file. No CODEOWNERS. No branch-protection change. No `package.json`. No
migration, schema or application source. No preflight-token field, no lane-manifest field and no
closeout check — those belong to Part 2 of the decision packet and are deliberately absent.
