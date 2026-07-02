# UTV2-1382: Scoring Validation Audit

Validation-only audit. No scoring logic was changed. Run after UTV2-1380 (Kelly
sizing wiring), UTV2-1379/UTV2-1395 (domainAnalysis / confidence-delta fallback
fix), and UTV2-1394 (testRun-excluded measurement) all closed.

- **Window:** last 30 days (`2026-06-02` → `2026-07-02`)
- **Denominator:** `public.picks`, excluding non-production `source` values
  (`api`, `test`, `proof`, `t1-proof`, `synthetic`, `canary-proof`) and
  test/proof fixture rows (see Finding 1 below)
- **Tool:** `scripts/audits/utv2-1382-scoring-validation.ts` (read-only,
  reusable — `pnpm exec tsx scripts/audits/utv2-1382-scoring-validation.ts --days 30`)
- **Raw output:** `docs/06_status/proof/UTV2-1382/scoring-validation-summary.json`

## Verdict: **PARTIAL**

The scoring measured on the surviving genuine-production sample is healthy and
shows no leakage. The verdict is PARTIAL — not PASS — because 3 of 5 active
pick sources have **zero** measurable production data in this window (Finding
2); the audit cannot make any claim about scoring correctness for those
sources, and `top_promoted_sanity_check` is empty because no clean production
pick was promoted in the window at all (Finding 3).

```
verdict_reasons:
  - "sources with 0 clean production picks in this window (100% test/proof
     fixtures): alert-agent, model-driven, smart-form — cannot be validated"
```

---

## 1. Band distribution

**Overall** (2,258 clean production picks):

| band | count | pct |
|---|---|---|
| SUPPRESS | 2,219 | 98.3% |
| none (metadata.band absent) | 39 | 1.7% |
| A+ / A / B / C | 0 | 0% |

**By sport:**

| sport | none | SUPPRESS |
|---|---|---|
| MLB | 36 | 2,074 |
| NBA | 3 | 131 |
| NHL | 0 | 14 |

**By source** (only sources with clean data — see Finding 2):

| source | none | SUPPRESS |
|---|---|---|
| board-construction | 25 | 440 |
| system-pick-scanner | 14 | 1,779 |

**By market family:**

| market family | none | SUPPRESS |
|---|---|---|
| game-line | 1 | 56 |
| unknown (unclassified market key) | 38 | 2,163 |

Note: `classifyMarketFamily()` only resolves `game-line` for the picks in this
sample — the vast majority of `picks.market` values (e.g. `game_total_ou`,
`nba-spread`) do not match any of the family-classifier's known key patterns
and fall through to `unknown`. This is a market-key-normalization gap, not a
scoring gap — see Finding 4.

## 2. edgeSourceQuality distribution (testRun + proof-fixture excluded)

| edgeSourceQuality | count | pct |
|---|---|---|
| market-backed | 1,556 | 68.91% |
| explicit | 465 | 20.59% |
| confidence-fallback | 237 | 10.5% |

By source: `board-construction` is 100% `explicit` (465/465); `system-pick-scanner`
is 86.9% `market-backed` (1,556/1,793) and 13.1% `confidence-fallback`
(237/1,793).

This is a strong positive signal: on the corrected denominator, only 10.5% of
genuine production picks still fall back to confidence-delta, versus 79.7%
measured before the fixture-contamination fix in this same audit run (see
Finding 1) — consistent with UTV2-1379/1395 doing their job on real traffic.

## 3. Kelly sizing distribution

| metric | value |
|---|---|
| picks carrying `metadata.kellySizing` | 1,955 / 2,258 (86.6%) |
| `fractional_kelly` min / max / mean | 0 / 0.0782 / 0.0011 |
| `fractional_kelly == 0` | 1,865 / 1,955 (95.4%) |

95.4% of picks that carry Kelly data compute a zero fractional Kelly (no
positive EV at the offered price under `risk-v1`). This is the single largest
driver of the current suppression rate — "Kelly fraction is 0 ... (risk-v1)"
appears in 1,826 of 2,228 suppress reasons (Section 5). This looks like the
Kelly gate doing exactly what UTV2-1380 wired it to do; whether that gate is
*too* strict is a threshold question, out of scope for this audit (see
Constraints).

## 4. Fallback reason distribution

100% of the 2,258 clean production picks classify as `domain-analysis`
(real edge present, either as `domainAnalysis.realEdge` or top-level
`metadata.realEdge`). Zero `no-confidence`, `no-provider-offer`,
`no-market-key`, `no-participant-scope`, `computation-error`, or
`unknown-legacy` rows in the clean sample. Combined with Section 2, this
indicates the domain-analysis pipeline is populating real edge data for
essentially all genuine traffic in the two currently-measurable sources.

## 5. Suppress / reject reason counts

2,228 of 2,258 clean picks (98.7%) are suppressed. Reason strings are
pipe-joined (multiple simultaneous suppression causes per pick):

| reason (joined) | count |
|---|---|
| `pick is outside the posting window \| Kelly fraction is 0 ... \| board cap for the slate has been reached` | 782 |
| `Kelly fraction is 0 ... \| board cap for the slate has been reached` | 487 |
| `Kelly fraction is 0 ... \| board cap for the slate has been reached \| pick confidence is below the best-bets floor` | 258 |
| `pick is outside the posting window \| Kelly fraction is 0 ... \| board cap ... \| pick confidence is below the best-bets floor` | 298 |
| `pick is outside the posting window \| board cap for the slate has been reached` | 161 |
| `pick is outside the posting window \| board cap for the slate has been reached \| pick confidence is below the best-bets floor` | 99 |
| `board cap for the slate has been reached \| pick confidence is below the best-bets floor` | 70 |
| `board cap for the slate has been reached` | 61 |
| `exposure-game-limit` | 9 |
| `Kelly fraction is 0 ... \| board cap for the slate \| board cap for the sport \| board cap for the game/cluster` | 1 |
| `compensating-rollback: history insert failure` | 2 |

Board-cap and Kelly-zero dominate; no `unknown` or unclassifiable reason
strings observed in the clean sample.

## 6. Top promoted picks sanity check

**Empty.** Zero clean production picks had `promotion_target` set or
`promotion_status = 'promoted'` in the 30-day window — see Finding 3.

## 7. Top rejected picks sanity check

Top 15 by `promotion_score` among suppressed clean picks (full list in the
JSON artifact). All are MLB, all carry `fallback_reason = domain-analysis`
(real edge present), scores range 65.3–72.9, and reasons are dominated by
posting-window / Kelly-zero / board-cap combinations — consistent with
legitimately-scored picks that failed a downstream eligibility gate rather
than picks with corrupted or nonsensical scoring inputs.

## 8. Stale / postgame / SUPPRESS leakage check

| leakage type | count |
|---|---|
| promoted while `metadata.isStale = true` | 0 |
| promoted with event start time in the past | 0 |
| promoted (`promotion_target` set) while `metadata.band = SUPPRESS` | 0 |

Zero leakage on the corrected denominator. An initial pass (before excluding
legacy proof-fixture rows, Finding 1) showed 764 "SUPPRESS-band-but-promoted"
rows — all traced to `UTV2-1022` risk-sizing T1 proof fixtures, not a real
promotion-service defect. See Finding 1 for detail; this is recorded so a
future re-run of this script (or a differently-written one) doesn't rediscover
the same false positive.

## 9. Source-by-source scoring health

Only sources with clean production data in this window can be scored:

| source | total (clean) | band coverage | Kelly coverage | domainAnalysis coverage | suppressed |
|---|---|---|---|---|---|
| board-construction | 465 | 94.6% | 85.4% | 100% | 95.9% |
| system-pick-scanner | 1,793 | 99.2% | 86.9% | 100% | 99.4% |

`alert-agent`, `model-driven`, `smart-form` have 0 clean rows — see Finding 2.

---

## Findings

### Finding 1 — Legacy proof-fixture rows evade the UTV2-1394 `testRun` filter

- **Exact issue:** T1 proof fixtures predating the `metadata.testRun` tagging
  convention (UTV2-1394) tag themselves with `metadata.proof_issue`,
  `metadata.proof_fixture_id`, and/or embed `"PROOF"` in `picks.selection`
  instead. `scripts/edge-fallback-report/run-edge-fallback-report.ts`
  (`--production-only` mode) only excludes `metadata.testRun` and a fixed
  non-production `source` set — it does not check these older markers, so
  these rows are silently counted as genuine production signal.
- **Impact:** Before adding the extra exclusion in this audit's script, the
  same 30-day window measured 9,954 "production" picks (vs. the corrected
  2,258), a 79.7% confidence-fallback rate (vs. the corrected 10.5%), and 764
  false "SUPPRESS-band-but-promoted" leakage rows (vs. the corrected 0) — all
  traced to `UTV2-1022`/`UTV2-519`/`UTV2-521` proof fixtures. Any dashboard or
  report reusing the UTV2-1394 exclusion pattern verbatim will overstate
  contamination-driven anomalies the same way.
- **Affected source paths:** `scripts/edge-fallback-report/run-edge-fallback-report.ts`
  (`isTestFixtureRow`/`NON_PRODUCTION_SOURCES`); any future measurement script
  copying that pattern (this audit's script now carries the corrected version
  in `isTestFixtureRow`).
- **Recommended child lane:** Extract a single shared "is this a live-fixture
  row" predicate (testRun + proof_issue + proof_fixture_id + selection-proof
  pattern) into one util both scripts import, and re-run UTV2-1394's report
  with it to confirm its own numbers don't shift materially. Small, mechanical,
  no scoring-logic change.
- **Proof required:** re-run `run-edge-fallback-report.ts --production-only`
  before/after and diff `excluded_test_fixture_count` and category percentages.
- **PM gate:** Not required — measurement-tooling fix only, T2/T3-shaped.

### Finding 2 — `alert-agent` and `model-driven` sources have zero measurable production data; the picks table is 92.8% test/proof fixtures over 30 days

- **Exact issue:** Of 39,570 `picks` rows created in the last 30 days
  (non-`api`/`test`/`proof`/etc. sources), 29,250 (73.9% of that already-source-filtered
  set; 92.8% once combined with the excluded-source count) are test/proof
  fixtures written by recurring live-DB proof suites: `UTV2-519` (3,610 rows),
  `UTV2-521` (3,317), `UTV2-1022` (764, `smart-form`-tagged), plus 21,554
  `smart-form`-tagged rows carrying `metadata.testRun`. These write
  continuously — `proof_issue` timestamps for `UTV2-519`/`UTV2-521`/`UTV2-1022`
  span every day from 2026-06-02 through 2026-07-01. `alert-agent` (1,742 rows)
  and `model-driven` (1,718 rows) are **100%** fixture-tagged with **zero**
  clean rows in the window.
- **Impact:** This audit cannot say anything — pass or fail — about scoring
  health for `alert-agent` or `model-driven`. It is unknown from this data
  whether those sources are dormant in production or whether their genuine
  traffic is real but simply absent from the last 30 days for an unrelated
  reason. It also means any Supabase cost/egress audit (UTV2-1369, UTV2-1372,
  both queued) is measuring a `picks` table that is >90% non-production rows.
- **Affected source paths:** `apps/api` live-DB test suites tagged with
  `proof_issue: 'UTV2-519' | 'UTV2-521' | 'UTV2-1022'` (exact test files not
  enumerated in this audit — pull via `metadata.proof_issue` on
  `pick_promotion_history`/`picks`); `public.picks` table itself.
- **Recommended child lane:** A decision/design lane (not a straight fix) —
  should recurring live-DB proof suites (a) write to an isolated
  schema/table instead of `public.picks`, (b) always delete/roll back their
  fixture rows after the run, or (c) at minimum uniformly tag with
  `metadata.testRun` so every downstream consumer can rely on one exclusion
  key instead of three. Any of these touches shared T1 proof infrastructure
  and, for options (a)/(b), implies a DB cleanup of historical rows.
- **Proof required:** whichever direction is chosen — before/after row counts
  by source, confirmation `pnpm test:db` still passes for the affected suites.
- **PM gate:** **Yes.** Cleaning up or relocating ~29k existing rows is a DB
  mutation/backfill per the escalation constraints on this audit, and the
  choice affects two already-queued cost-audit lanes (UTV2-1369, UTV2-1372) —
  recommend sequencing this decision before or alongside those.

### Finding 3 — Zero clean production picks were promoted in 30 days (operational, not a scoring defect)

- **Exact issue:** `top_promoted_sanity_check` (Section 6) is empty; across
  the 2,258-row clean sample, no pick has `promotion_target` set or
  `promotion_status = 'promoted'`. All promotion activity in the window is
  suppression (Section 1/5).
- **Impact:** No promoted picks means the audit cannot sanity-check band/edge
  quality on anything that actually reached a board. It also means, for the
  currently-measurable sources, the full pipeline produced no member-visible
  output in a month from fresh data.
- **Affected source paths:** none identified as broken — reasons observed
  (Section 5) are board-cap and Kelly-zero gates operating as designed post
  UTV2-1380/1381.
- **Recommended child lane:** none from this audit. This overlaps
  `UTV2-1374` (already queued: "Runtime throughput proof across active
  sports") — recommend folding this observation into that lane rather than
  opening a new one.
- **Proof required:** N/A (informational).
- **PM gate:** Not required for this audit to report it; escalation would
  only be needed if the response were to loosen board caps or Kelly/threshold
  gates, which is explicitly out of scope here (per audit constraints — no
  promotion threshold changes without a separate PM-approved lane).

### Finding 4 — `classifyMarketFamily()` resolves almost nothing to a known family on live data

- **Exact issue:** Of 2,258 clean picks, `classifyMarketFamily(picks.market)`
  classifies 2,201 (97.5%) as `unknown`. Sample raw `market` values seen:
  `game_total_ou`, `nba-spread`, `moneyline`. `moneyline` and `game_total_ou`
  intuitively look like they should map to `game-line`, but
  `classifyMarketFamily` only matches literal `'game_total'`/`'game-total'`
  substrings or the exact string `'total'` — `game_total_ou` does not match
  any of its patterns.
- **Impact:** Market-family-based reporting/analytics (including this audit's
  own Section 1 market-family breakdown) is not informative on real data
  today. `MARKET_FAMILY_PROMOTION_MODIFIERS` weighting by family
  (`packages/domain/src/scoring/promotion-weight-profiles.ts`) may also be
  silently defaulting most live picks to the `unknown` modifier profile
  instead of their true family.
- **Affected source paths:**
  `packages/domain/src/scoring/promotion-weight-profiles.ts:79`
  (`classifyMarketFamily`).
- **Recommended child lane:** A narrow, mechanical lane to extend the
  `classifyMarketFamily` pattern list to cover observed live market-key
  variants (e.g. `_ou` suffix forms), backed by a fixture test using the
  exact live-observed strings. This is a plausible narrow bug per the audit's
  constraints (fix the classifier, not the weighting logic) — needs PM
  sign-off before implementation since it changes which modifier profile
  real picks receive.
- **Proof required:** unit test asserting the previously-`unknown` live
  strings now classify correctly; re-run of this audit's Section 1 showing
  materially fewer `unknown` rows.
- **PM gate:** **Yes** — this is a scoring-adjacent behavior change
  (market-family modifiers feed into `applyPromotionModifiers`), not a pure
  measurement fix, even though the underlying defect looks narrow.

---

## Constraints honored

- Excluded `metadata.testRun` rows and legacy proof/test/synthetic rows
  (Finding 1).
- No ROI, CLV, or edge-performance claims made anywhere in this report.
- No scoring logic changed. `scripts/audits/utv2-1382-scoring-validation.ts`
  is read-only and writes only to `docs/06_status/proof/UTV2-1382/`.
- No stale pre-UTV2-1394 metrics reused — all numbers here are from a fresh
  30-day live-DB query run in this lane.
- Findings 2 and 4 are flagged for PM gate per the escalation list (DB
  mutation/backfill; scoring-adjacent behavior change) rather than
  implemented directly.
