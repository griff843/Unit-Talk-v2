# UTV2-1514 Diff Summary

## Summary

- Added `scripts/ops/tier-classifier.ts`, a pure advisory mechanical tier classifier that computes `derived_tier = max(declared_tier, mechanical_minimum(diff))`.
- Exported and extended the shared Tier C path authority in `scripts/ops/merge-risk.ts` so the classifier does not fork a parallel sensitive-path list.
- Added `scripts/ops/tier-classifier.test.ts` with regression coverage for T1 escalation, no downgrade behavior, shared-constant sourcing, and advisory-first output.
- Added `.github/workflows/tier-classifier-advisory.yml`, a new non-required workflow that runs the classifier on every PR and posts a separate, always-neutral-or-success informational check-run surfacing the derived tier and any escalation (see "Advisory CI wiring" below). `.github/workflows/merge-gate.yml`'s tier-consumption logic (`authoritativeTier`) is untouched.

## Diff Scope

- `package.json` (wire `scripts/ops/tier-classifier.test.ts` into the `test:ops` script list)
- `scripts/ops/merge-risk.ts`
- `scripts/ops/tier-classifier.ts`
- `scripts/ops/tier-classifier.test.ts`
- `.github/workflows/tier-classifier-advisory.yml`
- `docs/06_status/proof/UTV2-1514/diff-summary.md`
- `docs/06_status/proof/UTV2-1514/verification.md`
- `docs/06_status/proof/UTV2-1514/sweep-report.md`

## Advisory Classifier Dry Run

Command:

```bash
npx tsx scripts/ops/tier-classifier.ts --declared-tier T2 --files scripts/ops/merge-risk.ts,scripts/ops/tier-classifier.ts,scripts/ops/tier-classifier.test.ts
```

Result:

- `declared_tier`: `T2`
- `mechanical_minimum`: `T1`
- `derived_tier`: `T1`
- `advisory.conclusion`: `neutral`
- Escalating matches: `scripts/ops/merge-risk.ts`, `scripts/ops/tier-classifier.ts`
- Test-only file `scripts/ops/tier-classifier.test.ts` did not trigger the orchestration implementation pattern.

## Advisory CI wiring (PM decision, post-review)

A Codex-return review of PR #1179 flagged that the classifier, as first implemented, only ran as a manual CLI + a one-time sweep report -- no workflow invoked it automatically, so Phase 1's own acceptance criterion ("produces a report/annotation") never actually surfaced on normal PRs. PM decision: wire it in this lane, without touching `merge-gate.yml`'s tier-consumption logic.

`buildAdvisoryCheckRunOutput()` (new, exported from `tier-classifier.ts`, covered by 2 new unit tests) is a pure formatter that turns a `TierClassification` into a GitHub check-run `{ title, summary, conclusion }`. It is wired into the CLI's JSON output (`check_run` key) so the workflow never has to reimplement the formatting logic in inline JS.

`.github/workflows/tier-classifier-advisory.yml`:
- Triggers on the same PR events as `Return Review Packet` (opened/synchronize/reopened/labeled/unlabeled/ready_for_review).
- Resolves the declared tier from the lane manifest (`docs/06_status/lanes/<ISSUE>.json`), falling back to the PR's `tier:T1`/`T2`/`T3` label; skips (no-op, non-blocking) if neither is resolvable.
- Runs `scripts/ops/tier-classifier.ts --declared-tier <tier> --base origin/<base> --head <head-sha>` and posts its `check_run` output as a **separate**, non-required check-run named "Tier Classifier (advisory)" via `actions/github-script`'s `checks.create`.
- `conclusion` is always `success` or `neutral` (never `failure`) -- the job itself also always completes successfully regardless of whether escalation occurred, matching the same "informational, not required" pattern as `Return Review Packet` / `Readiness Regression Gate`.
- Not added to branch protection's `required_status_checks` (confirmed: that list is unchanged, still exactly `verify`, `Executor Result Validation`, `Merge Gate`, `P0 Protocol`).
- `.github/workflows/merge-gate.yml` has zero diff in this lane -- `authoritativeTier` (lines ~144/200) remains the sole blocking-gate input; Phase 2 (wiring `derived_tier` into that blocking logic) is explicitly out of scope here and requires its own future PM approval.

## Baseline / Sweep Report (spec section 3, step 5)

Per PM decision, `docs/06_status/proof/UTV2-1514/sweep-report.md` runs the classifier against the 20 most recent *done* lane manifests (UTV2-1449 through UTV2-1494, a mix of T1/T2/T3) as advisory evidence for the Phase 2 (blocking) go/no-go decision. Summary: 9/20 lanes (45%) would have been escalated, all T2 → T1, concentrated in `.github/workflows/*.yml` and `scripts/ops/lane-*.ts`/`merge-*.ts` paths. No T1 lane was escalated further and no T3 lane crossed into escalation in this sample — the no-downgrade invariant held throughout. See the full report for the per-lane table and interpretation.
