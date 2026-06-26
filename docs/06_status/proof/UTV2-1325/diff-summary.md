# Diff Summary — UTV2-1325 Grading + Model Proof Inventory

**Lane:** UTV2-1325  
**Tier:** T2 verification  
**Branch:** claude/utv2-1325-grading-model-proof-inventory  
**Generated at:** 2026-06-26

---

## Scope

Docs-only audit lane. Produces a proof inventory document. No source code changes, no DB mutation, no certification status changes.

---

## Files Changed

### docs/06_status/readiness/GRADING_MODEL_PROOF_INVENTORY.md (NEW)

Complete inventory of grading system and model/scoring system. Classifies each component as WORKING, STRUCTURALLY_PROVEN, PARTIALLY_PROVEN, UNPROVEN, or BROKEN.

**Key verdicts:**
- Grading system: complete, implemented, partially live-proven
- Model: structurally proven, empirically unproven; two inputs (DEBT-019, DEBT-020) are constant fallbacks
- Winning picks: UNPROVEN — no evidence exists

### docs/06_status/proof/UTV2-1325/verification.md (NEW)

Verification log with evidence sources and before/after summary.

### docs/06_status/proof/UTV2-1325/diff-summary.md (NEW)

This file.

---

## Key Findings

### Grading System

| Finding | Classification |
|---|---|
| GradeResultRepository: InMemory (line 1228) + Database (line 4389) implementations confirmed | WORKING |
| Evidence settlements produced (143 — 90W/53L) | WORKING |
| Grading cron last confirmed run: 2026-06-08 | PARTIALLY_PROVEN |
| Public pick grading (posted picks): 0 graded since Phase 7A governance brake | Expected gap (governance) |
| End-to-end ingest→grade→settle: pieces proven separately | PARTIALLY_PROVEN |

### Model/Scoring

| Finding | Classification |
|---|---|
| computeStatProjection: determinism proven, synthetic corpus | STRUCTURALLY_PROVEN |
| 5 feature modules (Wave 5): unit-tested, no live proof | STRUCTURALLY_PROVEN |
| Real edge: market data sourcing WORKING; model signal BLOCKED by DEBT-019 | PARTIALLY_PROVEN |
| DEBT-019: domainAnalysis unpopulated → 92.4% of edge = confidence proxy | STRUCTURAL GAP |
| DEBT-020: kellySizing unpopulated → 94.4% of readiness = constant 60 | STRUCTURAL GAP |
| CLV: schema + join proven; forward-flow write path unexercised | PARTIALLY_PROVEN |
| Winning picks: no evidence | UNPROVEN |

---

## Merge SHA Binding

**Merge SHA:** `ba83018ad14ade1234ce068f6bf5cc04759e28ce`  
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1083  
**Merged at:** 2026-06-26
