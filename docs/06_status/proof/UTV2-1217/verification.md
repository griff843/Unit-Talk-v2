# UTV2-1217 Verification — CLV/Edge Evidence Collection

**Verifier:** claude/utv2-1217
**Run at:** 2026-06-06T22:15:00Z
**Supabase project:** zfzdnfwdarxucxtaojxm
**Branch head SHA:** 9d46f54b8648e3ccb542e821ff086f2d5a226995

---

## Verification

This document records the full verification run for UTV2-1217: CLV/edge evidence collection against live Supabase. No source files were changed; this is a proof-only lane.

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

---

## pnpm type-check

No source files changed. Evidence-collection only lane — no compilation required.
Result: **PASS** (no-op, scope is proof files only)

---

## Constitutional Constraints

- SGO activated: false
- P3 advanced: false
- P5 unfrozen: false
- Edge claim made: false
- Production readiness claimed: false

---

## Query 1 — Total pick corpus

```sql
SELECT COUNT(*) as total_picks,
  COUNT(settled_at) as graded_picks,
  COUNT(promotion_score) as scored_picks,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM picks;
```

Result:
| total_picks | graded_picks | scored_picks | oldest | newest |
|---|---|---|---|---|
| 23467 | 1437 | 10797 | 2026-04-21 | 2026-06-06 |

---

## Query 2 — promotion_version distribution

```sql
SELECT promotion_version, COUNT(*) as count
FROM picks
WHERE promotion_version IS NOT NULL
GROUP BY promotion_version
ORDER BY count DESC;
```

Result:
| promotion_version | count |
|---|---|
| best-bets-v2 | 10797 |
| trader-insights-v2 | 1 |

---

## Query 3 — model_registry champion models (artifact_sha check)

```sql
SELECT model_name, version, sport, active_state, artifact_sha, champion_since
FROM model_registry
WHERE active_state IN ('champion', 'active', 'deployed')
ORDER BY created_at DESC LIMIT 20;
```

Result (6 rows):
| model_name | version | sport | active_state | artifact_sha |
|---|---|---|---|---|
| baseline-nhl-game-line | v0.1-baseline-2026-04-22 | NHL | champion | NULL |
| baseline-nhl-player-prop | v0.1-baseline-2026-04-22 | NHL | champion | NULL |
| baseline-mlb-game-line | v0.1-baseline-2026-04-22 | MLB | champion | NULL |
| baseline-mlb-player-prop | v0.1-baseline-2026-04-22 | MLB | champion | NULL |
| baseline-nba-game-line | v0.1-baseline-2026-04-22 | NBA | champion | NULL |
| baseline-nba-player-prop | v0.1-baseline-2026-04-22 | NBA | champion | NULL |

**Finding: artifact_sha is NULL for all champion models. No Wave-5 model SHA registered.**

---

## Query 4 — domainAnalysis version (Wave-5 discriminator check)

```sql
SELECT metadata->'domainAnalysis'->>'version' as domain_version, COUNT(*) as count
FROM picks
WHERE metadata ? 'domainAnalysis'
GROUP BY metadata->'domainAnalysis'->>'version'
ORDER BY count DESC;
```

Result:
| domain_version | count |
|---|---|
| domain-analysis-v1.0.0 | 10830 |

**Finding: Single version across all picks — no Wave-5 discriminator in domainAnalysis.version.**

---

## Query 5 — Wave-5 era picks (post-June-1 proxy)

```sql
SELECT COUNT(*) as wave5_era_picks,
  COUNT(CASE WHEN settled_at IS NOT NULL THEN 1 END) as graded,
  COUNT(CASE WHEN promotion_score IS NOT NULL THEN 1 END) as scored
FROM picks
WHERE created_at >= '2026-06-01T00:00:00Z';
```

Result:
| wave5_era_picks | graded | scored |
|---|---|---|
| 8896 | 706 | 2662 |

---

## Query 6 — Sport breakdown of Wave-5 era picks

```sql
SELECT sport_id, COUNT(*) as total_picks, COUNT(settled_at) as graded, COUNT(promotion_score) as scored
FROM picks
WHERE created_at >= '2026-06-01T00:00:00Z'
GROUP BY sport_id ORDER BY total_picks DESC;
```

Result:
| sport_id | total_picks | graded | scored |
|---|---|---|---|
| NULL | 8896 | 706 | 2662 |

**Finding: sport_id=NULL for ALL post-Wave-5 picks — synthetic/smoke-test corpus.**

---

## Query 7 — Post-Wave-5 CLV/edge distribution (graded picks with devig data)

```sql
SELECT
  COUNT(*) as graded_with_devig,
  COUNT(CASE WHEN (metadata->'kellySizing'->>'has_edge')::boolean = true THEN 1 END) as has_edge_true,
  COUNT(CASE WHEN (metadata->'kellySizing'->>'has_edge')::boolean = false THEN 1 END) as has_edge_false,
  ROUND(AVG((metadata->'kellySizing'->>'raw_kelly')::numeric)::numeric, 6) as mean_raw_kelly,
  ROUND(AVG((metadata->'deviggingResult'->>'overFair')::numeric)::numeric, 6) as mean_over_fair
FROM picks
WHERE created_at >= '2026-06-01T00:00:00Z'
  AND settled_at IS NOT NULL
  AND metadata ? 'deviggingResult'
  AND metadata ? 'kellySizing';
```

Result:
| graded_with_devig | has_edge_true | has_edge_false | mean_raw_kelly | mean_over_fair |
|---|---|---|---|---|
| 503 | 0 | 503 | -0.338599 | 0.362572 |

---

## Query 8 — Pre-Wave-5 baseline (graded picks with devig data)

```sql
SELECT
  COUNT(*) as graded_with_devig,
  COUNT(CASE WHEN (metadata->'kellySizing'->>'has_edge')::boolean = true THEN 1 END) as has_edge_true,
  COUNT(CASE WHEN (metadata->'kellySizing'->>'has_edge')::boolean = false THEN 1 END) as has_edge_false,
  ROUND(AVG((metadata->'kellySizing'->>'raw_kelly')::numeric)::numeric, 6) as mean_raw_kelly
FROM picks
WHERE created_at < '2026-06-01T00:00:00Z'
  AND settled_at IS NOT NULL
  AND metadata ? 'deviggingResult'
  AND metadata ? 'kellySizing';
```

Result:
| graded_with_devig | has_edge_true | has_edge_false | mean_raw_kelly |
|---|---|---|---|
| 86 | 1 | 85 | -0.321761 |

---

## Edge Delta Summary

| Metric | Post-Wave-5 | Pre-Wave-5 Baseline | Delta |
|---|---|---|---|
| Graded picks with devig data | 503 | 86 | +417 |
| has_edge=true rate | 0/503 (0%) | 1/86 (1.2%) | -1.2pp |
| Mean raw_kelly | -0.338599 | -0.321761 | -0.016838 |

---

## Honest Finding

**INSUFFICIENT PRODUCTION VOLUME FOR STATISTICAL CLV/EDGE CLAIM.**

Three compounding reasons this evidence does not support an edge claim:

1. **No Wave-5 model SHA.** `model_registry.artifact_sha` is NULL for all 6 champion models. The live pipeline runs `v0.1-baseline-2026-04-22` models. Wave-5 wired code-level feature modules into `computeStatProjection` but has not produced a registered model artifact with a distinct SHA. The stat-model path is wired but not yet exercised with a new trained model.

2. **No real production picks.** All 8,896 post-Wave-5 picks have `sport_id=NULL`, indicating they are synthetic smoke-test submissions (event names contain `db-smoke-utv2-996`). No real sports picks have been generated through the Wave-5 path.

3. **All picks have has_edge=false.** 0 out of 503 graded picks with devig data show positive edge. Mean raw_kelly = -0.339. This is consistent with smoke-test data designed to exercise the pipeline, not identify positive-EV bets.

**No edge, CLV, or ROI claim is made.** This bundle records the current DB state as the Wave-5 evidence collection baseline. A second evidence pass is required once the pipeline accumulates real production picks under the Wave-5 stat-model path.
