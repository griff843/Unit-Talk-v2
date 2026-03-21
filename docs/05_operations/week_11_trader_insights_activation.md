# Week 11 — Trader-Insights: Generalization + Controlled Activation

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture |
| Status | Ratified |
| Ratified | 2026-03-20 |
| Last Updated | 2026-03-20 — 11A complete; 11B addendum added: A4 canary preview mechanism defined, A6 embed spec ratified |
| Supersedes | Previous draft — did not account for Best Bets-specific runtime gaps |

---

## Objective

Introduce `discord:trader-insights` as the second governed distribution target by:

1. **Week 11A — Generalization**: Refactor the existing Best Bets-specific promotion/routing/evaluation/override/delivery framework into a multi-target framework. No new channels go live in 11A.
2. **Week 11B — Controlled Activation**: Use the generalized framework to activate `discord:trader-insights` with a canary preview run, real-channel delivery, and a monitored proof window.

`discord:canary` and `discord:best-bets` remain active and unchanged throughout both phases.

**Architecture direction**: Generalize the existing framework. Do not create a parallel ad hoc trader-insights path alongside the existing Best Bets path.

---

## Why 11A Must Come First

The current runtime has five Best Bets-specific constraints that block trader-insights activation:

| Gap | Location | Constraint |
|---|---|---|
| Promotion logic | `apps/api/src/promotion-service.ts` | `evaluateAndPersistBestBetsPromotion()` is hard-coded to the best-bets policy and target |
| Routing gate | `apps/api/src/distribution-service.ts` | Gate checks `promotionTarget === 'best-bets'` explicitly |
| Evaluation trigger | Submission path | Only best-bets promotion is evaluated per submission |
| Override semantics | Promotion override path | Override is wired only for the best-bets target |
| Delivery formatting | `apps/worker/src/delivery-adapters.ts` | Discord embed hard-codes Best Bets assumptions |

None of these can be fixed by adding a second parallel function. Each requires generalizing the existing path.

---

## Confirmed Eligibility Thresholds

The provisional thresholds from `docs/05_operations/trader_insights_graduation_criteria.md` are confirmed for this activation:

| Score Component | Required Minimum |
|---|---|
| Overall promotion score | ≥ 80.00 |
| `edge` component | ≥ 85 |
| `trust` component | ≥ 85 |
| Approval status | `approved` |
| Promotion target | `trader-insights` (explicit) |

A pick may qualify for `best-bets` (overall ≥ 70) without qualifying for `trader-insights` (overall ≥ 80, edge ≥ 85, trust ≥ 85). Promotion evaluation is **eager**: both policies are evaluated per submission regardless of `UNIT_TALK_DISTRIBUTION_TARGETS`, producing one `pick_promotion_history` row per policy. `picks.promotion_target` is singular and is set to the highest-priority qualified target. Priority order: trader-insights (higher bar) is evaluated first; a pick that qualifies for trader-insights routes only to trader-insights — best-bets routing does not trigger for that pick. A pick that does not qualify for trader-insights is evaluated for best-bets independently. *(A1 + A2 resolutions — 2026-03-20)*

---

## Phase 11A — Framework Generalization

**Owner: Codex**

**Gate**: 11B may not begin until 11A is complete and all tests pass.

### 11A Scope

#### 0. Schema migration — extend promotion_target CHECK constraints *(A9 — required before any DB writes)*

**File**: new `supabase/migrations/202603200007_promotion_target_multi.sql` (or next available sequence number)

The live schema has two CHECK constraints that block `'trader-insights'` from being stored:
- `picks_promotion_target_check`: `check (promotion_target is null or promotion_target in ('best-bets'))`
- `pick_promotion_history_target_check`: `check (target in ('best-bets'))`

Migration must extend both constraints to include `'trader-insights'`. Apply to live Supabase project and run `pnpm supabase:types` before any other 11A step that writes to the DB. `pnpm test:db` must pass after migration.

Note: `pick_promotion_history_override_action_check` currently allows `'force_promote'` and `'suppress_from_best_bets'`. If the override path needs a trader-insights-specific suppress action, extend this constraint in the same migration.

#### 1. Contracts — extend `PromotionTarget` and define `PromotionPolicy`

**File**: `packages/contracts/src/promotion.ts`

- Extend `promotionTargets` from `['best-bets']` to `['best-bets', 'trader-insights']`
- Define `PromotionPolicy` type:
  ```ts
  interface PromotionPolicy {
    target: PromotionTarget;
    minimumScore: number;
    minimumEdge: number;
    minimumTrust: number;
  }
  ```
- `PromotionTarget` union must be derivable from `promotionTargets` tuple

#### 2. Domain — generalize promotion evaluation and add trader-insights policy

**File**: `packages/domain/src/` (alongside `bestBetsPromotionPolicy`)

- Extract `evaluatePromotionEligibility(pick: CanonicalPick, policy: PromotionPolicy): PromotionEligibilityResult` as a pure function
  - Evaluates overall score, edge, trust against the supplied policy
  - Returns `{ qualified: boolean, target: PromotionTarget, score: number, reason?: string }`
- `bestBetsPromotionPolicy: PromotionPolicy = { target: 'best-bets', minimumScore: 70.00, minimumEdge: 0, minimumTrust: 0 }` — preserves existing behavior exactly
- `traderInsightsPromotionPolicy: PromotionPolicy = { target: 'trader-insights', minimumScore: 80.00, minimumEdge: 85, minimumTrust: 85 }`
- **Null/absent score handling** *(A3)*: when `policy.minimumEdge === 0` or `policy.minimumTrust === 0`, the component threshold is skipped entirely — absent or null component scores are treated as passing that threshold. This preserves the existing behavior of `bestBetsPromotionPolicy` for picks that do not supply edge/trust components.
- Existing behavior of `bestBetsPromotionPolicy` must be unchanged — no regressions

#### 3. Promotion service — generalize evaluation and submission wiring

**File**: `apps/api/src/promotion-service.ts`

- Replace `evaluateAndPersistBestBetsPromotion(pick, repos)` with `evaluateAndPersistPromotion(pick, policy, repos)` that works for any `PromotionPolicy`
- The submission path must evaluate **all configured promotion policies** per submission (eager evaluation — see §Confirmed Eligibility Thresholds). For Week 11A: both `bestBetsPromotionPolicy` and `traderInsightsPromotionPolicy`. Evaluation runs regardless of `UNIT_TALK_DISTRIBUTION_TARGETS`.
- Each evaluation produces one `pick_promotion_history` row (qualified or not_eligible)
- After all policies are evaluated, set `picks.promotion_target` to the highest-priority qualified target (trader-insights takes priority over best-bets). If no policy qualifies, `picks.promotion_target` remains `null`.
- `evaluateAndPersistBestBetsPromotion` may be kept as a thin wrapper calling `evaluateAndPersistPromotion(pick, bestBetsPromotionPolicy, repos)` for backward compatibility during the transition, but the underlying logic must be the generalized version
- Override path: operator override must accept `target: PromotionTarget` as a parameter — not hard-coded to `'best-bets'`

#### 4. Distribution service — generalize routing gate

**File**: `apps/api/src/distribution-service.ts`

- Replace `promotionTarget === 'best-bets'` check with `promotionTarget === requestedTarget` (or equivalent)
- Gate must work correctly for any `PromotionTarget` in `promotionTargets`
- Behavior for `discord:best-bets` must be identical to current behavior — no regression
- `discord:trader-insights` gate: blocks enqueue if pick is not `qualified` with `promotionTarget === 'trader-insights'`

#### 5. Delivery adapter — remove Best Bets-specific formatting

**File**: `apps/worker/src/delivery-adapters.ts` (Discord adapter)

- Discord embed must not hard-code Best Bets labels, headers, or assumptions
- **11A scope** *(A6)*: Remove Best Bets-specific hard-coding. The embed must not error and must not display a "Best Bets" label for `discord:trader-insights` picks. A placeholder label (e.g., target name) is acceptable for 11A. Existing best-bets embed output (label, color, footer) must be unchanged.
- **11B scope**: Trader-insights embed appearance (label, color, footer, copy) is defined in the 11B activation addendum before the canary preview run. Do not design trader-insights embed appearance in 11A.
- Behavior for existing best-bets deliveries must be unchanged

### 11A Required Tests

- `evaluatePromotionEligibility()` pure function:
  - eligible for best-bets (score ≥ 70) → qualified
  - ineligible for best-bets (score < 70) → not_eligible
  - eligible for trader-insights (score ≥ 80, edge ≥ 85, trust ≥ 85) → qualified
  - ineligible: score < 80 → not_eligible
  - ineligible: edge < 85 → not_eligible
  - ineligible: trust < 85 → not_eligible
  - best-bets with null/absent edge and trust components → qualified (threshold skipped when minimumEdge/minimumTrust = 0) *(A3 regression test)*
- Submission path evaluates both policies; both `pick_promotion_history` rows are written; `picks.promotion_target` set to highest-priority qualified target
- Routing gate: best-bets qualified pick (not trader-insights qualified) reaches `discord:best-bets`, does not reach `discord:trader-insights`
- Routing gate: trader-insights qualified pick reaches `discord:trader-insights`, does not reach `discord:best-bets`
- **Dual-qualification routing** *(A8)*: pick with overall ≥ 80, edge ≥ 85, trust ≥ 85 (qualifies for both thresholds) → `picks.promotion_target = 'trader-insights'`, routes only to `discord:trader-insights`, does NOT route to `discord:best-bets`
- Override accepts any `PromotionTarget`
- All 62 existing tests pass without modification

### 11A Close Criteria

| Criterion | Evidence |
|---|---|
| Schema migration applied: `picks_promotion_target_check` and `pick_promotion_history_target_check` allow `'trader-insights'` | Migration applied; `pnpm test:db` passes |
| `PromotionTarget` includes `'trader-insights'` | `packages/contracts/src/promotion.ts` |
| `PromotionPolicy` type defined | `packages/contracts/src/promotion.ts` |
| `traderInsightsPromotionPolicy` defined with confirmed thresholds | `packages/domain/src/` |
| `evaluatePromotionEligibility()` generalized pure function with correct null/absent score handling | `packages/domain/src/` |
| `evaluateAndPersistPromotion()` works for any policy | `apps/api/src/promotion-service.ts` |
| Submission path evaluates both policies (eager); two `pick_promotion_history` rows per submission | `apps/api/src/` |
| `picks.promotion_target` set to highest-priority qualified target | Code read + test |
| Routing gate handles any `PromotionTarget`; no literal `=== 'best-bets'` in gate | `apps/api/src/distribution-service.ts` |
| Override path accepts any `PromotionTarget` | `apps/api/src/promotion-service.ts` |
| Delivery adapter: no Best Bets-specific hard-coding; trader-insights pick does not error or show "Best Bets" label | `apps/worker/src/delivery-adapters.ts` |
| All existing tests pass (≥ 62) | `pnpm test` |
| New generalization tests pass including A3 null-score and A8 dual-qualification (≥ 8 new) | `pnpm test` |
| `pnpm test:db` passes (updated for two history rows per submission) | 1/1 |

---

## Phase 11B — Controlled Activation

**Owner: Codex + Human Approval**

**Gate**: 11A must be complete and all 11A close criteria confirmed. 11B is authorized once evidence-based proof passes — canary preview proof complete, real-channel proof complete, no regressions to canary or best-bets, operator visibility confirms correct state. No calendar gate.

### 11B Scope

#### 1. Operator-web — trader-insights channel health section

**File**: `apps/operator-web/src/server.ts`

- Add channel ID `1356613995175481405` to `outboxRowsToChannelId()` mapping
- Add `traderInsights: ChannelHealthSummary` to `OperatorSnapshot` interface
- `summarizeChannelLane()` covers `discord:trader-insights` symmetrically with canary and best-bets
- HTML dashboard renders a trader-insights health section (zero counts pre-activation is correct)
- Tests: zero-counts case, sent-count case

#### 2. Delivery config — wire trader-insights channel

- Wire channel `1356613995175481405` as the delivery target for `discord:trader-insights` in worker config/delivery routing

#### 3. Canary preview run

Before any real-channel activation:
- Temporarily map `discord:trader-insights` → canary channel `1296531122234327100`
- Submit one trader-insights-eligible pick (edge ≥ 85, trust ≥ 85, overall ≥ 80.00)
- Confirm: `evaluateAndPersistPromotion()` with trader-insights policy → `qualified`, target `trader-insights`
- Confirm: worker delivers → receipt channel `discord:1296531122234327100`, dryRun `false`
- Confirm: operator snapshot clean, canary and best-bets unaffected
- Capture all canary proof fields before proceeding

**Do not proceed to real-channel activation if any canary proof field is missing or shows unexpected state.**

#### 4. Real-channel activation + monitoring

Gate: canary preview proof must pass (§3 above) before proceeding here. No calendar gate.

- Add `discord:trader-insights` to `UNIT_TALK_DISTRIBUTION_TARGETS`
- One trader-insights-qualified pick delivered to channel `1356613995175481405`
- Receipt recorded: channel `discord:1356613995175481405`, dryRun `false`
- Full proof bundle captured
- Monitoring window: observe for one operating cycle (operator snapshot confirms no regressions, zero failed/dead-letter rows). This is a soft observation step, not a calendar-blocking condition.

### 11B Close Criteria

| Criterion | Evidence |
|---|---|
| Operator-web trader-insights section live | `traderInsights` in `OperatorSnapshot`, HTML renders, tests pass |
| Canary preview complete | Outbox sent, receipt channel = canary, dryRun false |
| Canary preview proof passed | All §2b proof fields filled, embed verified, no regressions |
| Real-channel activation complete | One pick delivered to `1356613995175481405` |
| Receipt recorded (real channel) | channel `discord:1356613995175481405`, dryRun `false`, message ID captured |
| Proof bundle complete | All fields in `docs/06_status/week_11_proof_template.md` filled |
| `pnpm test` passes | ≥ 70 tests |
| `pnpm test:db` passes | 1/1 |
| Zero failed/dead_letter rows | Live DB check |
| 24-hour monitoring window passed | No rollback trigger fired |
| Independent verification passed | All proof fields confirmed from live DB |

---

## Preconditions

All of the following must be true before 11A begins:

| Condition | Required State | Current State |
|---|---|---|
| Week 10 formally closed | Done | ✓ 2026-03-20 |
| `discord:canary` | Live and healthy | ✓ Permanent control lane |
| `discord:best-bets` | Live and stable | ✓ Week 7 monitoring complete |
| `pnpm test` | Passing (62/62) | ✓ Week 10 close |
| `pnpm test:db` | Passing (1/1) | ✓ Week 10 close |
| Operator-web `bestBets` section | Live and accurate | ✓ Week 10 delivered |
| Operator-web picks pipeline | Live and accurate | ✓ Week 10 delivered |
| `trader_insights_graduation_criteria.md` | Ratified | ✓ 2026-03-20 |
| Week 11 contract | Written and ratified | ✓ This document |

**All preconditions met. Week 11A is authorized to begin.**

11B preconditions are stated separately above and include the 11A gate.

---

## Phase 11B Activation Addendum

This section resolves blockers A4 and A6 identified in `docs/06_status/week_11a_closeout_checklist.md`. These resolutions are required before 11B begins. Runtime code is not changed by this addendum — the specifications below are ratifications of existing behavior or explicit config-layer procedures.

---

### A4 — Canary Preview Channel Mechanism

**Status**: RESOLVED 2026-03-20 (addendum).

The delivery adapter reads `UNIT_TALK_DISCORD_TARGET_MAP` (a JSON env var) to map named targets to Discord channel IDs. This existing mechanism is used for the canary preview — no new env vars, feature flags, or code changes are required.

#### Step-by-step: canary preview (11B Slice 3)

**Step 1 — Configure preview routing:**

Set `UNIT_TALK_DISCORD_TARGET_MAP` to route `discord:trader-insights` to the canary channel:

```
UNIT_TALK_DISCORD_TARGET_MAP={"discord:canary":"1296531122234327100","discord:best-bets":"1288613037539852329","discord:trader-insights":"1296531122234327100"}
```

This is the only config change needed for the preview. The worker resolves channel IDs at delivery time; no restart of the API is required.

**Step 2 — Add to distribution targets (preview only):**

```
UNIT_TALK_DISTRIBUTION_TARGETS=discord:canary,discord:best-bets,discord:trader-insights
```

**Step 3 — Submit one qualifying pick and run the canary proof.** See `docs/06_status/week_11_proof_template.md` §2b for all required proof fields.

**Step 4 — Advance to real-channel activation (after canary proof passes):**

Update `UNIT_TALK_DISCORD_TARGET_MAP` to route `discord:trader-insights` to the real channel:

```
UNIT_TALK_DISCORD_TARGET_MAP={"discord:canary":"1296531122234327100","discord:best-bets":"1288613037539852329","discord:trader-insights":"1356613995175481405"}
```

Distribution targets remain unchanged from Step 2. Worker will now deliver trader-insights picks to channel `1356613995175481405`.

#### Canary preview rollback (if preview fails)

Remove `discord:trader-insights` from `UNIT_TALK_DISTRIBUTION_TARGETS`:

```
UNIT_TALK_DISTRIBUTION_TARGETS=discord:canary,discord:best-bets
```

The `UNIT_TALK_DISCORD_TARGET_MAP` entry for `discord:trader-insights` is inert without the distribution target. No code changes. No outbox rows deleted.

#### Why this mechanism

`resolveDiscordChannelId` in `delivery-adapters.ts` checks the target map before falling back to parsing `discord:<channelId>` patterns. `discord:trader-insights` is a named target (not a channel ID), so the map entry is required for delivery. The canary preview and real-channel activation are purely config-layer operations — no code changes at any point.

---

### A6 — Trader Insights Embed Appearance

**Status**: RESOLVED 2026-03-20 (addendum).

The 11A implementation in `apps/worker/src/delivery-adapters.ts` (`buildTargetPresentation`) already implements a distinct trader-insights embed branch. This appearance is **ratified** as the 11B activation spec. No runtime changes are required before the canary preview.

#### Ratified embed spec

| Property | Approved value | Comparison to Best Bets |
|---|---|---|
| Title | `"Unit Talk V2 Trader Insight"` | Best Bets: `"Unit Talk V2 Best Bet"` |
| Color | `0x4f8cff` (blue) | Best Bets: `0xffd700` (gold) |
| Lead field name | `"Trader Insights Purpose"` | Best Bets: `"Best Bets Purpose"` |
| Lead field value | `"This lane is for sharper market-alerts signals: higher edge, higher trust, and cleaner timing than a general premium board."` | Best Bets: curated-picks description |
| Footer | `"Target: discord:trader-insights \| Market-alerts lane preview"` | Best Bets: `"...Curated lane preview"` |
| Description | Event metadata (`sport \| eventName`) or `"VIP market-alerts lane preview"` if absent | Best Bets: same pattern with different default copy |

#### Standard fields (identical across all targets)

| Field | Value |
|---|---|
| Market | Pick market string (required) |
| Pick | Selection + line + odds — formatted as `"Over 7.5 @ -115"` style (required) |
| Pick ID | Pick UUID, monospace (required) |
| Capper | Capper name, or `"Unit Talk"` if absent (optional) |
| Source | Source string, or `"Unit Talk"` if absent (optional) |
| State | Lifecycle state (optional) |

#### Verification at canary preview

Before signing off on the canary proof, confirm visually from the Discord message:
- Title does NOT contain the word "Bets"
- Color is blue (not gold)
- Lead field name is "Trader Insights Purpose"
- Footer identifies `discord:trader-insights`

These checks are included in `docs/06_status/week_11_proof_template.md` §2b.

---

## Non-Goals

The following are **explicitly out of scope** for Week 11:

- `discord:exclusive-insights` activation
- `discord:game-threads` live routing
- `discord:strategy-room` live routing
- Changing `discord:best-bets` promotion thresholds
- Changing `discord:best-bets` routing behavior
- Automated settlement feed
- New operator-web write surfaces
- Any new product surface not currently live
- Any additional promotion targets beyond `trader-insights`

Do not widen scope. Do not start 11B before 11A is complete.

---

## Rollback / Failure Conditions

### 11A rollback

If 11A implementation breaks existing behavior (any of the following), halt 11A and do not proceed to 11B:

- Any existing test regresses (`pnpm test` below 62)
- `pnpm test:db` fails
- `discord:best-bets` routing behavior changes
- A best-bets qualified pick fails to reach `discord:best-bets` outbox

Record in `docs/06_status/week_11_failure_rollback_template.md`.

### 11B rollback

Remove `discord:trader-insights` from `UNIT_TALK_DISTRIBUTION_TARGETS` immediately if any of the following occur:

- Any `discord:trader-insights` outbox row enters `dead_letter` unrecovered within 24 hours
- Worker health is `degraded` or `down` for > 4 consecutive hours with no recovery path
- A non-qualified pick reaches `discord:trader-insights`
- A pick is delivered to the wrong channel or wrong audience tier
- More than 2 consecutive delivery failures after activation

When triggered:
- Remove only `discord:trader-insights` from targets
- Keep `discord:canary` and `discord:best-bets` active and unchanged
- Do not delete outbox rows
- Record in `docs/06_status/week_11_failure_rollback_template.md`
- Record trigger condition in `docs/06_status/status_source_of_truth.md`

---

## Artifacts

| Purpose | File |
|---|---|
| Proof template | `docs/06_status/week_11_proof_template.md` |
| Failure / rollback template | `docs/06_status/week_11_failure_rollback_template.md` |

---

## Authority Links

| Purpose | File |
|---|---|
| Trader-insights graduation criteria | `docs/05_operations/trader_insights_graduation_criteria.md` |
| Week 9 readiness decision | `docs/05_operations/week_9_readiness_decision.md` |
| Week 10 contract | `docs/05_operations/week_10_operator_command_center_contract.md` |
| Week 7 activation reference | `docs/05_operations/week_7_best_bets_activation.md` |
| Discord routing policy | `docs/05_operations/discord_routing.md` |
| Program state | `docs/06_status/status_source_of_truth.md` |
