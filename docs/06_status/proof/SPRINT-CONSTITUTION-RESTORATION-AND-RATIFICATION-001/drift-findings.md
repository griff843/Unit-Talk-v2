# Drift Findings — Proof Summary

> SPRINT-CONSTITUTION-RESTORATION-AND-RATIFICATION-001 · 2026-06-02.
> Canonical drift audit: [`docs/00_constitution/CONSTITUTIONAL_DRIFT_AUDIT.md`](../../../00_constitution/CONSTITUTIONAL_DRIFT_AUDIT.md).

## The 8 constitutional drifts (ranked)

| ID | Drift | Severity | Constitution anchor |
|---|---|---|---|
| **D-CONST-1** | Repo cert docs use a non-constitutional program numbering ("P2 = WS-1.x") | **HIGH** | §18.3 (P2=Governance is authoritative) |
| **D-CONST-2** | Repo claims P3/P4 certified, but Linear `PROGRAM_1_FROZEN_SURFACE` still freezes "Program 3+"; no authorization lifts it | **HIGH** | §20.6 (stage activation needs proof of prerequisite cert) |
| **D-CONST-4** | `t1-proof-gate` greps the literal string `"test:db"`; DB-trigger proofs skip silently without service key | **HIGH** | §2.11, §10, §22 (proof must be executable; "advisory-as-enforcement" prohibited) |
| **D-CONST-6** | Live ingestion ~11.7d stale — the exact "daemon looping empty while healthy" anti-pattern | **HIGH (operational)** | §22, §4.1, §4.14 |
| **D-CONST-3** | P1 cert exists only in Linear; P4 cert only as manifest annotations; no canonical repo cert docs | **MEDIUM** | §10 (SHA-bound per-program cert) |
| **D-CONST-5** | Edge is a market-consensus echo; zero realized profitability | **MEDIUM (mission)** | §4.6, §4.19 ("profit alone is not proof of edge") |
| **D-CONST-7** | `database.types.ts` missing `execution_intents` + `settlement_corrections` (live) | **MEDIUM** | §7 (canonical domain model) |
| **D-CONST-8** | `packages/db/CLAUDE.md` + `packages/contracts/CLAUDE.md` say "fail-open"; code is fail-closed | **LOW** | §8.4 (prod repos must fail closed) |

## The key reconciliation the constitution provides
The recovered constitution **resolves the program-numbering dispute from the earlier readiness audit.** §18.3 explicitly defines Program 2 = Governance Convergence, Program 3 = Decision Integrity, Program 4 = Execution & Economic Truth. This matches the Linear initiative scheme and makes the repo cert docs' "P2 = WS-1.x" labeling **drift to fix**, not an alternative truth. **The constitution is the tie-breaker, and it has now spoken.**

## Safety-vs-intelligence drift conclusion
Unit Talk converged the **constitutional safety surface** (truth, governance, lifecycle, replay, settlement) into real enforcement code, but the **constitutional intelligence surface** (feature→edge→economic attribution) remains scaffolded and aspirational. The drift is not random — it is the gap between "cannot silently lie" (largely achieved) and "can prove it wins" (not yet).

## Important: no certification status was changed
This audit **reports** drift. It does not revoke, grant, or alter any certification. D-CONST-1/2/3 require **PM** action (ratify numbering, author cert docs, authorize-or-freeze P3+). Until then, per §4.17/§20.6, capital (P5-C/P5-D) **stays frozen**.
