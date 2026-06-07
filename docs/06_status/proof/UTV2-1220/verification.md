## Summary

UTV2-1220 — D-CONST-5 resolution evidence bundle. Assembles Wave 5+7 evidence and updates CERTIFICATION_GAP_REGISTER.md. D-CONST-5 resolved structurally; empirical CLV evidence deferred to UTV2-1042. All UTV2-1219 validation gaps dispositioned. No source files changed.

---

## Verification — UTV2-1220 D-CONST-5 Resolution Evidence Bundle

**Issue:** UTV2-1220
**Tier:** T2
**Verifier:** claude/utv2-1220
**Constitutional anchor:** D-CONST-5

---

### Input evidence consumed

| Issue | Merge SHA | Finding |
|-------|-----------|---------|
| UTV2-1217 | 98552597 | CLV/edge evidence insufficient — corpus is synthetic (sport_id=NULL). Empirical claim deferred. |
| UTV2-1218 | 00eaa61c | R2 determinism confirmed — computeStatProjection is deterministic across NBA/NFL/MLB/NHL. |
| UTV2-1219 | 43ed4621 | V-R4 fault injection complete — 74 tests pass. 5 validation gaps documented. |

### Wave 5 merge SHAs (structural remediation)

| Issue | Merge SHA | Feature |
|-------|-----------|---------|
| UTV2-1211 | e21b6999 | matchup-context logit-space fix |
| UTV2-1212 | c1e7d9a9 | player-form wiring |
| UTV2-1213 | aa3a7c8d | snap_share provenance gate |
| UTV2-1214 | b561bd71 | efficiency pace cap |
| UTV2-1215 | a8d3a105 | game-context wiring |

---

### D-CONST-5 resolution determination

**Resolved: structural.** Scoring is no longer a pure market-consensus echo. The Wave 5 lanes wired five independent stat-based feature modules into `computeStatProjection`. The scoring path now incorporates stat-model projections alongside devig.

**Empirical evidence: deferred.** UTV2-1217 found all post-Wave-5 graded picks with devig data have `sport_id=NULL` — synthetic smoke-test corpus, not live production. No CLV or edge advantage can be claimed from this data. Empirical CLV/edge certification deferred to UTV2-1042 (`state:data-gated`).

**P3 status: unchanged.** `ACTIVE_NOT_CERTIFIED`. D-CONST-5 structural resolution does not advance P3 certification. No certification ceremony has been approved.

---

### UTV2-1219 gap dispositions (all five accounted for)

| Gap | Disposition | Rationale |
|-----|-------------|-----------|
| NaN efficiency_projection | **Deferred** | Input validation hardening required; tracked for follow-up hardening issue |
| NaN home_away_factor | **Deferred** | Same NaN propagation pattern; tracked for hardening issue |
| Zero home_away_factor | **Deferred** | Degenerate sentinel not rejected; included in home_away_factor hardening issue |
| Negative variance components | **Accepted risk** | Math.max(0.0001) clamp is correct defensive behavior; well-defined downstream |
| NaN stat_per_minute | **Deferred** | Corrupts feature hash silently; included in NaN input validation hardening issue |

Follow-up hardening issues to open post-closeout:
1. NaN input validation at `computeStatProjection` boundary (efficiency_projection, stat_per_minute, home_away_factor)
2. Zero sentinel rejection for home_away_factor

---

### CERTIFICATION_GAP_REGISTER.md update

D-CONST-5 updated from `OPEN` → `RESOLVED` with:
- Structural resolution via Wave 5 (UTV2-1211–1215)
- Empirical evidence status documented as deferred
- All Wave 7 evidence bundles (UTV2-1217, 1218, 1219) linked

D-CONST-6 remains `OPEN` — ingestion staleness is a separate gap, not closed by this issue.

---

## pnpm test:db

Command: `pnpm test:db`
Run from main checkout against live Supabase (zfzdnfwdarxucxtaojxm).

```
ok 1 - UTV2-996: submission with new pick reaches awaiting_approval
ok 2 - UTV2-996: re-submitted duplicate is rejected with conflict
ok 3 - UTV2-996: approved pick reaches queued state
ok 4 - UTV2-996: queued pick reaches distributed state via outbox
ok 5 - UTV2-996: settlement writes settlement_records row
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 100705.626258
```

Result: **PASS** — 7 tests, 0 failures, live DB confirmed healthy.
