# Next Actions — SPRINT-CONSTITUTION-RESTORATION-AND-RATIFICATION-001

> 2026-06-02. Ordered by constitutional sequencing (§18.2: truth → governance → scale). Each: action, owner, gate. None of these were performed this sprint (out of scope: restore/preserve/map/audit only).

## PM decisions required (only PM can do these — §2.9)
| # | Decision | Closes | Why it's PM-only |
|---|---|---|---|
| PM-1 | Ratify §18.3 program numbering as canonical; direct repo cert-doc renaming to match | D-CONST-1 | Constitutional authority / numbering identity |
| PM-2 | Authorize P3+ activation **or** affirm the freeze; update Linear `PROGRAM_1_FROZEN_SURFACE` accordingly | D-CONST-2 | Stage activation authority (§20.6) |
| PM-3 | Order authoring of `PROGRAM_1_CERTIFICATION.md` + `PROGRAM_4_CERTIFICATION.md` from existing evidence | D-CONST-3 | Certification authority |
| PM-4 | Keep P5-C/P5-D **frozen** until burn-in PASS + cert identity (affirm) | §4.17 | Capital authority |

## Engineering actions (sequenced)
| # | Action | Owner | Gate |
|---|---|---|---|
| A1 | Restore ingestion (SGO key + redeploy) — clears the live §22 anti-pattern (D-CONST-6) | Griff | `ingestor.fresh=true` ×3 snapshots |
| A2 | Redeploy current `main`; prove `/health` 200 | Griff | smoke green + deployed SHA == main |
| A3 | Drain 191 dead-letters; prove one live DeliveryOutcome (4.10 runtime) | Claude+Griff | dead_letter ↓ ×3 |
| A4 | First **burn-in PASS** (unblocks P5) | Claude+Griff | `ops-burn-in-monitor` `verdict:PASS` |
| A5 | Make `t1-proof-gate` execution-bound; DB-trigger proofs fail-closed on skip (D-CONST-4) | Codex | gate self-test rejects string-only proof |
| A6 | Regenerate `database.types.ts`; non-skippable parity (D-CONST-7) | Codex | `schema:parity` clean |
| A7 | Fix CLAUDE.md "fail-open" lines (D-CONST-8) | Claude | doc grep clean |
| A8 | Add `constitution:check` to CI + CODEOWNERS for `docs/00_constitution/**` | Codex | guard runs on every PR |

## Mission action (the long pole)
| # | Action | Owner | Gate |
|---|---|---|---|
| M1 | Prove ONE market-independent edge with +CLV on ≥500 settled picks (4.6 → 4.12 → 4.19) | Griff→Claude | `avg_clv>0` + `clv_hit_rate>52%` |

## Recommended next sprint
**SPRINT-CONSTITUTIONAL-CONVERGENCE-002** — focus: (1) PM-1/PM-2/PM-3 truth-reconciliation, (2) A1–A4 runtime restoration to first burn-in PASS, (3) A5 proof-execution-binding. These lift the lowest-converged constitutional surfaces (4.1, 4.10, 4.14, governance proof integrity) and unblock the institutional path — without touching the frozen capital layer.
