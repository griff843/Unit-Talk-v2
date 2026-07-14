# Diff Summary — UTV2-1533

**Issue:** UTV2-1533 — Post-lock concurrency ramp: raise ceiling to 10 active lanes (4 Claude + 6 Codex)
**Tier:** T1 (governance-critical)
**Lane type:** governance
**Status:** PM review round 3 (CHANGES REQUIRED round 1 addressed in round 2; a fresh Codex review on round 2's head surfaced 2 more findings, addressed in round 3 below). PR #1213 **not merged**.

## Files changed (cumulative, vs origin/main)

```
docs/05_operations/LANE_MANIFEST_SPEC.md                          |  14 ++
docs/05_operations/schemas/lane_manifest_v1.schema.json            |  26 ++
docs/06_status/proof/UTV2-1533/.gitkeep                            |   0
docs/06_status/proof/UTV2-1533/diff-summary.md                     |  (this file)
docs/06_status/proof/UTV2-1533/evidence.json                       |  (new, T1 evidence bundle)
docs/06_status/proof/UTV2-1533/verification.md                     |  (this round)
docs/governance/CONCURRENCY_CONFIG.json                            |  26 +-
docs/governance/LANE_CONCURRENCY_POLICY.md                         |  74 ++++--
scripts/ops/concurrency-config.ts                                  |  34 ++-
scripts/ops/concurrency-simulation.test.ts                         | 269 ++++++++++++++++++++-
scripts/ops/lane-maximizer.test.ts                                 |   4 +-
scripts/ops/lane-maximizer.ts                                      |   9 +
scripts/ops/lane-start.ts                                          | 100 ++++++++
scripts/ops/shared.test.ts                                         | 125 ++++++++++
scripts/ops/shared.ts                                               |  92 +++++++
```

## Round 1 (original submission)

1. **`docs/governance/CONCURRENCY_CONFIG.json`**: `total` 6→10, `executors.claude` 2→4, `executors.codex` 4→6, `version` 2→3. Retired the expired 8-lane trial, staged a **disabled** 14-lane trial (`claude:5, codex:9, allowed_until:null`) for a future ramp step.
2. **`docs/governance/LANE_CONCURRENCY_POLICY.md`**: §1/§6/§10/§11 updated to the new numbers, plus a provenance note (soft policy, not mechanical).
3. **`scripts/ops/concurrency-simulation.test.ts`**: fixed the one assertion hardcoding `total===6`/`claude===2`/`codex===4`.

## Round 2 (this round — PM review CHANGES REQUIRED response)

**P1 fix — missing T1 evidence artifact:**
- Added `docs/06_status/proof/UTV2-1533/evidence.json` (T1 evidence bundle v1: sha_binding, static_proof, runtime_proof, acceptance_criteria — see file for full content). No invented merge SHA (PR not yet merged); `sha_binding.merge_sha` is explicitly `null` with a note.

**P2 fix — mechanical enforcement of type-level distribution caps:**
- **`docs/governance/CONCURRENCY_CONFIG.json`**: added `type_caps` block (`hygiene: 4`, `governance: 3`, `delivery-ui.max_per_app: 1`, `verification.max_per_target: 1`).
- **`scripts/ops/concurrency-config.ts`**: new `TypeCapsConfig` interface, `DEFAULT_TYPE_CAPS` fallback constant, `ConcurrencyConfig.type_caps` (required field). `loadConcurrencyConfig()` back-fills the default if a config predates the field. Flows through `getEffectiveConfig()` unchanged in both trial and non-trial branches (via the existing `...config` spread) — trial never overrides `type_caps`.
- **`scripts/ops/shared.ts`**:
  - `DELIVERY_UI_APP_ROOTS` (canonical map, single source of truth) + `deriveDeliveryUiApp(fileScopeLock)` — deterministic, fails closed (`null`) on empty/multi-app/out-of-root scope. No free-text inference.
  - New `LaneManifest.verification_target?: string` field (pattern `UTV2-###`).
  - `validateManifest()`: rejects a `schema_version: 2` `lane_type: "verification"` manifest missing `verification_target` (mirrors the exact `model_routing`/UTV2-1526 deletion-attack fix); rejects `verification_target` on any non-verification lane or a malformed value.
  - `createManifest()`: same enforcement at creation time, `schema_version`-gated (legacy `schema_version: 1` manifests may omit it).
- **`scripts/ops/lane-start.ts`**:
  - `checkConcurrencyLimits()` signature extended with an optional 5th param (`{ fileScopeLock?, verificationTarget? }`) — all 23 pre-existing call sites in `concurrency-simulation.test.ts` untouched (default `{}`), zero behavior change for non-hygiene/governance/delivery-ui/verification incoming types.
  - New enforcement block: hygiene/governance simple active-count caps; delivery-ui per-app conflict check (fails closed if app undetermined); verification per-target conflict check (fails closed if any active verification lane's target is undetermined).
  - New CLI flag `--verification-target <UTV2-###>`, required when `--lane-type verification` (same not-applicable-when-absent pattern as `--model-profile`), threaded into both the concurrency check and `createManifest()`.
- **`scripts/ops/lane-maximizer.ts`**: the advisory (never-executed) `dispatch_command` suggestion for `lane_type: "verification"` candidates now includes `--verification-target <candidate.issue_id>` (defaults to the candidate's own issue, documented as an operator-confirmable default, same as the existing `--model-profile` default). Two `lane-maximizer.test.ts` fixtures asserting the exact old command string updated to match.
- **`docs/05_operations/schemas/lane_manifest_v1.schema.json`** + **`docs/05_operations/LANE_MANIFEST_SPEC.md` §16**: documented `verification_target` and its `schema_version`-2 requirement, mirroring `model_routing`'s existing documentation shape.
- **`docs/governance/LANE_CONCURRENCY_POLICY.md`** §1: added a "Mechanization note" explaining what changed and why (the Hygiene/Governance/Delivery-UI/Verification rows' enforcement claim is now true, not aspirational).

## Round 3 (this round — fresh Codex review on round 2's head, 2 new P2 findings)

A fresh Codex review triggered against round 2's head (e8835a4a) surfaced 2 real bugs in the round-2 `verification_target` enforcement, both in `scripts/ops/lane-start.ts`:

1. **Resume path broke verification-lane resume.** `ops:lane:resume` re-invokes `ops:lane-start` for a blocked lane without re-supplying `--verification-target` (confirmed in `scripts/ops/lane-resume.ts`, which also doesn't re-supply `--model-profile` for the same reason) — the concurrency check ran *before* the "already exists" resume branch and unconditionally required the flag, so any verification-lane resume would spuriously fail. Fixed: `effectiveVerificationTarget` now backfills from the existing manifest (`manifestExists(issueId) ? readManifest(issueId) : null`) when the flag is absent, computed before `checkConcurrencyLimits` runs. Also excluded the incoming issue's own active manifest from the conflict-search set (`readAllManifests().filter((m) => m.issue_id !== issueId)`) — a lane must never be treated as conflicting with itself, whether resuming or (defensively) on a hypothetical duplicate-issue_id case.
2. **Malformed target validated too late.** A bad `--verification-target` (e.g. missing the numeral) wasn't caught until deep inside `createManifest()`, by which point `createBranchAndWorktree`/`reserveLease` had already run, leaving orphaned state behind a failed lane-start. Fixed: format validated immediately after parsing (reusing the existing `requireIssueId()` helper), before any branch/worktree/lease side effect.

Two new regression tests added to `scripts/ops/lane-start.test.ts` (static source-order checks, matching this file's existing convention for the equivalent `model_routing` resume-safety test): one asserts the backfill/self-exclusion code exists and runs before `checkConcurrencyLimits`, the other asserts the malformed-target check exists before `createBranchAndWorktree`/`reserveLease`.

Both threads (the PM-review P1/P2 from round 1, replied to and resolved with file:line evidence in round 2) and the fresh review's 2 new findings are now addressed. `verify`/type-check/R-level/targeted-tests all re-confirmed green at the round-3 head.

## Tests (14 requested + supporting coverage)

`scripts/ops/concurrency-simulation.test.ts` — 14 new tests against a new `PROD_POLICY` fixture (the real 10/4/6 + type_caps numbers, not the existing small-number `POLICY` fixture used for generic-mechanism tests): lane 11 rejected (total cap), 5th Claude rejected, 7th Codex rejected, 5th Hygiene rejected (isolated — asserted via exact violation-code array, not just presence), 4th Governance rejected (isolated), 2nd Delivery/UI same app rejected, Delivery/UI different apps accepted, 2nd Verification same target rejected, Verification different targets accepted, singleton behavior intact under PROD_POLICY, forbidden combinations intact under PROD_POLICY, disabled 12–14 trial confirmed inactive against the real shipped JSON, trial activation does NOT bypass type caps (explicit adversarial test), `execution-state.ts`'s `MAX_CLAUDE_LANES`/`MAX_CODEX_LANES` confirmed to read 4/6 from the real shipped config.

Also fixed one **pre-existing** test ("trial mode: 7th lane allowed when trial active") whose fixture had 4 active hygiene lanes before adding a 5th — valid before type caps existed, invalid after; rebalanced to 3 governance + 3 hygiene→4 hygiene, preserving the original test's intent (prove total/executor headroom) without violating the new hygiene cap.

`scripts/ops/shared.test.ts` — 9 new tests: `createManifest`/`validateManifest` enforcement for `verification_target` (required/forbidden/malformed/deletion-attack, mirroring the 5 existing `model_routing` tests exactly) + 4 `deriveDeliveryUiApp` tests (single app, empty scope, multi-app, out-of-root path).

`scripts/ops/lane-maximizer.test.ts` — 2 pre-existing tests updated (not new) to match the corrected advisory command string.

## Audit rationale (round 1, unchanged)

Full audit is in the UTV2-1533 issue body. Summary: `getEffectiveConfig()` and every consumer read the JSON directly — no code hardcodes 2/4/6, no external system enforces those numbers. The two real mechanical constraints — merge-train serialization and the WSL2-driven full-verify semaphore — are both untouched by this change.

## Not in this diff (deliberately)

- `scripts/ops/execution-state.ts`, `merge-risk.ts`, `lane-maximizer.ts`'s own `?? 2` / `?? 4` fallback defaults (dead code, config-load-failure-only path) — unchanged, out of scope, pre-existing minor defense-in-depth gap.
- `merge_serialized_max` — untouched, real constraint, not a policy number.
- Enabling the 12–14 trial — stays `enabled: false`.
- UTV2-1472 (Claude parallel dispatch) — separate companion issue, not folded in.
