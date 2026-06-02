# Stale-Reference Audit — SPRINT-CONSTITUTIONAL-CONVERGENCE-002

> 2026-06-02. Phase 3 result. Searched for conflicting program/cert references; classified each as **annotated** (banner added), **audit-finding** (already reports drift — no banner needed), or **deferred** (rename/edit out of scope this sprint).

## Search terms used
`PROGRAM_[1-5]_CERTIFICATION`, `PROGRAM_5_ACTIVATION`, `Program 2 = WS-1`, `P2=WS-1`, `P1–P4 certified`, `P3 certified`, `P4 certified`, `Program 3+ frozen`, `certified 2026-06-01`.

## Annotated this sprint (banner added — historical, not deleted)
| File | Conflict | Banner drift tag |
|---|---|---|
| `docs/06_status/programs/PROGRAM_2_CERTIFICATION.md` | "Program 2 = WS-1.x" + "P1–P4 certified SATISFIED" | D-CONST-1 |
| `docs/06_status/programs/PROGRAM_3_CERTIFICATION.md` | header "Status: CERTIFIED" (P3) | D-CONST-2 |
| `docs/06_status/programs/PROGRAM_5_ACTIVATION.md` | "P1–P4 certified SATISFIED", "P3 certified" | D-CONST-2 |
| `docs/06_status/CERT_BOARD.md` | "Program 2 = WS-1.x" + "P1–P4 certified gate SATISFIED" | D-CONST-1/2 |
| `docs/06_status/decisions/M10_PATH_A_DECISION.md` | "P1–P4 certified + M10 Path A" gate string | D-CONST-2 |

## Audit-findings (already report the drift — NOT authority docs; no banner)
These are audit outputs that *identify* the drift rather than assert conflicting authority. They are left as-is (annotating them would be redundant):
- `docs/06_status/readiness/UNIT-TALK-DEFINITIVE-READINESS-AUDIT/**` (and `FINAL_SYNTHESIS/**`, `codex-mechanical-proof/**`) — the definitive readiness audit; already flags numbering + cert drift.
- `docs/06_status/readiness/UNIT-TALK-EDGE-READINESS/STATE_TRUTH_RECONCILIATION.md` — already says "do not use P1–P4 as an unlock string until identity is deterministic."
- `docs/06_status/proof/R10-FEATURE-WIRING-TRUTH-AUDIT/**`, `docs/06_status/proof/SCORING-ENGINE-TRUTH-AUDIT/**` — scoring/feature audits (untracked working-tree audit outputs, not authority).
- `docs/00_constitution/**` + `SPRINT-CONSTITUTION-RESTORATION-AND-RATIFICATION-001/**` — the canonical constitution + its own drift audit (these *are* the authority; updated with PM rulings, not bannered).

## Deferred (rename/edit not done this sprint — per "prefer banner + gap record first")
- Renaming `PROGRAM_2_CERTIFICATION.md` to reflect that its "Program 2" is WS-1.x/Truth-adjacent → SPRINT-CERTIFICATION-STATE-RECONCILIATION-003.
- Authoring canonical `PROGRAM_1_CERTIFICATION.md` + `PROGRAM_4_CERTIFICATION.md` (D-CONST-3) → 003.
- Correcting `packages/db/CLAUDE.md` / `packages/contracts/CLAUDE.md` "fail-open" lines (D-CONST-8) → low-risk doc fix, later.

## Note on Linear
Linear certification docs (`PROGRAM_1_FROZEN_SURFACE`, `PROGRAM_2_*`, etc.) are **operational tracking** and were **not modified** this sprint (repo is authoritative; Linear edits are out of scope here). They are marked subordinate by policy in `CANONICAL_PROGRAM_STATE.md`. Reconciling Linear operational state is part of SPRINT-CERTIFICATION-STATE-RECONCILIATION-003.
