# Diff summary: WORK-2026102205

Tier: T1. Verified source anchor: `76dc875a142b5589da21dbe317c967ec80497c28`.

This lane adds a fail-closed alternate for migrations that only change one existing
view's `security_invoker` option and table privileges. It does not modify PR #1775,
any migration, merge authority, production state, kill switch, or Discord recap.

| File                                                 | Change                                                                                                                                                                                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/migration-reversibility-gate.yml` | Runs the scratch-Postgres adversarial suite, routes a valid privilege-only marker before the unchanged legacy marker greps, and retains fail-closed proof binding for canonical UTV2/UNI/WORK lane IDs.                                                   |
| `scripts/ci/privilege-only-view-drill.ts`            | Adds the anchored marker parser, comment/string-aware statement splitter, strict single-view classifier, exact-template role-guard `DO` match (after seven review rounds showed token allowlists were bypassable), and positive up/down/up scratch drill. |
| `scripts/ci/privilege-only-view-drill.test.ts`       | Copies the PR #1775 migration text inline and covers valid classification, forbidden SQL, state tampering, rollback failure, and unresolved/non-view targets.                                                                                             |
| `package.json`                                       | Adds a directly runnable focused test command.                                                                                                                                                                                                            |
| `docs/06_status/proof/WORK-2026102205/*`             | Records measured T1 evidence and model-routing provenance.                                                                                                                                                                                                |

The primary implementation commit contains four files and 1,193 insertions; the
follow-up source commit fixes canonical `WORK-*` proof identity recognition found
by the first protected workflow run. Existing
`migration-precondition-drill.test.ts` and `participant-catalog-seed-drill.test.ts`
remain unchanged and pass in the focused combined run.

## SHA Binding

Verified source SHA: `76dc875a142b5589da21dbe317c967ec80497c28`

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1776
