# Runtime Verification — UTV2-1099

## Verification

Branch: claude/utv2-1099-init-214-dependent-gate-certification-checks
Commit SHA (branch HEAD): 4a82a60ea38ac6f8faad39e8e510c7aae83a79c9
Merge SHA (main): e3a247e13c2f65c90676c816dc1e231d9d1ea475

Scope: DependentGateChecker — constitutional dependent-gate certification checks
for the 7-domain ACTIVE_CERT chain (INIT-2.1.4).

pnpm verify: EXIT 0 (all 113 unit tests pass)

## pnpm test:db

```
1..7
# tests 7
# pass 7
# fail 0
# duration_ms ~24000
```

7/7 live Supabase tests pass. No new DB migrations introduced.
Certification tables (certification_records, certification_transition_events)
confirmed present and queryable in live Supabase project ref zfzdnfwdarxucxtaojxm.

## Runtime Note

DependentGateChecker is a pure in-memory gate enforcer with no I/O. Runtime
verification confirms: (1) pnpm test:db green — no regressions from gate layer,
(2) certification tables accessible in live Supabase project ref zfzdnfwdarxucxtaojxm,
(3) acyclicity invariant holds on DOMAIN_DEPENDENCIES graph (verified at module load),
(4) all 7 certification domains correctly resolve their dependency states.

Constitutional constraints verified (per PM approval 2026-05-26):
- [x] Dependency graph verified acyclic at module load
- [x] All gate failures fail closed (missing/revoked/expired/pending = denied)
- [x] DependentGateEvent is replay-visible (replaySafe: true)
- [x] No implicit certification inheritance
- [x] Downstream revocation computes transitively (computeDownstreamRevocations)
- [x] checkProgramGates() is the CI-gate view (pnpm ops:cert-check)
