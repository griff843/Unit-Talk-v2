# Diff Summary — UTV2-1533

**Issue:** UTV2-1533 — Post-lock concurrency ramp: raise ceiling to 10 active lanes (4 Claude + 6 Codex)
**Tier:** T1 (governance-critical)
**Lane type:** governance
**Status:** Round 4 — continuation onto a canonical `claude/` branch, superseding PR #1213 (accepted at the code level; see round 3 close-out and PM continuation directive below). Replacement PR **not merged**.

## Files changed (cumulative, vs origin/main — generated via `git diff --stat origin/main...HEAD`, not hand-typed)

Substantive implementation + docs (9 files beyond the original 5-file lane scope; see `evidence.json`'s `scope_expansion` for the corrected count):

```
$ git diff --stat origin/main...HEAD -- docs/governance/CONCURRENCY_CONFIG.json docs/governance/LANE_CONCURRENCY_POLICY.md scripts/ops/concurrency-simulation.test.ts scripts/ops/shared.ts scripts/ops/shared.test.ts scripts/ops/concurrency-config.ts scripts/ops/lane-start.ts scripts/ops/lane-start.test.ts scripts/ops/lane-maximizer.ts scripts/ops/lane-maximizer.test.ts docs/05_operations/schemas/lane_manifest_v1.schema.json docs/05_operations/LANE_MANIFEST_SPEC.md
 docs/05_operations/LANE_MANIFEST_SPEC.md           |  14 ++
 .../schemas/lane_manifest_v1.schema.json           |  26 ++
 docs/governance/CONCURRENCY_CONFIG.json            |  26 +-
 docs/governance/LANE_CONCURRENCY_POLICY.md         |  74 ++++--
 scripts/ops/concurrency-config.ts                  |  34 ++-
 scripts/ops/concurrency-simulation.test.ts         | 269 ++++++++++++++++++++-
 scripts/ops/lane-maximizer.test.ts                 |   4 +-
 scripts/ops/lane-maximizer.ts                      |   9 +
 scripts/ops/lane-start.test.ts                     |  54 +++++
 scripts/ops/lane-start.ts                          | 129 +++++++++-
 scripts/ops/shared.test.ts                         | 125 ++++++++++
 scripts/ops/shared.ts                              |  92 +++++++
 12 files changed, 813 insertions(+), 43 deletions(-)
```

Plus control-plane/proof files (exempt from file-scope-lock, no override needed): `docs/06_status/lanes/UTV2-1533.json`, `.ops/sync/UTV2-1533.yml`, `docs/06_status/proof/UTV2-1533/{.gitkeep,diff-summary.md,evidence.json,verification.md}`.

## Round 4 (this round — continuation onto claude/ branch, superseding PR #1213)

PM directive: the concurrency implementation is accepted at the code level (structured T1 evidence, 10/4/6 limits, mechanically enforced type caps, schema-validated resume-safe `verification_target`, early validation, 109/109 tests, `pnpm verify` green, all review threads resolved) — do not redesign or repeat it. Replace PR #1213 with a canonically-named continuation because `griffadavi/...` can never satisfy `Executor Result Validation`'s ratified `claude/`- or `codex/`-prefixed branch contract, a required fail-closed CI check.

**What changed in round 4 (no implementation change):**
1. **Branch**: `claude/utv2-1533-post-lock-concurrency-ramp` created via `git branch <name> 24696311888e8c24beb530d557efe3e95ee4aa52` (PR #1213's accepted final head) — not cherry-picked, not reconstructed. Full commit history preserved (`9dce09ab` → `343735ba` → `e8835a4a` → `c9ddd22d` → `24696311`).
2. **Worktree**: fresh worktree at `.out/worktrees/claude__utv2-1533-post-lock-concurrency-ramp`, dependencies installed, env linked.
3. **Lane manifest** (`docs/06_status/lanes/UTV2-1533.json`): `branch`, `worktree_path`, `execution_location.cwd`, `preflight_token`, `commit_sha` repaired to the new branch/worktree; `status` advanced `started` → `in_progress` (valid transition); `file_scope_lock` now truthfully declares the full accepted scope (5 original + 9 expanded); `notes` records the continuation and supersession.
4. **Preflight**: PL3 ("issue state startable") and PL5 ("no active manifest exists") are structurally inapplicable to a continuation (both are non-waivable for T1 via the normal `--skip` mechanism, confirmed by attempting it — `PS2` correctly refused). Token hand-authored per this repo's documented manual-preflight-token procedure, with all other real preconditions (git state, deps, type-check, test, `verify:quick`) independently re-confirmed via direct command runs in the new worktree, not skipped.
5. **Lease**: old branch-bound lease released (`.ops/leases/UTV2-1533.json`, reason recorded), new lease reserved bound to the new branch/worktree with the full accepted file scope.
6. **Proof docs corrected** (this commit): `verification.md` gained the `# PROOF: UTV2-1533` / `MERGE_SHA:` / `ASSERTIONS:` / `EVIDENCE:` block required by `executor-result-validator.yml`'s proof-file contract (`MERGE_SHA` references the last substantive implementation commit `c9ddd22d`, an ancestor of the replacement PR head — an explicitly supported pattern in that validator, not a hack), plus `## Summary`/`## Evidence`/`## Verification` sections. `evidence.json` corrected: `current_pr_head_sha` no longer conflated with the substantive-commit SHA (was wrong in round 3); `scope_expansion`'s expanded-path count corrected from 8 to 9 (missing `scripts/ops/lane-start.test.ts`, added in round 3 but never added to that list); `runtime_proof` corrected to acknowledge that CI's T1 Proof Gate job (`proof-gate.yml`, job `t1-proof`) runs `pnpm ci:db-smoke` (the `pnpm test:db` equivalent) as a hard-gated C2 step for every T1 PR and it passed on PR #1213 — the earlier "not run" framing was accurate only for the local executor session and read too broadly.

## Round 1 (original submission)

1. **`docs/governance/CONCURRENCY_CONFIG.json`**: `total` 6→10, `executors.claude` 2→4, `executors.codex` 4→6, `version` 2→3. Retired the expired 8-lane trial, staged a **disabled** 14-lane trial (`claude:5, codex:9, allowed_until:null`) for a future ramp step.
2. **`docs/governance/LANE_CONCURRENCY_POLICY.md`**: §1/§6/§10/§11 updated to the new numbers, plus a provenance note (soft policy, not mechanical).
3. **`scripts/ops/concurrency-simulation.test.ts`**: fixed the one assertion hardcoding `total===6`/`claude===2`/`codex===4`.

## Round 2 (PM review CHANGES REQUIRED response)

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

## Round 3 (fresh Codex review on round 2's head, 2 new P2 findings)

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
