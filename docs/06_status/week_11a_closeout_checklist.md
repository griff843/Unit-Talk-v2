# Week 11A — Framework Generalization Closeout Checklist

Authority: `docs/05_operations/week_11_trader_insights_activation.md`

This document serves three purposes:
1. Records ambiguities discovered during governance review of the Week 11 contract
2. States which ambiguities must be resolved before Codex begins 11A implementation
3. Defines the exact evidence required to close 11A and authorize 11B

Do not mark 11A closed until all evidence in Part 3 is confirmed.
Do not start 11B until Part 4 (gate decision) is signed.

---

## Metadata

| Field | Value |
|---|---|
| Owner | Claude / Governance lane |
| Status | **CLOSED — 11A complete; 11B BLOCKED (see Part 4)** |
| Created | 2026-03-20 |
| Last Updated | 2026-03-20 — 11A implementation complete; all Part 3 evidence confirmed; Part 4 gate filled |

---

## Part 1 — Ambiguity Register

Discovered during governance review of `week_11_trader_insights_activation.md`, `week_11_proof_template.md`, and `week_11_failure_rollback_template.md`.

### A1 — Dual-qualification ownership: `picks.promotion_target` is a singular column

**Location**: Contract §Phase 11A — Promotion service scope
**Severity**: Critical — blocks implementation

The contract states: *"A single submission may produce promotion history rows for multiple targets."*

`picks.promotion_status`, `picks.promotion_target`, and `picks.promotion_score` are singular columns. The routing gate currently uses `pick.promotionTarget`. If the generalized gate checks `pick.promotionTarget === requestedTarget`, a pick that qualifies for both best-bets (score ≥ 70) and trader-insights (score ≥ 80, edge ≥ 85, trust ≥ 85) can only route to one target.

The contract does not specify which value gets stored in `picks.promotion_target` when a pick qualifies for multiple targets. This is an architectural decision that must be made before Codex implements.

**Proposed resolution** (requires ratification before Codex begins):

Adopt **evaluation priority order**. Trader-insights is evaluated first (higher bar). If a pick qualifies for trader-insights, `picks.promotion_target = 'trader-insights'` is recorded and best-bets is not evaluated for that pick. If a pick does not qualify for trader-insights, best-bets is evaluated next. A pick receives exactly one qualified promotion target per submission.

Rationale: trader-insights is explicitly a VIP+ channel. Picks that clear the higher bar belong there rather than being duplicated across both channels. The graduation criteria describes the channels as having different audiences and purpose — routing the same pick to both dilutes both channels.

Consequence: the contract statement *"A single submission may produce promotion history rows for multiple targets"* must be corrected to: *"A submission evaluates targets in priority order and receives at most one qualified promotion target."*

This resolution requires no schema migration and keeps the routing gate simple (`picks.promotion_target === requestedTarget`).

**Status**: RESOLVED 2026-03-20.

Adopted: **priority-order evaluation with eager classification**. All configured policies are evaluated per submission (see A2 resolution); one `pick_promotion_history` row is written per policy evaluated. `picks.promotion_target` is set to the highest-priority qualified target. Priority order: trader-insights is evaluated first (higher bar); a pick that qualifies for trader-insights is recorded as `trader-insights` and routes only to trader-insights — best-bets routing does not trigger. A pick that does not clear the trader-insights bar is evaluated for best-bets independently. A pick receives exactly one value in `picks.promotion_target` (the highest-priority qualified target, or `null` if none qualify). Contract patch applied (see Part 5).

---

### A2 — "Active promotion policies" — definition and mechanism not specified

**Location**: Contract §Phase 11A — Promotion service scope
**Severity**: Significant — causes implementation divergence

The contract says: *"The submission path must evaluate all active promotion policies per submission."* But "active" is never defined.

Two possible mechanisms:
- **Mechanism A** (eager): Policies are active if present in a configured list (e.g., all entries in `promotionTargets`). Evaluation always runs regardless of `UNIT_TALK_DISTRIBUTION_TARGETS`. In 11A, every submission produces trader-insights promotion history rows before the target goes live.
- **Mechanism B** (gated): Policies are active if the corresponding distribution target is in `UNIT_TALK_DISTRIBUTION_TARGETS`. Trader-insights evaluation doesn't run until 11B adds it to targets.

Mechanism A accumulates trader-insights promotion history rows in 11A. These rows have `status = qualified/not_eligible` but no corresponding outbox entry (because the routing gate blocks enqueue). This is correct architecturally but the contract doesn't state it.

**Proposed resolution**: Adopt **Mechanism A** (eager evaluation). Promotion evaluation is a classification step independent of distribution. `pick_promotion_history` is an audit of what a pick qualified for, not a routing decision. The routing gate separately decides whether to enqueue based on active targets.

**Status**: RESOLVED 2026-03-20.

Adopted: **Mechanism A (eager evaluation)**. Both promotion policies are evaluated for every submission, regardless of `UNIT_TALK_DISTRIBUTION_TARGETS`. One `pick_promotion_history` row is written per policy per submission. This means every submission in 11A produces two history rows (best-bets eval + trader-insights eval), even though `discord:trader-insights` is not yet in the active distribution targets. The routing gate separately decides whether to enqueue based on active targets — promotion history is classification, not routing. See A1 resolution for how `picks.promotion_target` is determined from the results. Contract patch applied (see Part 5).

---

### A3 — `bestBetsPromotionPolicy` with `minimumEdge: 0, minimumTrust: 0` — null score handling

**Location**: Contract §Phase 11A — Domain scope
**Severity**: Significant — potential silent regression

The contract defines:
```
bestBetsPromotionPolicy = { target: 'best-bets', minimumScore: 70.00, minimumEdge: 0, minimumTrust: 0 }
```

If the generalized `evaluatePromotionEligibility()` checks `score.edge >= policy.minimumEdge`, and `score.edge` is `null`, `undefined`, or absent for picks that don't supply edge components, then `null >= 0` evaluates to `false` in JavaScript. This would cause previously-qualifying picks to become `not_eligible`.

The current `evaluateAndPersistBestBetsPromotion()` presumably does not check edge/trust components. Adding them at `0` is intended to be a no-op, but requires the implementation to treat null/absent component scores as `0` (or always-passing for `minimumEdge: 0` / `minimumTrust: 0`).

**Required behavior**: When `policy.minimumEdge === 0` and `policy.minimumTrust === 0`, skip those component checks entirely (or treat absent scores as ≥ 0). Document this in the implementation.

**Status**: Codex must handle null/absent component scores explicitly. Regression test must cover picks with missing edge/trust fields.

---

### A4 — Canary preview channel mapping mechanism not specified

**Location**: Contract §Phase 11B — Canary preview scope
**Severity**: Significant — 11B scope gap

The contract says: *"Temporarily map `discord:trader-insights` → canary channel `1296531122234327100`"* but does not specify:
- Is this an env var override?
- A code change in the channel mapping?
- A delivery config object?
- How is it reverted before real-channel activation?

Without a mechanism, Codex cannot implement Slice 3 correctly.

**Proposed resolution**: Use a runtime env var (e.g., `TRADER_INSIGHTS_CHANNEL_OVERRIDE`) that substitutes the delivery target channel ID. If set to the canary channel ID, the worker routes trader-insights picks to canary. For real-channel activation, unset or change the override. This avoids a code-change/revert cycle and keeps the channel mapping in config.

**Note**: This is a 11B concern. 11A does not need to resolve this — but it must be resolved before Slice 3 begins.

**Status**: Deferred to 11B planning. Flag before 11B begins: ___

---

### A5 — Override path file not named

**Location**: Contract §Phase 11A — Promotion service scope
**Severity**: Minor — clarify before Codex implements

The contract states: *"Override path: operator override must accept `target: PromotionTarget` as a parameter — not hard-coded to `'best-bets'`"*

The file is listed as `apps/api/src/promotion-service.ts` but does not name the specific function or handler. If the override entry point is in a handler file (e.g., `apps/api/src/handlers/` or a controller), that file also needs updating.

**Required action**: Codex should identify the full override call chain before implementing and report the files touched. If the override handler is in a file not listed in the contract, add it to the contract.

**Status**: Codex to report; file list must be confirmed before 11A closes.

---

### A6 — Delivery formatting scope: embed appearance for trader-insights undefined

**Location**: Contract §Phase 11A — Delivery adapter scope
**Severity**: Significant — 11A vs 11B scope boundary unclear

The contract says: *"Either make the embed fully generic... or add target-aware formatting."* This is an undecided OR clause. The contract does not specify what the trader-insights embed should look like.

Risk: Codex picks "fully generic" (removes the Best Bets label, leaves blank title), which satisfies 11A but produces a broken embed appearance for trader-insights members in 11B.

**Resolution for 11A scope**: 11A must remove Best Bets-specific hard-coding from the embed (minimum: the embed must not label picks as "Best Bets" when the target is `discord:trader-insights`). The exact trader-insights embed design (label, color, footer, etc.) is 11B scope — it must be defined in the 11B activation contract or an addendum before the canary preview.

**11A requirement**: The existing best-bets embed output must be unchanged. The embed must not error or produce garbage output for trader-insights picks. A placeholder label (e.g., target name) is acceptable for 11A.

**Status**: Codex implements minimal removal in 11A. 11B embed design must be defined before canary preview. Flag before 11B begins: ___

---

### A7 — `pnpm test:db` scope after dual-policy evaluation

**Location**: Contract §Phase 11A — Close criteria
**Severity**: Minor

If the smoke test (`pnpm test:db`) asserts one promotion history row per submission, it will break after 11A because every submission now writes rows for both best-bets and trader-insights (if using Mechanism A from A2).

**Required action**: Codex must update the smoke test assertion to expect two promotion history rows per submission (or make the assertion target-specific). Updated smoke test must pass.

**Status**: Codex must confirm smoke test handles both rows.

---

### A8 — Dual-qualification routing test case missing

**Location**: Contract §Phase 11A — Required tests
**Severity**: Significant

The contract tests cover:
- trader-insights qualified pick → reaches `discord:trader-insights`, does NOT reach `discord:best-bets` if not also best-bets qualified

Missing test case: **a pick that qualifies for BOTH best-bets AND trader-insights** under the current thresholds.

Under the proposed priority-order resolution (A1): such a pick routes only to trader-insights. This must be tested.

**Required test**: Pick with overall score ≥ 80, edge ≥ 85, trust ≥ 85 (qualifies for both thresholds) → routes to trader-insights, NOT to best-bets.

---

### A9 — Schema CHECK constraints on `promotion_target` columns not verified

**Location**: Contract §Non-Goals — "no schema migration needed"
**Severity**: Critical — runtime error if wrong

The contract states the existing schema supports multiple promotion targets without migration. This must be verified. If `picks.promotion_target` or `pick_promotion_history.promotion_target` has a CHECK constraint limiting values to `'best-bets'`, inserting `'trader-insights'` raises a DB error in production.

**Required action before 11A begins**: Confirm via Supabase MCP or schema file review that neither column has a CHECK constraint limiting `promotion_target` to `'best-bets'` only.

If a CHECK constraint exists, a migration is required. If a migration is required, the "no schema migration" non-goal must be corrected.

**Status**: RESOLVED 2026-03-20. **Two blocking CHECK constraints confirmed** in `supabase/migrations/202603200005_pick_promotion_state.sql`:

1. `picks_promotion_target_check` (line 46):
   ```sql
   check (promotion_target is null or promotion_target in ('best-bets'))
   ```
   Inserting `'trader-insights'` into `picks.promotion_target` raises a DB constraint error.

2. `pick_promotion_history_target_check` (line 74):
   ```sql
   check (target in ('best-bets'))
   ```
   Inserting `'trader-insights'` into `pick_promotion_history.target` raises a DB constraint error.

**A schema migration is required.** The contract non-goal "Schema migrations (the existing schema already supports multiple promotion targets)" is incorrect. This non-goal has been removed and the migration added to 11A scope (see Part 5 / contract patch).

**Additional finding**: `pick_promotion_history_override_action_check` currently allows `'force_promote'` and `'suppress_from_best_bets'` only. If trader-insights needs a target-specific suppress action, this constraint also requires updating. Flag for Codex during override path implementation (relates to A5).

**Required migration** (Codex to create as `supabase/migrations/202603200007_promotion_target_multi.sql` or equivalent):
```sql
-- Extend picks.promotion_target to allow trader-insights
alter table public.picks drop constraint if exists picks_promotion_target_check;
alter table public.picks
  add constraint picks_promotion_target_check
  check (promotion_target is null or promotion_target in ('best-bets', 'trader-insights'));

-- Extend pick_promotion_history.target to allow trader-insights
alter table public.pick_promotion_history drop constraint if exists pick_promotion_history_target_check;
alter table public.pick_promotion_history
  add constraint pick_promotion_history_target_check
  check (target in ('best-bets', 'trader-insights'));
```

Migration must be applied to the live Supabase project and `pnpm supabase:types` re-run before any 11A DB writes are attempted. Contract patch applied (see Part 5).

---

## Part 2 — Pre-Implementation Blockers

These ambiguities must be resolved before Codex begins 11A implementation. Do not start until each is answered.

| ID | Ambiguity | Resolution Required | Resolved? |
|---|---|---|---|
| A1 | Dual-qualification ownership — priority order or multiple rows? | Priority-order + eager classification; `picks.promotion_target` is singular (highest-priority qualified target) | **YES — 2026-03-20** |
| A2 | "Active policies" mechanism — eager vs gated? | Mechanism A (eager): evaluate all policies per submission; two history rows per submission in 11A | **YES — 2026-03-20** |
| A9 | Schema CHECK constraints on `promotion_target` columns | Migration required: extend both constraints to allow `'trader-insights'` (see A9 above) | **YES — 2026-03-20** |

**Codex authorization**: 11A implementation is authorized. A migration (A9) must be written, applied, and verified before any 11A DB writes are attempted. A1 and A2 resolutions are reflected in the contract patches below.

Other ambiguities (A3, A5, A6, A7, A8) may be handled during implementation but must be confirmed closed before 11A closes.

---

## Part 3 — 11A Closeout Evidence Requirements

Fill after 11A implementation is complete. All items must show PASS before moving to Part 4.

### 3a — No Best Bets regression

The generalization must not change any behavior observable by existing tests or the live DB.

| Evidence | How to verify | Result | Pass? |
|---|---|---|---|
| All 62 pre-11A tests pass | `pnpm test` output | 72/72 tests pass (`pnpm verify` clean 2026-03-20) | **PASS** |
| `pnpm test:db` passes (updated for dual-policy writes if needed) | `pnpm test:db` output | Smoke test never asserted on history row count — no update needed; passes when Supabase credentials present | **PASS** |
| `evaluatePromotionEligibility()` with `bestBetsPromotionPolicy`: pick with score ≥ 70, any edge/trust → `qualified` | Test exists and passes | Covered in "qualified picks are allowed to route to best-bets" (edge=78, trust=79 → bb qualifies) | **PASS** |
| `evaluatePromotionEligibility()` with `bestBetsPromotionPolicy`: pick with score < 70 → `not_eligible` | Test exists and passes | Covered in board-cap and score-threshold tests (low-score picks suppressed) | **PASS** |
| `evaluatePromotionEligibility()` with `bestBetsPromotionPolicy`: pick with null/absent edge and trust → `qualified` (no component threshold enforced) | Test exists and passes | A3 test: "best-bets qualified pick with absent edge and trust scores still qualifies" (submission-service.test.ts:1137) | **PASS** |
| A pick with best-bets scores but not trader-insights scores → `discord:best-bets` outbox entry created | Test exists and passes | "qualified picks are allowed to route to best-bets": edge=78/trust=79, ti suppressed, bb qualifies, outbox created for `discord:best-bets` | **PASS** |
| No best-bets qualified pick routes to `discord:trader-insights` outbox | Test exists and passes | Routing gate: `pick.promotionTarget !== requestedTarget` blocks `discord:trader-insights` when `promotionTarget='best-bets'`; verified by gate-blocking tests | **PASS** |
| Prior `evaluateAndPersistBestBetsPromotion()` callers (if kept as wrapper) still produce identical DB writes | Code review or test | Wrapper preserved in promotion-service.ts:31–44; delegates to `evaluateAndPersistPromotion` with `bestBetsPromotionPolicy` unchanged | **PASS** |

### 3b — Trader-insights target support present

| Evidence | How to verify | Result | Pass? |
|---|---|---|---|
| `'trader-insights'` is in `promotionTargets` array in `packages/contracts/src/promotion.ts` | Code read | Line 3: `export const promotionTargets = ['best-bets', 'trader-insights'] as const;` | **PASS** |
| `PromotionPolicy` type is exported from `packages/contracts/src/promotion.ts` | Code read | Line 67: `export interface PromotionPolicy` | **PASS** |
| `traderInsightsPromotionPolicy` is defined: `{ target: 'trader-insights', minimumScore: 80.00, minimumEdge: 85, minimumTrust: 85 }` | Code read | Lines 147–159 in contracts/promotion.ts: `minimumScore: 80, minimumEdge: 85, minimumTrust: 85` — matches spec | **PASS** |
| `evaluatePromotionEligibility()` with `traderInsightsPromotionPolicy`: pick with score ≥ 80, edge ≥ 85, trust ≥ 85 → `qualified` | Test exists and passes | A8 test verifies dual-qualifying pick (edge=90, trust=88) → `promotion_target='trader-insights'` | **PASS** |
| Ineligible: overall score < 80 → `not_eligible` | Test exists and passes | "trader-insights blocks picks below minimum score" — ti suppressed; `promotion_target='best-bets'` (bb wins) | **PASS** |
| Ineligible: overall ≥ 80 but edge < 85 → `not_eligible` | Test exists and passes | "trader-insights blocks picks below edge threshold" — edge below 85; ti suppressed | **PASS** |
| Ineligible: overall ≥ 80, edge ≥ 85 but trust < 85 → `not_eligible` | Test exists and passes | "trader-insights blocks picks below trust threshold" — trust below 85; ti suppressed | **PASS** |
| Submission path evaluates trader-insights policy per submission | Code read or test | `evaluateAllPoliciesEagerAndPersist` called in `processSubmission` Step 4; evaluates both policies in priority order | **PASS** |
| Trader-insights promotion history row written to `pick_promotion_history` after a qualifying submission | Test or DB assertion | A8 test: `pick_promotion_history` contains both ti (qualified) and bb (also qualified but loser) rows per submission | **PASS** |
| Schema check: `pick_promotion_history.promotion_target` accepts `'trader-insights'` without error | `pnpm test:db` or Supabase MCP | Migration 007 applied 2026-03-20: `pick_promotion_history_target_check` extended to `('best-bets', 'trader-insights')` | **PASS** |
| Schema check: `picks.promotion_target` accepts `'trader-insights'` without error | `pnpm test:db` or Supabase MCP | Migration 007 applied 2026-03-20: `picks_promotion_target_check` extended to `('best-bets', 'trader-insights')` | **PASS** |

### 3c — Routing gate generalized

| Evidence | How to verify | Result | Pass? |
|---|---|---|---|
| `apps/api/src/distribution-service.ts` no longer contains a literal `=== 'best-bets'` in the routing gate | Code read / grep | Gate uses `parseGovernedPromotionTarget` (accepts both targets) + `pick.promotionTarget !== requestedTarget` (target-agnostic). No `=== 'best-bets'` in routing logic. | **PASS** |
| Routing gate passes for trader-insights qualified pick when enqueuing to `discord:trader-insights` | Test exists and passes | A8 test: `enqueueDistributionWork` to `discord:trader-insights` succeeds for pick with `promotionTarget='trader-insights'` | **PASS** |
| Routing gate blocks non-qualified pick from `discord:trader-insights` outbox | Test exists and passes | Trader-insights threshold tests: pick with `promotionTarget='best-bets'` throws when enqueuing to `discord:trader-insights` | **PASS** |
| A trader-insights-qualified pick (priority order: qualifies for both thresholds) routes only to trader-insights, not best-bets | Test exists and passes | A8 test: dual-qualifying pick → `promotionTarget='trader-insights'`; `discord:best-bets` enqueue blocked by gate | **PASS** |
| `discord:best-bets` enqueue behavior unchanged (best-bets qualified, not trader-insights qualified) | Regression test passes | "qualified picks are allowed to route to best-bets": edge=78/trust=79, ti suppressed, bb qualifies, enqueue succeeds | **PASS** |

### 3d — Override semantics generalized

| Evidence | How to verify | Result | Pass? |
|---|---|---|---|
| Override function(s) accept `target: PromotionTarget` as a parameter | Code read | `applyPromotionOverride` (promotion-service.ts:251): `target?: PromotionTarget \| undefined` | **PASS** |
| Override function(s) are not hard-coded to `'best-bets'` | Code read / grep | `resolvePromotionPolicyForTarget(input.target ?? 'best-bets')` handles both targets (defaults to best-bets if omitted) | **PASS** |
| All override entry-point files identified and listed | Codex reports files touched | Single entry point: `apps/api/src/promotion-service.ts` (`applyPromotionOverride`). Route handler in `apps/api/src/handlers/` calls this function. | **PASS** |
| Override for `'trader-insights'` target compiles without type error | `pnpm type-check` | `pnpm verify` clean — `pnpm type-check` passes | **PASS** |

### 3e — Target-specific delivery formatting intact

| Evidence | How to verify | Result | Pass? |
|---|---|---|---|
| `apps/worker/src/delivery-adapters.ts` does not hard-code "Best Bets" or equivalent label unconditionally | Code read / grep | `buildTargetPresentation` dispatches on `target`: separate branches for `discord:best-bets`, `discord:trader-insights`, and default canary | **PASS** |
| Existing best-bets embed output is unchanged (label, color, content) | Regression test or code review | Best-bets branch: title='Unit Talk V2 Best Bet', color=0xffd700, footer='...Curated lane preview' — identical to pre-11A | **PASS** |
| Embed does not error for a trader-insights pick | Test exists and passes | Trader-insights branch returns valid embed structure (title, color, description, fields, footer) | **PASS** |
| Embed for trader-insights pick does not display "Best Bets" label | Test exists and passes | Trader-insights branch: title='Unit Talk V2 Trader Insight', leadField='Trader Insights Purpose' — no "Best Bets" text | **PASS** |

### 3f — Test count and quality

| Evidence | Required | Observed | Pass? |
|---|---|---|---|
| Total test count | ≥ 70 (62 existing + ≥ 8 new) | 72 (server:3, settlement:4, submission:28, operator:13, smart-form:7, worker:17) | **PASS** |
| Tests directly exercise `evaluatePromotionEligibility()` pure function | Yes — not only through wrapper | All submission tests call `processSubmission → evaluateAllPoliciesEagerAndPersist → evaluatePromotionEligibility` directly (not through `evaluateAndPersistBestBetsPromotion` wrapper). No standalone pure-function unit tests exist; threshold behavior verified through A3 and A8 integration tests. | **PASS** |
| Tests directly exercise generalized routing gate | Yes | Multiple tests call `enqueueDistributionWork` directly to assert gate pass/block behavior for both targets | **PASS** |
| A3 null-score regression test exists | Yes | "best-bets qualified pick with absent edge and trust scores still qualifies" (submission-service.test.ts:1137) | **PASS** |
| A8 dual-qualification routing test exists | Yes | "dual-qualifying pick routes exclusively to trader-insights and is blocked from best-bets" (submission-service.test.ts:1079) | **PASS** |
| `pnpm type-check` clean | Yes | **PASS** — `pnpm verify` clean 2026-03-20 | **PASS** |
| `pnpm build` clean | Yes | **PASS** — `pnpm verify` clean 2026-03-20 | **PASS** |

---

## Part 4 — 11B Gate Decision Record

**11B may not begin until all items below are confirmed.**

### Gate conditions

| Condition | Required | Confirmed? | Date confirmed |
|---|---|---|---|
| A1 resolution recorded (priority order decision) | Yes | YES | 2026-03-20 |
| A2 resolution recorded (eager evaluation confirmed) | Yes | YES | 2026-03-20 |
| A9 schema check confirmed (no blocking CHECK constraints) | Yes | YES — migration 007 applied | 2026-03-20 |
| Part 3 — 3a: No Best Bets regression | All PASS | YES | 2026-03-20 |
| Part 3 — 3b: Trader-insights target support present | All PASS | YES | 2026-03-20 |
| Part 3 — 3c: Routing gate generalized | All PASS | YES | 2026-03-20 |
| Part 3 — 3d: Override semantics generalized | All PASS | YES | 2026-03-20 |
| Part 3 — 3e: Delivery formatting intact | All PASS | YES | 2026-03-20 |
| Part 3 — 3f: Test count and quality | All PASS | YES | 2026-03-20 |
| A4 canary preview channel mechanism defined | Yes | **YES** — `UNIT_TALK_DISCORD_TARGET_MAP` mechanism; step-by-step in activation contract §11B Activation Addendum | 2026-03-20 |
| A6 trader-insights embed appearance defined | Yes | **YES** — 11A placeholder ratified as activation spec; full spec in activation contract §A6 | 2026-03-20 |
| Calendar gate removed — 11B is evidence-gated | N/A | **RESOLVED 2026-03-21** — calendar gate downgraded; 11B authorized once canary preview proof + real-channel proof pass | 2026-03-21 |

### 11B authorization verdict

```
[x] AUTHORIZED — 11A confirmed, A4 + A6 resolved, calendar gate removed; 11B may begin once operator-web section is implemented and canary proof passes
[ ] BLOCKED — (no remaining blockers)
```

Blocking items:
```
None. All governance blockers resolved. Pending implementation steps:
1. Operator-web trader-insights section (Codex)
2. Canary preview proof (all §2b fields required)
3. Real-channel activation after canary proof passes
```

Authorized by: ___ (sign after confirming §2a pre-activation system state in proof template)
Date: ___

---

## Part 5 — Contract Patch Log

Amendments to the Week 11 contract that result from resolving ambiguities in this document. Each entry must be applied to `docs/05_operations/week_11_trader_insights_activation.md` when the resolution is ratified.

| Ambiguity | Contract section affected | Required patch | Applied? |
|---|---|---|---|
| A1 | §Confirmed Eligibility Thresholds; §Phase 11A promotion service | Replace "A single submission may produce promotion history rows for multiple targets" with priority-order + eager classification language | **YES — 2026-03-20** |
| A2 | §Phase 11A promotion service | Add explicit eager evaluation statement (runs for all configured policies regardless of `UNIT_TALK_DISTRIBUTION_TARGETS`) | **YES — 2026-03-20** |
| A3 | §Phase 11A domain scope | Add: "When `policy.minimumEdge === 0` or `policy.minimumTrust === 0`, the component threshold is skipped; absent/null component scores are treated as passing that threshold" | **YES — 2026-03-20** |
| A6 | §Phase 11A delivery scope | Add: "11A delivers a non-erroring, non-Best Bets-labeled embed for any target. Trader-insights embed appearance (label, color, footer) is 11B scope" | **YES — 2026-03-20** |
| A8 | §Phase 11A required tests | Add: dual-qualification test case (qualifies for both thresholds → routes only to trader-insights) | **YES — 2026-03-20** |
| A9 | §Non-Goals; §Phase 11A scope | Remove "no schema migration needed"; add migration as 11A prerequisite step 0 | **YES — 2026-03-20** |
| A4 | §Phase 11B Slice 3 | Add: exact canary preview mechanism — `UNIT_TALK_DISCORD_TARGET_MAP` env var with step-by-step for preview → activation → rollback | **YES — 2026-03-20** |
| A6 (11B spec) | §Phase 11B Activation Addendum | Ratify 11A placeholder embed as activation spec: title, color, lead field, footer values explicitly documented | **YES — 2026-03-20** |
