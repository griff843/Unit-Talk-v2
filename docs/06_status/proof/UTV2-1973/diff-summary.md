# Diff summary: UTV2-1973

Implementation SHA: `cd23bc28724e8378d39d0da5470346518d0603f5`

## Summary

This support slice routes only the two exact governed NCAAF/WNBA participant-catalog
migration paths to a disposable-PostgreSQL seed drill. Every other migration continues
through the existing fail-closed DDL precondition path. The slice adds no catalog migration,
schema object, participant data, deployment, or delivery activation.

| File | Change |
|---|---|
| `.github/workflows/migration-reversibility-gate.yml` | Runs the adversarial seed tests and routes the two exact catalog paths to isolated databases; increments the drill count only after a passing seed proof. |
| `scripts/ci/participant-catalog-seed-drill.ts` | Captures schema and all-table baselines, then proves conflict refusal, frozen identities, idempotency, reference-safe rollback, exact restoration, stable reapply, and existing-ID preservation. |
| `scripts/ci/participant-catalog-seed-drill.test.ts` | Exercises both sport lifecycles and adversarial failures against disposable PostgreSQL, plus exact routing and DSN refusal tests. |

The implementation-only diff was measured with:

```text
$ git diff --stat origin/main...HEAD -- .github/workflows/migration-reversibility-gate.yml scripts/ci/participant-catalog-seed-drill.ts scripts/ci/participant-catalog-seed-drill.test.ts
 .github/workflows/migration-reversibility-gate.yml |  29 ++
 scripts/ci/participant-catalog-seed-drill.test.ts  | 348 +++++++++++++++
 scripts/ci/participant-catalog-seed-drill.ts       | 485 +++++++++++++++++++++
 3 files changed, 862 insertions(+)
```

## Boundaries

- Actual NCAAF and WNBA catalog migrations remain owned by UTV2-1971 and UTV2-1972.
- No production or remote database was accessed.
- Writable staging proof remains for the protected `staging-ci` GitHub environment.
- PM merge approval, merge, lane finalization, and post-merge reconciliation remain pending.

## SHA Binding

Execution SHA: `cd23bc28724e8378d39d0da5470346518d0603f5`
Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1729
