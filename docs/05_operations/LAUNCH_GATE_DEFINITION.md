# Launch Gate Definition — Unit Talk V2

**Version:** 1.0  
**Authority:** PM-ratified (UTV2-1318)  
**Status:** ACTIVE — Controlled Launch Gate Preparation phase  
**Last updated:** 2026-06-25

---

## Core Distinction

> **Production-ready ≠ Launch-ready.**

**Production-ready** (current state: GREEN) means:
- No blocking operational failures
- Ingestor cycling cleanly
- Deploy SHA aligned
- No true delivery failures in the outbox
- No critical DB tripwires

**Launch-ready** means all of the above PLUS:
- Controlled delivery gates defined and enforced
- Claim discipline verified
- Incident response path documented
- Rollback procedure confirmed
- Monitoring coverage confirmed
- Each launch step explicitly PM-approved before execution

Production GREEN is a necessary but not sufficient condition for any launch step.

---

## Constitutional State at Baseline (non-negotiable)

These states are fixed as of 2026-06-25. No launch step may claim otherwise without explicit PM certification action:

| Program | State | What it means for launch |
|---|---|---|
| **P1** — Truth Convergence | `ACTIVE_CERTIFIED` (re-cert due 2026-08-25) | Pipeline produces canonical picks; re-cert prep authorized |
| **P2** — Governance Convergence | `ACTIVE_CERTIFIED` | Governance brake, lifecycle states, and delivery safety are certified |
| **P3** — Decision Integrity Convergence | `ACTIVE_NOT_CERTIFIED` | Scoring code active; empirical CLV/edge evidence not yet proven. **No edge/CLV/ROI claims.** |
| **P4** — Execution & Economic Truth | `CONDITIONAL_NOT_CERTIFIED` | Execution is real; economic truth requires realized settled data. **No attribution/profit claims.** |
| **P5** — Institutional Runtime | `FROZEN_NOT_CERTIFIED` | **FROZEN.** Treasury, capital, scaling, customer-money claims forbidden. Requires P1–P4 cert + burn-in PASS + M10 Path A. |

---

## Launch Step Tiers

Launch steps are grouped into three tiers. Each tier requires explicit PM approval at that tier level. Higher tiers cannot proceed until all lower tiers are complete and PM-approved.

### Tier A — Controlled Internal Delivery

**What it is:** Delivering picks to internal/canary targets only. The governance brake remains on for public sources. No public Discord. No customer-facing claims.

**Can proceed when:**
- [ ] Production readiness: GREEN (met 2026-06-25)
- [ ] P2 ACTIVE_CERTIFIED (met)
- [ ] Canary Discord target confirmed configured and isolated
- [ ] Governance brake confirmed active on all public sources (`awaiting_approval` lifecycle enforced)
- [ ] Claim discipline checklist signed off (no P3/P4/P5 claims)
- [ ] Incident response runbook exists (UTV2-XXXX)
- [ ] Rollback procedure documented (UTV2-XXXX)
- [ ] PM Tier A approval explicit

**Forbidden regardless:**
- Public Discord messages
- Customer-facing claims about edge, ROI, CLV, win rate
- P3/P4/P5 certification assertions

**PM gate:** Explicit PM_VERDICT approval per `docs/05_operations/schemas/pm-verdict-v1.md`

---

### Tier B — Canary/Selective Public Delivery

**What it is:** Delivery to a defined, limited public audience (canary server, whitelist). Still not full public launch.

**Can proceed when (all Tier A gates met, plus):**
- [ ] Tier A ran successfully with no incidents
- [ ] Canary audience defined and documented
- [ ] Monitoring dashboards confirmed live and watched (UTV2-XXXX)
- [ ] Support/moderation coverage confirmed for canary period
- [ ] P3 data gate: UTV2-1042 evidence verdict rendered (pass/fail/defer — any outcome, but must be rendered)
- [ ] Dead-letter and outbox queue classification confirmed (UTV2-1320)
- [ ] Discord audit complete (UTV2-1319) with no blocking findings
- [ ] PM Tier B approval explicit

**Forbidden regardless:**
- CLV/ROI/edge strength claims unless P3 certifies
- P5-gated content (capital/treasury)
- Customer-money assertions

---

### Tier C — Full Public Launch

**What it is:** Unrestricted public Discord delivery. Customer-facing launch.

**Can proceed when (all Tier B gates met, plus):**
- [ ] Burn-in PASS (UTV2-1176 — currently FROZEN)
- [ ] P3 empirical gate PASSED (UTV2-1042 honest verdict: PASS)
- [ ] P4 economic truth certification OR explicit PM waiver with defined scope
- [ ] P5 unfreeze: P1–P4 certs + burn-in PASS + M10 Path A all satisfied
- [ ] Payment/subscription readiness (if applicable) PM-gated separately
- [ ] Scaling/infrastructure confirmed (Hetzner provisioned — done)
- [ ] Legal/compliance review if customer-money flow involved
- [ ] PM Tier C approval explicit

---

## Evidence Requirements by Launch Step

| Evidence Type | Tier A | Tier B | Tier C |
|---|---|---|---|
| Production readiness GREEN | Required | Required | Required |
| P2 certified | Required | Required | Required |
| Canary target isolation confirmed | Required | Required | Required |
| Incident runbook exists | Required | Required | Required |
| Rollback procedure documented | Required | Required | Required |
| Monitoring dashboards live | Recommended | Required | Required |
| Discord audit (UTV2-1319) | Not required | Required | Required |
| Queue semantics (UTV2-1320) | Not required | Required | Required |
| P3 data-gate verdict rendered | Not required | Required | Required |
| P3 data-gate PASS | Not required | Not required | Required |
| Burn-in PASS | Not required | Not required | Required |
| P4 economic cert OR waiver | Not required | Not required | Required |
| P5 unfreeze | Not required | Not required | Required |

---

## Claim Discipline (binding at all tiers)

Regardless of which launch tier is active, the following claims are **always forbidden** until the named gate is met:

| Claim | Forbidden until |
|---|---|
| P3 certification | UTV2-1042 empirical gate PASS verdict |
| Proven economic edge / ROI | P4 certification |
| CLV attribution | Realized settled pick corpus + P4 cert |
| Win-rate / edge strength | P3 cert |
| P5 unfreeze | Burn-in PASS + P1–P4 certs + M10 Path A |
| Public Discord enablement | Tier B gate complete + PM approval |
| Customer-money readiness | P5 unfreeze + Tier C gate + PM approval |
| Subscription/payment flow | P5 scope + separate PM approval |

Any agent, document, or external communication making these claims without the gate being met is a **P0 protocol violation**.

---

## Allowed Launch-Prep Work (no PM gate required)

The following work is authorized without Tier gate approval — it prepares for launch without enabling it:

- Drafting incident response runbook
- Drafting rollback procedure
- Configuring monitoring dashboards (read-only, not customer-facing)
- Canary target configuration (not enabling delivery, just confirming it)
- Discord audit (UTV2-1319 — audit only, no activation)
- Queue semantics encoding (UTV2-1320 — classification only, no mutation)
- P3 data-gate evidence evaluation (UTV2-1042 — honest verdict, not claim)
- Lane-level proof/verification work

---

## Follow-Up Lanes

The following lanes are required before any Tier A gate can be considered complete:

| Lane | Purpose | Tier Required | Executor |
|---|---|---|---|
| UTV2-1319 | Discord Launch Gate Audit — confirm readiness state and blockers | Tier B | Claude + Codex |
| UTV2-1320 | Queue readiness semantics — encode governance-held vs true failures | Tier B | Claude + Codex |
| UTV2-XXXX | Incident response runbook — define alert/escalation/rollback procedure | Tier A | Claude |
| UTV2-XXXX | Rollback procedure — define explicit steps to revert any launch step | Tier A | Claude |
| UTV2-XXXX | Monitoring dashboard spec — define what is watched and by whom | Tier B | Claude |
| UTV2-1042 | P3 empirical gate — honest pass/fail/defer verdict on CLV/edge data | Tier B | Claude/Griff |
| UTV2-1176 | 7-lane burn-in — FROZEN until P5 conditions met | Tier C (blocked) | PM-gated |

Lanes marked `Tier A` must complete before Tier A approval is requested from PM.  
Lanes marked `Tier B` must complete before Tier B approval.  
UTV2-1176 is currently FROZEN and must not be dispatched.

---

## What This Document Is Not

- This is not a certification document. No program states change as a result of this definition.
- This is not a deploy authorization. Production is already GREEN; no further deploy is needed for Tier A prep.
- This is not a Discord enablement. All delivery gates remain off until explicitly PM-approved per tier.
- This is not a claim of economic viability. P3/P4 remain not certified.

---

## Document Authority

This document is authoritative for Launch Gate sequencing. It supplements:
- `docs/00_constitution/UNIT_TALK_CONSTITUTION_V1.md` (binding)
- `docs/00_constitution/CANONICAL_PROGRAM_STATE.md` (binding for P-state)
- `docs/06_status/CURRENT_STATE.md` (current program snapshot)
- `docs/06_status/readiness/readiness-score.json` (production readiness ledger)

If this document and the constitution conflict, the constitution wins.
