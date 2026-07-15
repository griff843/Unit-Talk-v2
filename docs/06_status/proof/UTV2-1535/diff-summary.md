# UTV2-1535 — Diff Summary

## Problem

The concurrency ramp issue raised the total active-lane cap to 10 and added mechanical
per-type caps (Hygiene≤4, Governance≤3, Delivery/UI≤1-per-app, Verification≤1-per-target)
enforced in `checkConcurrencyLimits()` in `scripts/ops/lane-start.ts` — the real,
fail-closed authority. `scripts/ops/lane-maximizer.ts`'s `evaluateCandidates()` is an
advisory planner that decides which candidates go into a `fill_now` wave and generates
`dispatch_command` text. It checked executor caps, singleton types, forbidden
combinations, and (from a prior fix) the verification-target per-target cap, but did not
forecast the hygiene/governance maxima, the delivery-ui per-app cap, the total lane cap,
or the trial governor, and it never projected wave state across already-accepted
candidates for most of these checks. This meant the planner could recommend a wave that
`ops:lane-start` would then reject partway through, wasting a dispatch cycle. This is a
planning-accuracy gap, not a safety gap — `ops:lane-start` was never bypassed.

## Architecture decision: reuse, not a third copy

Investigated whether `checkConcurrencyLimits()` could be reused directly. Two issues
stood in the way:

1. **Type mismatch, not a circular import.** `lane-maximizer.ts` does not import from
   `lane-start.ts` (only `lane-start.test.ts` and `concurrency-simulation.test.ts` did),
   so importing `checkConcurrencyLimits` from `lane-start.ts` into `lane-maximizer.ts`
   would not have created a cycle. The real obstacle was that `checkConcurrencyLimits()`'s
   `activeManifests` parameter was typed against `shared.ts`'s full `LaneManifest`
   interface (14+ required fields: `worktree_path`, `preflight_token`,
   `truth_check_history`, etc.), while `lane-maximizer.ts` deliberately carries its own
   lightweight, test-friendly `LaneManifest` shape and needs to synthesize per-candidate
   "this lane is now active" projections on the fly — forcing every synthetic projection
   and every existing test fixture to carry the full schema would have been invasive and
   fragile.
2. Extracting the function unchanged, but narrowing its manifest parameter type, solves
   this without weakening anything `ops:lane-start` depends on.

**Decision:** extracted `checkConcurrencyLimits()` (byte-identical logic, only the
parameter type narrowed) into a new module, `scripts/ops/concurrency-rules.ts`, typed
against a minimal structural interface `ConcurrencyManifestLike` — exactly the fields the
function reads (`issue_id`, `lane_type`, `executor?`, `status`, `file_scope_lock`,
`verification_target?`). Real `shared.LaneManifest` objects remain a structural superset
and pass through unchanged; `lane-maximizer.ts`'s own lightweight `LaneManifest` and its
synthetic wave-projection entries also satisfy it without any cast.

`lane-start.ts` now imports `checkConcurrencyLimits` from `concurrency-rules.ts` and
re-exports it (plus `ConcurrencyViolation`/`IncomingLaneScope`) so every existing caller
(`concurrency-simulation.test.ts` imports these three symbols from `./lane-start.js`)
keeps working with zero changes. `lane-maximizer.ts` imports the same function directly.
There is now exactly one implementation of the type-cap/singleton/forbidden-combination
rule set in the repository.

## What changed in `evaluateCandidates()`

- A `projectedActive: ConcurrencyManifestLike[]` list starts as the real active board and
  gains one synthetic entry every time a candidate is accepted into `fill_now`.
- Per candidate, `checkConcurrencyLimits()` is called twice: once against the real active
  board only (`baselineViolations`, used only for classification), and once against the
  growing `projectedActive` list (the actual admission decision). Because
  `projectedActive` only grows, `baselineViolations` is always a subset — any violation
  code present in the projected call but absent from the baseline call arose purely from
  this wave, and is classified as an "already planned" conflict (distinct reason codes
  `DELIVERY_UI_APP_ALREADY_PLANNED` / `VERIFICATION_TARGET_ALREADY_PLANNED`) rather than
  an "active lane" conflict (`DELIVERY_UI_APP_ACTIVE` / `VERIFICATION_TARGET_ACTIVE`).
- This single call now covers total cap, executor caps, the trial governor, singleton
  types, forbidden combinations, hygiene/governance maxima, and the delivery-ui/
  verification per-target caps — replacing five separate hand-rolled checks that
  previously lived only in `lane-maximizer.ts`.
- File-scope overlap is now checked against `projectedActive` (active lanes AND every
  candidate already planned earlier in the same wave), not just the real active board.
- A new `EvaluateCandidateOptions.concurrencyConfig` override lets a caller (tests, or a
  future trial-governor-aware caller) supply the full policy verbatim; a new
  `EvaluateCandidateOptions.typeCaps` override lets a caller override just the type-cap
  numbers. Both default to the real effective `CONCURRENCY_CONFIG.json`.
- `evaluateCandidates()`'s pre-existing `limits`-driven executor-cap behavior (used by
  every existing caller/test) is unchanged: `executors`/`total` in the synthesized policy
  are driven by the `limits` parameter, not the loaded config, unless
  `concurrencyConfig` is explicitly supplied.

## Files changed

- `scripts/ops/concurrency-rules.ts` (new) — the single canonical `checkConcurrencyLimits()` implementation.
- `scripts/ops/lane-start.ts` — removed the local implementation; imports + re-exports from `concurrency-rules.ts`; dropped now-unused imports (`ACTIVE_LOCK_STATUSES`, `deriveDeliveryUiApp`, `DELIVERY_UI_APP_ROOTS`, `ConcurrencyConfig`, `EffectiveConcurrencyConfig`, `LaneManifest` type).
- `scripts/ops/lane-maximizer.ts` — wave-projected concurrency forecast per the above; removed the now-redundant hand-rolled `hasForbiddenCombination()` and the ad hoc verification-target-only wave tracking.
- `scripts/ops/lane-maximizer.test.ts` — 20 new deterministic tests (see `verification.md`) plus all 36 pre-existing tests retained and passing unchanged.
- `docs/06_status/lanes/UTV2-1535.json`, `.ops/sync/UTV2-1535.yml`, `docs/06_status/proof/UTV2-1535/.gitkeep` — lane control-plane scaffolding.

## No behavior change to `ops:lane-start`

`checkConcurrencyLimits()`'s logic is byte-identical to before the move (only the
parameter type changed, from `LaneManifest[]` to the narrower `ConcurrencyManifestLike[]`,
which every real caller already satisfies structurally). `ops:lane-start` remains the
sole fail-closed mechanical authority; this diff only makes the advisory planner agree
with it more often.
