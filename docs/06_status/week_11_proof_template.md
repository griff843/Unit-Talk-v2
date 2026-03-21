# Week 11 - Proof Template

Authority: `docs/05_operations/week_11_trader_insights_activation.md`

Two-phase template: complete Part 1 (11A verification) before starting Part 2 (11B activation proof).

---

## Metadata

| Field | Value |
|---|---|
| Week | 11 |
| Recorded by | Codex |
| Last updated | 2026-03-21 |

---

## Part 1 - Phase 11A: Framework Generalization Verification

**11A is COMPLETE - 2026-03-20.** All checks confirmed. See `docs/06_status/week_11a_closeout_checklist.md` for full evidence.

### 1a. Contracts

| Check | File | Pass? |
|---|---|---|
| `promotionTargets` includes `'trader-insights'` | `packages/contracts/src/promotion.ts` | **PASS** |
| `PromotionPolicy` type is defined and exported | `packages/contracts/src/promotion.ts` | **PASS** |

### 1b. Domain

| Check | File | Pass? |
|---|---|---|
| `evaluatePromotionEligibility(pick, policy)` pure function exists | `packages/domain/src/` | **PASS** |
| `bestBetsPromotionPolicy` still defined with `minimumScore: 70.00` | `packages/domain/src/` | **PASS** |
| `traderInsightsPromotionPolicy` defined: score >= 80.00, edge >= 85, trust >= 85 | `packages/domain/src/` | **PASS** |

### 1c. Promotion service

| Check | File | Pass? |
|---|---|---|
| `evaluateAllPoliciesEagerAndPersist()` evaluates both policies at submission time | `apps/api/src/promotion-service.ts` | **PASS** |
| Submission path evaluates both best-bets and trader-insights policies per submission | `apps/api/src/submission-service.ts` | **PASS** |
| Override path accepts `target: PromotionTarget` | `apps/api/src/promotion-service.ts` | **PASS** |

### 1d. Distribution service

| Check | File | Pass? |
|---|---|---|
| Routing gate uses `pick.promotionTarget !== requestedTarget` | `apps/api/src/distribution-service.ts` | **PASS** |
| `discord:best-bets` routing behavior unchanged | Regression tests | **PASS** |
| `discord:trader-insights` gate blocks non-qualified picks | Unit tests | **PASS** |

### 1e. Delivery adapter

| Check | File | Pass? |
|---|---|---|
| Discord embed dispatches on target with a distinct trader-insights branch | `apps/worker/src/delivery-adapters.ts` | **PASS** |
| Existing best-bets embed output unchanged | Regression tests | **PASS** |
| Trader-insights embed has no "Best Bets" label and does not error | Tests + code review | **PASS** |

### 1f. Test results

| Check | Required | Observed |
|---|---|---|
| `pnpm test` | >= 62 existing + >= 8 new = >= 70 | **72/72** |
| `pnpm test:db` | 1/1 | passes (schema 007 applied) |
| Any regression in best-bets tests? | No | **none** |

### 11A Verdict

```
[x] PASS - all 1a-1f checks confirmed, no regressions, 72/72 tests pass (2026-03-20)
[ ] FAIL - see week_11_failure_rollback_template.md (11A section)
```

Recorded by: Claude (Codex)
Date: 2026-03-20

**11A verdict is PASS. 11B may proceed once pre-activation system state (Section 2a) is confirmed. No calendar gate.**

---

## Part 2 - Phase 11B: Controlled Activation Proof

Complete only after Part 1 verdict is PASS. No calendar gate - 11B is authorized once evidence-based proof passes.

### 2a. Pre-activation system state

Confirm immediately before canary preview.

| Check | Required | Observed | Pass? |
|---|---|---|---|
| `discord:canary` operator state | healthy, recentSentCount >= 1 | healthy, `recentSentCount = 3` | **PASS** |
| `discord:best-bets` operator state | healthy, recentSentCount >= 1 | healthy, `recentSentCount = 3` | **PASS** |
| Failed outbox rows (all targets) | 0 | `0` | **PASS** |
| Dead-letter outbox rows (all targets) | 0 | `0` | **PASS** |
| `pnpm test` | pass | `72/72` | **PASS** |
| `pnpm test:db` | pass | `1/1` | **PASS** |
| 11A close criteria all confirmed | yes | yes | **PASS** |

### 2b. Canary preview run

`discord:trader-insights` routed to canary channel `1296531122234327100` via `UNIT_TALK_DISCORD_TARGET_MAP`.

**Pre-preview config verification:**

| Config | Required value | Confirmed? |
|---|---|---|
| `UNIT_TALK_DISCORD_TARGET_MAP` includes `"discord:trader-insights":"1296531122234327100"` | Yes | **YES** |
| `UNIT_TALK_DISTRIBUTION_TARGETS` includes `discord:trader-insights` | Yes | **YES** |
| `discord:canary` and `discord:best-bets` entries in target map unchanged | Yes | **YES** |

**Promotion and delivery proof fields:**

| Field | Required | Observed |
|---|---|---|
| Submission ID | required | `3bfc5d68-c588-4b59-a2a7-633207cb27a4` |
| Pick ID | required | `c231aff2-91a7-4633-ad35-61afb6ec88b6` |
| Approval status | `approved` | `approved` |
| Promotion history ID (trader-insights) | required | `36bdb5d3-a0db-47ff-a4d8-506b0930bf98` |
| Promotion status | `qualified` | `qualified` |
| Promotion target | `trader-insights` | `trader-insights` |
| Promotion score | >= 80.00 | `90.20` |
| `edge` score | >= 85 | `91` |
| `trust` score | >= 85 | `89` |
| Outbox ID | required | `61d4b4a3-49fa-4b6f-881d-d0bc9133ae06` |
| Outbox target | `discord:trader-insights` | `discord:trader-insights` |
| Outbox status | `sent` | `sent` |
| Receipt ID | required | `aafc482d-c183-48a9-8c13-4256fb2e8b5f` |
| Receipt channel | `discord:1296531122234327100` | `discord:1296531122234327100` |
| dryRun | `false` | `false` |
| Discord message ID (canary) | required | `1484772686579241187` |

**Embed appearance verification (visual from Discord):**

| Check | Required | Confirmed? |
|---|---|---|
| Title does NOT contain "Bets" | yes | **YES** |
| Title contains "Trader Insight" | yes | **YES** |
| Color is blue (not gold) | yes | **YES** (`5213439` / `0x4f8cff`) |
| Lead field name is "Trader Insights Purpose" | yes | **YES** |
| Footer contains `discord:trader-insights` | yes | **YES** |
| No error or blank embed | yes | **YES** |

**System state after preview:**

| Check | Required | Observed |
|---|---|---|
| Operator: canary/best-bets unaffected? | yes | yes - canary `recentSentCount = 3`, best-bets `recentSentCount = 3` |
| Failed/dead-letter rows after preview | 0 | `0` |

**Canary preview verdict:**
```
[x] PASS - all fields confirmed, embed verified, proceed to real-channel activation
[ ] FAIL - stop, use failure/rollback template (Part 2, canary preview section)
```

### 2c. Real-channel activation

`discord:trader-insights` in `UNIT_TALK_DISTRIBUTION_TARGETS`, target map updated to channel `1356613995175481405`.

**Pre-activation config verification:**

| Config | Required value | Confirmed? |
|---|---|---|
| `UNIT_TALK_DISCORD_TARGET_MAP` includes `"discord:trader-insights":"1356613995175481405"` | Yes | **YES** |
| `UNIT_TALK_DISTRIBUTION_TARGETS` includes `discord:trader-insights` | Yes | **YES** |

**Proof fields:**

| Field | Required | Observed |
|---|---|---|
| Submission ID | required | `1a8d2021-1cfe-42d8-a183-f367e1e0cf82` |
| Pick ID | required | `eb12a6c2-0221-44f9-acea-58d684a29fd3` |
| Approval status | `approved` | `approved` |
| Promotion history ID (trader-insights) | required | `1987c936-4233-410b-b48c-592e05933ea4` |
| Promotion status | `qualified` | `qualified` |
| Promotion target | `trader-insights` | `trader-insights` |
| Promotion score | >= 80.00 | `92.55` |
| Outbox ID | required | `970e688d-897a-4afd-8bde-7bff87396bcd` |
| Outbox target | `discord:trader-insights` | `discord:trader-insights` |
| Outbox status | `sent` | `sent` |
| Receipt ID | required | `d0a5b55a-d7f4-4823-a0dd-cb77747c195f` |
| Receipt channel | `discord:1356613995175481405` | `discord:1356613995175481405` |
| dryRun | `false` | `false` |
| Discord message ID (real channel) | required | `1484773505709904043` |
| Pick lifecycle state | `posted` | `posted` |

### 2d. Lifecycle events (real-channel run)

| State | Lifecycle event ID |
|---|---|
| `validated` | `184394c2-d4a0-425e-bc35-0db0bdd549b9` |
| `queued` | `532b9577-437c-4310-b8cb-77723c245e8a` |
| `posted` | `f68393f8-a1a8-44ca-9640-d0571f88f0bd` |

### 2e. Audit entries (real-channel run)

| Event | Entity ID | Entity ref (pick ID) | Audit ID |
|---|---|---|---|
| `promotion.qualified` (trader-insights) | `1987c936-4233-410b-b48c-592e05933ea4` | `eb12a6c2-0221-44f9-acea-58d684a29fd3` | `fd8879b4-7d76-4638-a91c-2bda79c02382` |
| `promotion.qualified` (best-bets, dual-eval) | `a8ed8078-d1d1-4d77-97ad-d13ce0cb56c5` | `eb12a6c2-0221-44f9-acea-58d684a29fd3` | `0c711f93-232d-4d5b-9546-34e90ca46673` |
| `distribution.sent` | `970e688d-897a-4afd-8bde-7bff87396bcd` | `null` (worker does not write entity_ref on distribution.sent — consistent with prior weeks) | `b763d5a5-414a-49b2-af27-ba51786ee0cf` |

Note: Pick `eb12a6c2` qualified for both trader-insights (score 92.55, edge 94, trust 91) and best-bets (score ≥ 70). Eager dual-policy evaluation produced two `promotion.qualified` audit rows — one per policy. `picks.promotion_target = 'trader-insights'` (higher-priority target). The original proof template captured the best-bets audit ID for the trader-insights row. Corrected by independent verification 2026-03-21.

### 2f. Operator state after real-channel activation

| Check | Required | Observed | Pass? |
|---|---|---|---|
| `traderInsights.recentSentCount` | >= 1 | `2` (direct DB count on `distribution_outbox`) | **PASS** |
| `traderInsights.recentFailureCount` | 0 | `0` | **PASS** |
| `discord:canary` - any change? | none | none - `recentSentCount` remains `3` | **PASS** |
| `discord:best-bets` - any change? | none | none - `recentSentCount` remains `3` | **PASS** |
| Failed outbox rows (all targets) | 0 | `0` | **PASS** |
| Dead-letter outbox rows (all targets) | 0 | `0` | **PASS** |

### 2g. Prior artifact immutability

| Artifact | ID | Status at closeout | Changed? |
|---|---|---|---|
| Week 7 best-bets outbox | `4d9db6ed` | `sent` | `no` |
| Week 9 settlement record | `894f4872` | `settled`, result `win` | `no` |

### 2h. Post-activation tests

| Check | Required | Observed |
|---|---|---|
| `pnpm test` | >= 70 | `72/72` |
| `pnpm test:db` | 1/1 | `1/1` |

### 2i. Monitoring observation (soft - not a blocking gate)

Observe for one operating cycle after real-channel activation. This step is informational; a clean observation confirms stability but is not a blocking condition for closeout.

| Field | Value |
|---|---|
| Observation opened | `2026-03-21T04:39:48Z` |
| Rollback trigger fired? | `no` |
| Worker health | `healthy` |
| Dead-letter rows during observation | `0` |
| Operator snapshot confirms no regressions | `yes` |
| Monitoring verdict | `clean one-cycle observation` |

### 2j. Independent verification

| Check | Method | Result |
|---|---|---|
| Outbox: `target=discord:trader-insights`, `status=sent` | Direct Supabase query | **PASS** |
| Receipt: `channel=discord:1356613995175481405`, `dryRun=false` | Direct Supabase query | **PASS** |
| Promotion history: `qualified`, `trader-insights` | Direct Supabase query | **PASS** |
| Lifecycle chain: `validated -> queued -> posted` | Direct Supabase query | **PASS** |
| Audit `distribution.sent` entity_id = outbox ID | Direct Supabase query | **PASS** |
| Zero failed/dead_letter rows | Direct Supabase query | **PASS** |
| Prior artifacts unmodified | Direct Supabase query | **PASS** |

---

## Overall Proof Verdict

```
[x] PASS - 11A verified, 11B all fields confirmed, one-cycle observation clean, no rollback trigger
[ ] FAIL - see week_11_failure_rollback_template.md
[ ] INCOMPLETE
```

Independent verification completed by: Claude (verification lane)
Date: 2026-03-21

**Verification notes:**
- §2e audit table corrected: proof template had best-bets and trader-insights `promotion.qualified` audit IDs swapped (non-blocking; dual-policy evaluation correctly produced both rows, pick correctly routed to trader-insights only)
- `distribution.sent` entity_ref confirmed as `null` in DB — consistent with worker behavior from all prior weeks
- All substantive runtime facts verified from live Supabase (service_role_key queries)
- Zero failed/dead_letter rows confirmed
- Prior artifacts (Week 7 best-bets outbox `4d9db6ed`, Week 9 settlement `894f4872`) confirmed unmodified
