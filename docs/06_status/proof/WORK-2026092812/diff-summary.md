# Diff summary: WORK-2026092812

Display-only Command Center work. No API route, database reader, write path, or production data changed.

| File | Change |
|---|---|
| `apps/command-center/src/components/GovernedPickTruth.tsx` | Renders persisted governed-pick mode, delivery authorization, participant provenance, edge fallback/scope reason, eventless grading note, and voided banner. |
| `apps/command-center/src/app/picks/[id]/page.tsx` | Supplies the already-loaded pick metadata and event-link/lifecycle state to the governed-truth panel. |
| `apps/command-center/src/components/PicksExplorerClient.tsx` | Replaces governed-row routing text with capper, stake units, and a Track Only badge when persisted mode is `track-only`; ungoverned routing stays unchanged. |
| `apps/command-center/src/app/command-center-pages.test.tsx` | Extends the existing test file with refused, authorized, malformed, governed-list, and ungoverned-list cases. |

## SHA Binding

Merge SHA: pending merge
PR: pending
