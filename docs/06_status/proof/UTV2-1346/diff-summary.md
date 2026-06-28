# UTV2-1346 Diff Summary

## Change
**File:** `apps/api/src/submission-service.ts`
**Lines changed:** +2 (one in processSubmission, one in processShadowSubmission)

## Diff

```diff
--- a/apps/api/src/submission-service.ts
+++ b/apps/api/src/submission-service.ts
@@ -329,6 +329,7 @@ export async function processSubmission(
       ...realEdgeData,
       ...(payload.thesis ? { thesis: payload.thesis } : {}),
       ...(thumbnailUrl ? { thumbnailUrl } : {}),
+      ...(payload.submittedBy ? { capper: payload.submittedBy } : {}),
     },
   };

@@ -537,6 +538,7 @@ export async function processShadowSubmission(
       kellySizing,
       ...(payload.thesis ? { thesis: payload.thesis } : {}),
       ...(shadowThumbnailUrl ? { thumbnailUrl: shadowThumbnailUrl } : {}),
+      ...(payload.submittedBy ? { capper: payload.submittedBy } : {}),
     },
   };
```

## Why These Lines
`clv-feedback.ts:computeClvTrustAdjustment` reads `pick.metadata.capper` to identify the submitter for trust adjustment. Without `capper` in metadata, all smart-form picks were unattributed regardless of what `submittedBy` was set to. The fix copies `submittedBy` → `capper` at enrichment time in both the primary and shadow submission paths.

## No-op for missing submittedBy
The conditional spread `...(payload.submittedBy ? { capper: payload.submittedBy } : {})` is a no-op when `submittedBy` is absent — safe for all non-smart-form sources (feed, system, model-driven) that don't provide `submittedBy`.

## Merge SHA
**Merge SHA:** pending (auto-bound post-merge)
**PR:** pending
**Merged:** pending
