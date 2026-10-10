# Diff summary: UTV2-1973

## Approved closeout continuation

PM scope amendment comment 6100422279 explicitly authorizes only appending
`scripts/ci/participant-catalog-seed-drill.test.ts` to existing `test:ops`.
The desktop session made that exact append and updated issue-owned scope and
task-contract metadata. No dependency, lockfile or other package value changed.
The old package-wiring blocker in verification/evidence is historical. The
approved append is now committed and measured by the current proof results.

The previously cancelled, closed checkpoint was archived in ignored local
evidence before the sanctioned clear. PM's explicit continuation starts a fresh
execution epoch from the committed amended scope metadata; the pending package
append is the bounded substantive change for that epoch. Preserve prior failure
receipts in Git history and local evidence;
record genuinely completed phases and heartbeats via ops:exec-checkpoint using
the originating execution identity supplied in the environment. Finish bounded
verification and draft PR updates; no merge, deployment or catalog implementation.
Do not inspect unrelated historical proof bundles. Inspect only this issue's
proof, current validators and focused new test. Existing DDL regressions are in
`scripts/ci/migration-precondition-drill.test.ts` and
`scripts/ci/migration-reversibility-gate.test.ts`.
The disposable PostgreSQL installation described below is preserved but stopped;
start only that ignored local data directory for focused scratch tests if needed.
Local full verification must preserve the staging guard and record any refusal;
fresh protected CI must supply the sanctioned staging proof. Do not use production.

Implementation SHA: `ed8a0fa338fbcec427215bcd10376dd6effc075f`

## Summary

This support slice routes only the two exact governed NCAAF/WNBA participant-catalog
migration paths to a disposable-PostgreSQL seed drill. Every other migration continues
through the existing fail-closed DDL precondition path. The slice adds no catalog migration,
schema object, participant data, deployment, or delivery activation.

| File | Change |
|---|---|
| `.github/workflows/migration-reversibility-gate.yml` | Runs the adversarial seed tests and routes the two exact catalog paths to isolated databases; increments the drill count only after a passing seed proof. |
| `package.json` | Appends the focused participant seed drill test to the existing `test:ops` command without changing any other entry, dependency, or script name. |
| `scripts/ci/participant-catalog-seed-drill.ts` | Captures schema and all-table baselines, then proves conflict refusal, frozen identities, idempotency, reference-safe rollback, exact restoration, stable reapply, and existing-ID preservation. |
| `scripts/ci/participant-catalog-seed-drill.test.ts` | Exercises both sport lifecycles and adversarial failures against disposable PostgreSQL, plus exact routing and DSN refusal tests. |

The implementation-only diff was measured with:

```text
$ git diff --stat origin/main...HEAD -- .github/workflows/migration-reversibility-gate.yml package.json scripts/ci/participant-catalog-seed-drill.ts scripts/ci/participant-catalog-seed-drill.test.ts
 .github/workflows/migration-reversibility-gate.yml |  29 ++
 package.json                                       |   2 +-
 scripts/ci/participant-catalog-seed-drill.test.ts  | 348 +++++++++++++++
 scripts/ci/participant-catalog-seed-drill.ts       | 485 +++++++++++++++++++++
 4 files changed, 863 insertions(+), 1 deletion(-)
```

## Boundaries

- Actual NCAAF and WNBA catalog migrations remain owned by UTV2-1971 and UTV2-1972.
- No production or remote database was accessed.
- Writable staging proof remains for the protected `staging-ci` GitHub environment.
- PM merge approval, merge, lane finalization, and post-merge reconciliation remain pending.

## SHA Binding

Execution SHA: `ed8a0fa338fbcec427215bcd10376dd6effc075f`
Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1729
