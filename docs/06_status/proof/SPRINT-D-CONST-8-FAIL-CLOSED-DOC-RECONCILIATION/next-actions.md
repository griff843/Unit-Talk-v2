# Next Actions — Post D-CONST-8

## D-CONST-8: RESOLVED (this sprint)

No further action required for D-CONST-8.

## Remaining Open Constitutional Gaps

| Gap | Status | Next Action |
|---|---|---|
| D-CONST-3 — Missing cert records (P1/P4) | OPEN | `SPRINT-CERTIFICATION-STATE-RECONCILIATION-003` |
| D-CONST-4 — Proof gate string-bound | OPEN | Addressed by UTV2-1196 (execution-bound proof gate, merged) |
| D-CONST-5 — Edge as market echo | OPEN | P3 Decision Integrity remediation after constitutional convergence |
| D-CONST-6 — Ingestion stale | OPEN | Runtime hardening + ingestion restoration when SGO reactivated |
| D-CONST-7 — database.types.ts drift | IN PROGRESS | UTV2-1198 migration lane (Codex, in progress) |

## This Sprint's Independence from D-CONST-7

This sprint (D-CONST-8) operates on documentation files exclusively. It does not touch `packages/db/src/database.types.ts` or any migration files.

D-CONST-7 (UTV2-1198) and D-CONST-8 (UTV2-1199) can merge independently, in either order. No merge dependency between them.
