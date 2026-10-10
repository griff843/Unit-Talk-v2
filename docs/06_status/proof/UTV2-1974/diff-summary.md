# Diff summary: UTV2-1974

The delivery-ui policy already allows apps/web, but the app-root registry omitted it. Lane start therefore rejected a permitted website-only scope.

| File | Change |
|---|---|
| scripts/ops/shared.ts | Add web: apps/web/ to the existing registry. No concurrency or Tier C policy changes. |
| scripts/ops/shared.test.ts | Admit the web glob and explicit paths; continue refusing mixed-app and unknown-app scopes. |

The focused test failed before the registry change and passed afterward. The full shared suite passed 136 tests. This is the separately approved admission correction; the website implementation belongs to UTV2-1801.

## SHA Binding
Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1731
