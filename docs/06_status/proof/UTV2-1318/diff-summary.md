# Diff Summary — UTV2-1318 Launch Gate Definition

**Lane:** UTV2-1318  
**Tier:** T2 governance  
**Branch:** claude/utv2-1318-launch-gate-definition  
**Generated at:** 2026-06-25T22:30:00Z

---

## Changes

### Files added

- `docs/05_operations/LAUNCH_GATE_DEFINITION.md` — Launch Gate Definition (new document)
- `docs/06_status/proof/UTV2-1318/verification.md` — T2 proof
- `docs/06_status/proof/UTV2-1318/diff-summary.md` — this file

---

## LAUNCH_GATE_DEFINITION.md content

**Purpose:** Define production-ready ≠ launch-ready distinction; establish three-tier launch gate for controlled public rollout.

| Section | Summary |
|---|---|
| Core Distinction | Production GREEN is necessary but not sufficient for any launch step |
| Constitutional State at Baseline | P1/P2 CERTIFIED, P3/P4 NOT_CERTIFIED, P5 FROZEN — no state changes |
| Launch Tier A | Internal/canary delivery — governance brake active, no public claims |
| Launch Tier B | Selective public — requires Tier A + Discord audit + queue semantics + P3 verdict |
| Launch Tier C | Full public — requires Tier B + burn-in PASS + P3 PASS + P4/P5 unfreeze |
| Evidence Requirements | Matrix per tier showing what's Required / Recommended / Not required |
| Claim Discipline | All PM-forbidden claims enumerated with their gate conditions |
| Allowed Launch-Prep | Work authorized without tier approval (drafting, configuring, auditing) |
| Follow-Up Lanes | UTV2-1319, UTV2-1320, incident runbook, rollback, monitoring, UTV2-1042, UTV2-1176 |

---

## Scope

- No source changes
- No schema changes
- No migrations
- No test changes
- 3 docs files (1 new spec + 2 proof)
- No P-state changes
- No Discord enablement

R-level check: PASS — no R-level artifacts required for docs-only diff

---

## Merge SHA Binding

**Merge SHA:** _to be bound by post-merge-lane-close.yml_  
**PR:** _pending_  
**Merged at:** _pending_
