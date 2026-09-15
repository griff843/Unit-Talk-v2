# T1 Production Readiness Contract — first live measurement

**Measured at:** `2026-09-14 13:47:21.158824+00` (single `now()` from the database, used for every window)
**Target:** production `zfzdnfwdarxucxtaojxm`, read-only. No writes, no containment change, no SGO call,
no provider key read, no deploy, no delivery change.
**Authority:** `docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md` §3 thresholds, §5.2 bundle shape.
**Why this exists:** the contract's own §4 status table dates to **2026-04-15 / 04-30** and carries three
UNKNOWNs. `spec.md` states live evidence overrides every snapshot. Until now nobody had run §5.3.

## Verdict

| Dim | Name | Verdict | Binding metric |
|---|---|---|---|
| 1 | Runtime Health | **FAIL** | worker uptime 0% (≥99%); 35 outbox rows stuck 45.7d (0) |
| 2 | Score Provenance | **FAIL** | market-backed 0.00% (≥20%) |
| 3 | Settlement / CLV | **UNKNOWN** | 0 settlements in window — thresholds not demonstrable |
| 4 | Routing Trust | **UNKNOWN** | 0 top-tier picks in window — empty denominator |
| 5 | Operator Surfaces | **FAIL** | all 5 surfaces built, none deployed |
| 6 | Performance Evidence | **FAIL** | 0 settled picks (≥100 required) |

**`overall_pass: false`.** §5.2 requires all six `threshold_pass` values true. Four are false and two
cannot be asserted. **UNKNOWN blocks the gate exactly as FAIL does** — the bundle cannot claim a
threshold it did not demonstrate.

---

## Dimension 1 — Runtime Health → **FAIL**

| Metric | Threshold | Measured | Verdict |
|---|---|---|---|
| Worker uptime, 7d | ≥ 99.0% | **0%** — 0 `worker.heartbeat` rows in 7d; last is `2026-08-17 00:49:50Z`, **28.5 days** stale | **FAIL** |
| Outbox queue depth stuck > 10 min | 0 | **35** (32 `processing`, 3 `pending`), oldest `2026-07-30 17:55:09Z` — **45.8 days** | **FAIL** |
| Outbox delivery success rate, 7d | ≥ 99.0% of attempted | 0 attempted deliveries in 7d; newest receipt `2026-07-30 20:01:24Z` | **UNKNOWN** (empty denominator) |
| Pipeline latency submit→grade, 7d | ≤ 15 min for ≥95% | 3 picks created in 7d, **0 graded** | **UNKNOWN** |
| API p99 latency (submission) | ≤ 2000 ms, ≥100 req | **not instrumented** | **UNKNOWN** |
| API p99 latency (pick detail) | ≤ 1500 ms, ≥100 req | **not instrumented** | **UNKNOWN** |
| Circuit breaker trips unresolved | 0 | **no breaker-state table** | **UNKNOWN** |

**Two findings worth separating from the verdict.**

1. The 35 stuck rows are **not live delivery failures**. Every one targets a UTV2-1497 canary
   (`utv2-1497-canary-*` ×32, `discord:canary` ×3) written on 2026-07-30. They are test-harness
   residue. The metric is nonetheless written as an absolute snapshot count and it is not met.
   **Clearing them is production data modification — reserved decision 1 — and is not requested.**
2. **Three of the seven metrics cannot be measured at all.** Enumerating all 61 production tables:
   there is no API-latency table and no circuit-breaker-state table. `model_health_snapshots` is
   about models, not request latency. So Dimension 1 cannot reach PASS today even with a running
   worker — the instrumentation its evidence block requires does not exist. That is a build item
   nobody has recorded.

## Dimension 2 — Score Provenance → **FAIL**

30-day window. Edge source resolved by `SCORE_PROVENANCE_STANDARD.md` §resolution order:
`metadata.domainAnalysis.realEdgeSource` → `metadata.realEdgeSource` → `metadata.edgeSource` → `unknown`.

| Metric | Threshold | Measured | Verdict |
|---|---|---|---|
| Market-backed share (`real-edge` + `consensus-edge`) | ≥ 20% | **0.00%** (0 of 3) | **FAIL** |
| Unknown share | ≤ 60% | 0.00% (0 of 3) | pass |
| Any edge attribution | ≥ 40% | 100.00% (3 of 3) | pass |

Distribution, 30 days: **`{sgo: 3}`** — total population **3 picks**.

**The standard is explicit** (§line 34): *"`real-edge` and `consensus-edge` are market-backed. All
others are not."* `sgo` is not in that set — the standard's own baseline records "22 `sgo-edge`,
819 `unknown`, **0 `real-edge`, 0 `consensus-edge`**". Zero picks have ever carried a market-backed
source.

**This is where the measurement changes something.** All three `sgo` attributions are the exact
defect #1576 repairs — an edge borrowed from an offer belonging to a different sport, event,
participant and week. A naive reading of the top-level field alone would report **100% market-backed
and a PASS on Dimension 2**, built entirely on fabricated provenance. The repair does not change the
verdict; it makes the 0% honest rather than accidental. After deploy and correction these become
`confidence-delta`, which is also not market-backed.

## Dimension 3 — Settlement / CLV → **UNKNOWN**

| Metric | Threshold | Measured (30d) | Verdict |
|---|---|---|---|
| Automated settlement share | ≥ 85% of graded | **0 settlements in window** | **UNKNOWN** |
| CLV resolved at close | ≥ 60% of settled | **0** `closing_for_clv` snapshots in window | **UNKNOWN** |
| Manual grading backlog | ≤ 5% ungraded > 48h | 3 unsettled picks; none carries an event link, so "48h after game end" is underived | **UNKNOWN** |
| Settlement error rate | ≤ 2% corrected | 0 corrections in window | **UNKNOWN** |

All four windows are empty: newest settlement anywhere is `2026-07-30 20:14:55Z`.

**All-time context, out of window and not a substitute for it** — recorded because the direction is
unfavourable and a future in-window measurement should not come as a surprise:

- settlement sources: `{grading: 10380, operator: 27116}` → **27.68% automated** against a ≥85% bar
- corrections: 3,443 against 37,496 settlements → **9.18%** against a ≤2% bar
- `pick_offer_snapshots`: 193 rows total, of which 177 are `closing_for_clv` — the CLV proof
  mechanism §3 requires **exists and is populated**, just not recently

## Dimension 4 — Routing Trust → **UNKNOWN**

| Metric | Threshold | Measured (30d) | Verdict |
|---|---|---|---|
| Top-tier picks with market-backed edge | ≥ 30% | **0 top-tier picks exist** — empty denominator | **UNKNOWN** |
| Suppression always explicit | 100% | 0 suppressed picks; 0 lacking a reason | vacuous pass |

All 3 picks in the window carry `promotion_target = best-bets`, `promotion_status = qualified`.
The contract states Dimension 4 closes only after Dimension 2, and Dimension 2 is FAIL — so this
cannot reach PASS regardless of sample.

**Carried forward:** all three picks are `qualified` to `best-bets`. `plan.md` records the
force-promote past `best-bets-v2`'s own `minimumScore: 70` for pick 1; this measurement confirms the
same shape on **all three**, not just the pilot pick.

## Dimension 5 — Operator Decision Support → **FAIL**

All five required surfaces exist as built pages in `apps/command-center/src/app`:
`picks` + `picks-list`, `held`, `review`, `settlement`, plus a pick detail route.

**None is deployed.** Measured against `deploy/production/docker-compose.yml`: the production stack
is `api`, `worker`, `ingestor`, `discord-bot`, `grading-cron`, `loki`, `grafana`, `web`,
`smart-form`, `caddy` — **no command-center service** — and `deploy/production/Caddyfile` carries
**no command-center route**.

An operator cannot reach any of the five surfaces in production. The placeholder-violation audit the
contract requires (≥10 picks per status type across 5 surfaces) is therefore **UNKNOWN and
unrunnable**, and reachability itself is a definite FAIL.

## Dimension 6 — Performance Evidence → **FAIL**

| Metric | Threshold | Measured (30d) | Verdict |
|---|---|---|---|
| Settled pick sample, automated grading | **≥ 100** | **0** | **FAIL** |
| Calibration gap | ≤ 0.15 | not computable at n=0 | **UNKNOWN** |
| CLV+ rate | ≥ 48% | not computable — 0 CLV snapshots in window | **UNKNOWN** |
| Top-tier picks with `edge < 0` and `edgeSource != unknown` | 0 | 0 (vacuous — no top-tier picks) | vacuous pass |

This is the only dimension with an unambiguous numeric shortfall rather than an empty window:
0 < 100 fails as written. §6 forbids satisfying it by backfill or simulation — live picks only.

---

## What this measurement changes

1. **Dimension 2 would have read PASS on fabricated data.** Reading `metadata.realEdgeSource`
   without applying the standard's vocabulary yields "100% market-backed". Applying it yields 0%.
   The repair now merged is what makes the honest number reproducible.
2. **Three Dimension 1 metrics have no instrumentation at all.** Not "not yet measured" — there is
   no table to measure. Contract-required evidence that cannot be produced by any query is a build
   item, and it was not on any list.
3. **Dimension 6 sets a calendar floor.** ≥100 settled live picks over a 30-day window cannot start
   accruing until a results supply exists. It is the longest item on the path and no engineering
   compresses it.
4. **Four of six dimensions are gated by things already reserved**, and none by missing code:
   Dim 1 and Dim 2 on containment (decision 6) — the contract's own minimum path step 4 reads
   *"Run 30 days with `SYNDICATE_MACHINE_ENABLED=true`"*; Dim 3 and Dim 6 on the results supply
   (decision 4, possibly 3); Dim 5 on deploying the Command Center. **No containment change is
   requested by this measurement.**

## Method note

Every figure above came from a single read-only session against `zfzdnfwdarxucxtaojxm` at the stated
instant, with real column names read from `packages/db/src/database.types.ts` before each query.
Two queries were rejected for guessed column names (`distribution_receipts.created_at`) and rewritten
against the generated types rather than retried. Nothing was written.
