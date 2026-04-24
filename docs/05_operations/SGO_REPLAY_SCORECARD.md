# SGO Replay & Trust Scorecard

**Status:** Living document. Update after each hardening sprint or proof run.
**Owner:** Claude lane (UTV2-746). Codex delivers proof artifacts; Claude maintains this scorecard.
**Cross-reference:** `SGO_CONTRACT_HARDENING.md` (contract rules), `PROVIDER_KNOWLEDGE_BASE.md` (request semantics)
**Last updated:** 2026-04-24 / main SHA `c4b26b6`

---

## Current Snapshot

**Grading pass run:** ~2026-04-23T21:22Z (from UTV2-740 audit)

| Outcome | Count | % |
|---|---|---|
| Attempted | 326 | — |
| Graded | 0 | 0% |
| Skipped | 326 | 100% |

**Settlement is not yet flowing.** The dominant skip reason is `event_not_completed` — not a data or model failure. Events are pending finalized-results repoll. See §1 for per-bucket breakdown.

---

## 1. Grading Skip Reason Buckets

### Bucket A — Event Not Ready (286 / 87.7%)

| Reason | Count | Meaning |
|---|---|---|
| `event_not_completed` | 286 | `events.status` still `in_progress` or `scheduled` — finalized-results repoll has not yet run against these events |

**Current state:** Dominant bucket. This is a scheduling/repoll gap, not a data corruption problem. `mapSGOStatus()` correctly maps `finalized=true → 'completed'`, but the finalized-results ingest cycle hasn't been triggered for these events yet.

**Fix path:** UTV2-745 (Ready for Codex) — codify repoll rules and schedule a periodic finalized-results fetch for events that were ingested as `in_progress` but whose SGO upstream status has since moved to `finalized`.

### Bucket B — Identity Gap (40 / 12.3%)

| Reason | Count | Meaning |
|---|---|---|
| `missing_participant_id` | 40 | Pick has no `participant_id` — player alias not resolved |

**Current state:** Residual after UTV2-733 (PR #452) fixed the market-family join path for legacy totals. The 40 remaining skips are picks where the SGO player entity (`PLAYER_ID_NBA`) has no entry in `provider_entity_aliases`. This is a DB backfill gap, not a code path gap.

**Fix path:** UTV2-740 (Ready for Codex) — enforce participant-required rules per market family and backfill aliases for the remaining unresolved player IDs.

### Bucket C — Event Resolution (near zero, estimated)

| Reason | Meaning |
|---|---|
| `event_link_not_found` | Pick's event FK could not be resolved |
| `event_provenance_missing_external_id` | Event has no `external_id` for provider join |

**Current state:** Near-zero after UTV2-734 repaired the finalized-results ingest path and UTV2-719 standardized team `external_id` format. Not separately counted in current snapshot.

### Bucket D — Result Gap (unknown count)

| Reason | Meaning |
|---|---|
| `game_result_not_found` | No `game_results` row for event + market + participant |
| `game_result_retry_pending` | Result lookup failed, retry scheduled |
| `game_result_retry_scheduled` | Retry in progress |

**Current state:** Not separately counted in current snapshot. Will become visible once Bucket A is cleared (events marked completed). UTV2-737 (Ready for Codex) owns the auto-settle proof that will surface actual counts.

### Bucket E — Market Family (unknown count)

| Reason | Meaning |
|---|---|
| `selection_side_not_supported` | `inferSelectionSide()` cannot resolve side for this market |
| `grade_skipped_final` | Non-retriable skip after all resolution attempts |

**Current state:** Not separately counted. Residual from market families that lack full `inferSelectionSide` coverage. Not a volume blocker at current board size.

### Bucket F — Operational / Transient

| Reason | Meaning | Action |
|---|---|---|
| `already_claimed_by_another_process` | Concurrency guard fired | Transient — no action |
| `settlement_already_exists` | Pick already settled | Correct behavior — not a failure |

---

## 2. R5 Replay Skip Buckets

From `scripts/sgo-r5-clv-roi-replay.ts` skip counters. These apply to the shadow candidate universe, not posted picks.

| Bucket | Root Cause | Fixed? | Fix Issue |
|---|---|---|---|
| `missingEvent` | `market_universe.event_id` is null — no local event FK | Partial — Phase 3 deferred | materializer contract |
| `missingResult` | No `game_results` row for the event | Ingest path fixed (UTV2-734). Repoll gap remains. | UTV2-745 |
| `missingResultMarket` | `game_results` row exists but market key doesn't match | UTV2-726 hardened joins. Regression suite pending. | UTV2-742 |
| `missingResultParticipant` | `game_results` exists but participant join fails | UTV2-733 partial fix. 40 aliases still missing. | UTV2-740 |
| `no opening evidence` | `market_universe.opening_line` is null | Depends on `is_opening=true` row being ingested first | Live ingest behavior |
| `no closing evidence` | `market_universe.closing_line` is null | MLB now 88.1%, NBA 82.8%, NHL 16.0% after UTV2-738 | — |

**replayEligible count before hardening sprint:** 0 (as of UTV2-723 run, ~2026-04-22)
**replayEligible count after UTV2-734 + UTV2-733 + UTV2-738:** Not yet re-run. Expected to increase substantially once UTV2-745 clears the event-completion gap.

---

## 3. CLV Coverage

### 3.1 market_universe Coverage (post UTV2-738, 2026-04-23T13:52Z)

| Sport | Rows (72h window) | With closing_line | Coverage |
|---|---|---|---|
| MLB | 783 | 690 | **88.1%** |
| NBA | 192 | 159 | **82.8%** |
| NHL | 25 | 4 | **16.0%** |

NHL at 16.0% is low volume (playoff schedule, few posted picks), not a methodology gap.

### 3.2 CLV Methodology Status

| Path | Status |
|---|---|
| `findClosingLine()` DB query against `provider_offers` with `is_closing=true` | ✅ implemented |
| `listClosingOffers()` paginated with `.range()` | ✅ fixed UTV2-738 PR #451 |
| `is_closing` marking for pre-commence offers | ✅ operational |
| Historical open/close capture with `includeOpenCloseOdds=true` | ✅ fixed UTV2-721 |
| Pinnacle-specific closing line (`byBookmaker.pinnacle.closeOdds`) | ⚠️ not in standard live ingest — UTV2-744 |
| Consensus `openFairOdds` prohibited for CLV proof | ✅ policy lock §3.7 |

---

## 4. Provider Caveat Register

Known provider-level facts that must be respected by all implementation. Mark each as documented and/or enforced.

| Caveat | Documented | Enforced |
|---|---|---|
| `status.completed` unreliable — use `status.finalized` | ✅ PKB §1.7, entity-resolver.ts:219 | ✅ mapSGOStatus() |
| `odds.<oddID>.score` is the grading field — not `results.game` | ✅ PKB §1.7, results-resolver.ts header | ✅ |
| `scoringSupported=true` must be checked before using `score` | ✅ PKB §1.7 | ⚠️ UTV2-742 |
| `openFairOdds` is consensus, not Pinnacle — prohibited for CLV proof | ✅ PKB §3.7 policy lock | ✅ clv-service |
| Per-bookmaker `closeOdds` requires `includeOpenCloseOdds=true` | ✅ PKB §1.8 | ⚠️ UTV2-744 |
| Player `statEntityID` must be preserved as `providerParticipantId` — not collapsed to `all` | ✅ PKB §1.4, UTV2-731 matrix | ⚠️ UTV2-732 |
| Pagination: `nextCursor` from response; 404 = end of results | ✅ PKB §1.5 | ⚠️ UTV2-743 (centralizing) |
| PostgREST default cap: 1000 rows without explicit `.range()` | ✅ UTV2-738 post-mortem | ✅ listClosingOffers() |
| Rate limits: 50k req/hr, 300k objects/hr, 7M objects/day | ✅ PKB §1.2 | monitoring only |
| `notice` field in response signals plan-limit truncation | ✅ PKB §1.5 | ⚠️ not yet monitored |

---

## 5. Gaps: Fixed vs. Still Open

### Fixed (merged to main)

| Gap | Fixed by | PR / SHA |
|---|---|---|
| `status.completed` unreliable completion gate | UTV2-734 | PR #448 |
| `results.game` used for grading instead of `oddID.score` | UTV2-726 | `c9a58a0` |
| MLB `closing_line = 0` — materializer DESC cap excluded closing rows | UTV2-738 | PR #449 |
| `listClosingOffers()` PostgREST 1000-row cap | UTV2-738 | PR #451 |
| Historical open/close odds not captured | UTV2-721 | `924c9f2` |
| Moneyline CLV side inference broken | UTV2-715 | PR #442 |
| Player prop CLV missing `participant_id` | UTV2-716 | — |
| Legacy totals picks skipping grading (market key join) | UTV2-733 | PR #452 |
| Finalized results ingest path broken — events never promoted to `completed` | UTV2-734 | PR #448 |
| SGO raw market key format mismatch in `game_results` lookup | UTV2-664 | PR #408 |

### Still Open

| Gap | Blocker | Issue | Priority |
|---|---|---|---|
| Events finalized upstream but still `in_progress` locally — no repoll | UTV2-745 | ✅ Done PR #454 | T1 |
| Centralized SGO request contract module | UTV2-743 | ✅ Done PR #453 | T1 |
| Remaining 40 `missing_participant_id` skips — player alias gap | UTV2-740 | Ready for Codex | T1 |
| Participant-aware market aliasing in materializer | UTV2-732 | Codex lane active | T1 |
| `scoringSupported` enforcement as hard gate | UTV2-742 | Ready for Codex | T1 |
| `includeOpenCloseOdds=true` always in historical ingest | UTV2-744 | Ready for Codex | T1 |
| R5 replay CLV ROI proof with unsupported-market accounting | UTV2-736 | Blocked Internal (needs Codex data) | T2 |
| `event_id` FK resolution in `market_universe` | materializer Phase 3 | deferred | — |

---

## 6. Issue-State Bookkeeping

Corrections and notes that keep the board aligned with what actually merged.

### UTV2-733 (Done, PR #452) — Scope Clarification

**Originally scoped as:** "backfill provider participant aliases for replay joins."
**Actual delivery:** Fixed market-key join path in `grading-service.ts` for legacy game-total market family. Added `market-key.ts` normalizer and `pick-foreign-keys.ts` coverage.
**What it did not do:** Backfill player-level `provider_entity_aliases` rows for unresolved player IDs.
**Evidence:** 40 `missing_participant_id` skips remain in UTV2-740 audit after this PR.
**Action:** No status correction needed — UTV2-740 correctly captures the residual scope. Note this distinction when reading UTV2-733 as Done.

### UTV2-737 (Ready for Codex) — Dependency Update

**Depends on:** UTV2-731 ✅ Done, UTV2-733 ✅ Done, UTV2-734 ✅ Done. **UTV2-732 not started.**
**Do not start UTV2-737 before UTV2-732** — participant-aware market aliasing is required before the auto-settle proof can produce trustworthy grading counts.

### UTV2-729 (Blocked Internal) — Unblock Path

Blocked on `replayEligible = 0`. That was caused by two compound failures: participant identity joins null (UTV2-733 ✅ partial) + event completion not propagating (UTV2-745 ⚠️ not started). Full unblock path: **UTV2-732 → UTV2-745 → UTV2-737 → re-run replay**.

### UTV2-723 (Blocked Internal) — Same as UTV2-729

Same compound failures. Will unblock on the same path.

### UTV2-738 (Done) — Now Archived in SGO Contract Hardening Project

Merged PRs #449 and #451. Live proof confirmed: MLB closing_line 0 → 690 rows (88.1%). Both the materializer closing-offer exclusion and the PostgREST 1000-row cap are now rules in `SGO_CONTRACT_HARDENING.md §5` (change log entries) and §1.5 (pagination contract).

### UTV2-734 (Done, PR #448) — Scope vs. Remaining Gap

UTV2-734 fixed the **ingest path** for finalized results — `extractEventResult()` now correctly gates on `status.finalized` and `mapSGOStatus()` maps that to `'completed'`. What it did not add is a **scheduled repoll** that runs against events already in the DB that are still `in_progress`. That scheduling gap is UTV2-745.
