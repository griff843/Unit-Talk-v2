# Diff Summary: UTV2-1573

## Files changed

| File | Change |
| --- | --- |
| `.github/workflows/executor-result-validator.yml` | Replaced a single-page `checks.listForRef` call with paginated `github.paginate(..., { per_page: 100, filter: 'latest' })`; replaced inline `.find()` selection with `selectLatestVerifyCheckRun()` from the new module. Existing fail-closed branches and error messages unchanged. |
| `scripts/ops/executor-result-check-selection.cjs` | New. Pure `selectLatestVerifyCheckRun(checkRuns)` -- filters to `name === 'verify' && app.slug === 'github-actions'`, returns the highest-`id` (newest) match, or `null`. |
| `scripts/ops/workflow-hardening.test.ts` | 5 new tests: pagination-not-single-page (structural), found-past-30, found-past-100, wrong-app-ignored, newest-of-duplicates-governs, fail-closed-on-missing/incomplete/failed. |
| `docs/06_status/lanes/UTV2-1573.json`, `.ops/sync/UTV2-1573.yml`, `docs/06_status/proof/UTV2-1573/*` | This lane's own manifest, sync record, and proof bundle. |

## Not changed

- `scripts/ops/executor-result-validate.ts` (check-name resolution logic) -- untouched.
- The unrelated lane where the defect was observed -- branch, commits, and manifest untouched by this lane.
- Any product/runtime application code.
- Branch protection configuration or required status-check contexts.

## Why

The required `Executor Result Validation` check fetched a commit's
check-runs without pagination, so on commits with more than 30 check-runs
(routine on this repo) it could report a genuinely successful `verify` run
as "not found," failing the required check for reasons unrelated to the
PR's actual state. Reproduced live on an unrelated, already-approved lane
with 67 total check-runs. Confirmed pre-existing on `main` and unrelated to
that lane's content.

Full rationale, discovery detail, and assertion-by-assertion evidence: `verification.md`.
