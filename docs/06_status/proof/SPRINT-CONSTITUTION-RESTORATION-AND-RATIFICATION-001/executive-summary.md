# Executive Summary — SPRINT-CONSTITUTION-RESTORATION-AND-RATIFICATION-001

> 2026-06-02 · HEAD `a0614837` · Executor: Claude (Opus 4.8). Scope: restore, preserve, map, and audit drift for the recovered Unit Talk Constitution. **No doctrine rewritten, no certification status changed, no runtime behavior modified.**

## What was done
The recovered constitution (`UNIT_TALK_CONSTITUTION_V1.md`, 2483 lines, 19 capability layers) was restored into the repository **byte-for-byte verbatim**, preserved behind a fail-closed CI guard, mapped to implementation reality, and audited for drift. The constitution is now the canonical, SHA-pinned, tamper-evident source of truth at `docs/00_constitution/`.

## Verification results (this run)
| Check | Result |
|---|---|
| Byte-faithful restoration | ✅ `cmp` IDENTICAL; SHA-256 `b22b6e5b47ece0d2b04688ad4b29e2fc3cb20fd09d00e50f91ac1e5fe3e2efc5` |
| `pnpm constitution:check` | ✅ PASS — 6/6 files, 19/19 layers, SHA matches pin, exit 0 |
| Adversarial guard test (§2.13) | ✅ FAILS CLOSED — missing artifact → exit 1; collapsed layer (18/19) → exit 1 |
| `pnpm type-check` | ✅ PASS (clean `tsc -b`) |
| `pnpm lint` | ✅ PASS (exit 0) |
| Runtime behavior changed | ❌ None — only docs + a tsx guard + one `package.json` script line |
| Certification status changed | ❌ None |

## The 10 required questions

1. **Was the Constitution successfully restored?** — **YES.** Verbatim, SHA-pinned (`b22b6e5b…`), 2483 lines, all 19 layers present, guarded by CI.
2. **Which sections are fully implemented?** — Principles §2.1–2.10, 2.12, 2.14; layers **4.2, 4.7, 4.8, 4.9, 4.11, 4.13, 4.15, 4.16**; sections §5, 6, 8, 9, 13, 14, 15, 17, 19, 20, 21.
3. **Which are partially implemented?** — Layers **4.1, 4.3, 4.4, 4.5, 4.6, 4.10, 4.12, 4.14, 4.18, 4.19**; principles 2.11, 2.13; sections §7, 10, 11, 12, 16, 18, 22, 23.
4. **Which are not implemented?** — **4.17 Capital Operations & Treasury** (intentionally frozen — `capital`/`scaling`/`treasury` are constitutional freeze domains; correct per §4.17).
5. **Which have drifted?** — 8 drifts (see `drift-findings.md`): D-CONST-1 program numbering, D-CONST-2 P3+ activation outruns authority, D-CONST-3 missing P1/P4 repo cert docs, D-CONST-4 proof gate string-bound not execution-bound, D-CONST-5 edge-as-echo, D-CONST-6 ingestion stale (a live §22 anti-pattern), D-CONST-7 `database.types.ts` drift, D-CONST-8 doc says fail-open where code is fail-closed.
6. **Which are blocked?** — Capital path (4.17/4.18) blocked on burn-in + certification; edge/economic layers (4.6, 4.12, 4.19) blocked on live data + a real model signal; runtime certification blocked on env (`ops:cert-check`). Linear UTV2-1042 (edge cert) + UTV2-1033 (STRONG label) Blocked Internal.
7. **Weakest capability layer?** — Literally least-implemented: **4.17 Capital Operations & Treasury** (none, frozen by design). Weakest *active, mission-critical* layer: **4.6 Edge Detection** — mechanically present but structurally a market-consensus echo with no realized +EV.
8. **Strongest capability layer?** — **4.15 Governance & Certification** — the crown jewel: certification entity, lifecycle, revocation, dependent gates; 229 live constitutional tests. (4.11 Settlement is a close second, live-verified.)
9. **What percent constitutional convergence exists today?** — **~68% capability-layer convergence** (transparent rubric: IMPLEMENTED=1.0, PARTIAL=0.5, frozen=0 over 19 layers → 13/19). The honest signal is the **split**: **~85% safety/governance convergence vs ~35% intelligence/economic convergence.** The system has converged "cannot silently lie" far more than "can prove it wins."
10. **Next constitutional priorities?** — (1) Restore ingestion + achieve first **burn-in PASS** (unblocks 4.1/4.10/4.14 and all of P5); (2) Reconcile D-CONST-1/2/3 (ratify §18.3 numbering, author `PROGRAM_1`/`PROGRAM_4` cert docs, authorize-or-freeze P3+); (3) Make proof **execution-bound** (D-CONST-4); (4) Prove **one real market-independent edge** with positive CLV (4.6 → 4.12).

## Final output

```
Verdict:                 PASS
Constitution Status:     RESTORED
Constitutional Convergence: ~68% (safety ~85% / intelligence ~35%)
Most Implemented Layer:  4.15 Governance & Certification
Least Implemented Layer: 4.17 Capital Operations & Treasury (frozen by design)
Recommended Next Sprint: SPRINT-CONSTITUTIONAL-CONVERGENCE-002
```

## Acceptance criteria — all met
✅ Constitution restored · ✅ preserved (guard) · ✅ implementation matrix · ✅ drift audit · ✅ program alignment · ✅ Linear execution structure restored · ✅ preservation guard · ✅ proof bundle · ✅ no runtime behavior changed · ✅ no certification status changed.
