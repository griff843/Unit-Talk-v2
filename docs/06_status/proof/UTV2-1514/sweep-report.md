# UTV2-1514 Baseline / Sweep Report

MERGE_SHA: 3df47df9240a4608e82fd8defde6896885ae9338

Advisory evidence only, per `MECHANICAL_TIER_CLASSIFIER_SPEC.md` section 3 ("Merge-gate integration point"), step 5:
> Produce a baseline/sweep report — run the classifier against currently open lane PRs and recent merge history ... so PM can evaluate blast radius before any blocking behavior ships.

This report does **not** gate anything. `tier-classifier.ts` remains advisory-only in this lane (`.github/workflows/merge-gate.yml` has zero diff). No merge was blocked, re-labeled, or re-tiered as a result of running this sweep.

## Method

- Sample: the 20 most recently *done* lane manifests in `docs/06_status/lanes/` at the time of this PR (issue IDs UTV2-1449 through UTV2-1494), covering a mix of T1/T2/T3 declared tiers.
- For each sampled lane, the declared tier (`manifest.tier`) and changed-file list (`manifest.files_changed`, falling back to `manifest.file_scope_lock` when empty) were fed to:
  ```bash
  npx tsx scripts/ops/tier-classifier.ts --declared-tier <TIER> --files <comma-separated files>
  ```
- `derived_tier = max(declared_tier, mechanical_minimum(files))` was recorded per lane, along with which specific file(s) triggered escalation (sourced from the shared `merge-risk.ts` `TIER_C_EXACT_PATHS` / `TIER_C_PATH_PREFIXES` / `TIER_C_PATH_PATTERNS` authority — no forked list).

## Summary

| Metric | Value |
|---|---|
| Lanes sampled | 20 |
| Escalated (`derived_tier !== declared_tier`) | 9 (45%) |
| Not escalated | 11 (55%) |
| Escalations by declared tier | T1: 0/3, T2: 9/13 (69%), T3: 0/4 |
| Direction of all escalations observed | T2 → T1 (no T3 → T1/T2 observed in this sample; no de-escalation possible by design) |

**All escalations in this sample were T2 → T1.** No T1 lane was escalated further (already at ceiling), and no T3 lane in this sample happened to touch a Tier C path. This confirms the spec's monotonic-max property held throughout (`derived_tier` never fell below `declared_tier`).

## Per-lane results

| Issue | Declared | Mechanical minimum | Derived | Escalated? | Escalating path(s) |
|---|---|---|---|---|---|
| UTV2-1494 | T1 | T1 | T1 | no | (already T1) |
| UTV2-1493 | T1 | T3 | T1 | no | — |
| UTV2-1492 | T2 | T1 | **T1** | **yes** | `scripts/ops/lane-start.ts` |
| UTV2-1491 | T3 | T3 | T3 | no | — |
| UTV2-1490 | T3 | T3 | T3 | no | — |
| UTV2-1489 | T2 | T1 | **T1** | **yes** | `scripts/ops/lane-maximizer.ts` |
| UTV2-1488 | T3 | T3 | T3 | no | — |
| UTV2-1480 | T2 | T1 | **T1** | **yes** | `.github/workflows/db-health-tripwire.yml`, `.github/workflows/deploy.yml`, `.github/workflows/live-schema-parity.yml`, `.github/workflows/schema-baseline-dump.yml` |
| UTV2-1479 | T2 | T1 | **T1** | **yes** | `apps/worker/src/runner.ts`, `apps/worker/src/worker-runtime.test.ts` |
| UTV2-1476 | T2 | T1 | **T1** | **yes** | `.github/workflows/readiness-refresh.yml` |
| UTV2-1475 | T2 | T3 | T2 | no | — |
| UTV2-1474 | T2 | T1 | **T1** | **yes** | `scripts/ops/lane-maximizer.ts` |
| UTV2-1473 | T1 | T1 | T1 | no | (already T1) |
| UTV2-1466 | T2 | T1 | **T1** | **yes** | `scripts/ops/lane-execution.ts`, `scripts/ops/lane-maximizer.ts`, `scripts/ops/lane-start.ts` |
| UTV2-1464 | T2 | T3 | T2 | no | — |
| UTV2-1463 | T2 | T1 | **T1** | **yes** | `.github/workflows/post-merge-lane-close.yml` |
| UTV2-1462 | T2 | T1 | **T1** | **yes** | `.github/workflows/ci.yml` |
| UTV2-1461 | T2 | T3 | T2 | no | — |
| UTV2-1459 | T2 | T3 | T2 | no | — |
| UTV2-1449 | T3 | T3 | T3 | no | — |

## Interpretation (advisory only — no action taken)

- The escalations are concentrated in exactly the categories the spec's rule table intends to catch: `.github/workflows/*.yml` (dispatch/orchestration category — any workflow governing required checks) and `scripts/ops/lane-*.ts` / `scripts/ops/merge-*.ts` (the lane-lifecycle/dispatch tooling itself), plus `apps/worker/**` (runtime execution).
- This confirms the spec's own risk flag ("Overly broad globs risk grinding velocity to a halt"): if Phase 2 (blocking cutover) shipped as-is, roughly **69% of this sample's T2 lanes** — nearly all of which were routine governance/ops-tooling changes to `scripts/ops/*.ts` or CI workflow files — would newly require T1 ceremony (`t1-approved` label + `pm-verdict/v1`) purely because they touch a path already on the shared Tier C list, not because their actual risk changed.
- No T3 lane in this sample crossed into escalation, and no lane was ever pulled *down* — the no-downgrade invariant held for all 20 samples.
- This data is intended to inform PM's Phase 2 go/no-go decision (a separate, future PM-approved change per the spec) — e.g. whether `scripts/ops/**` broadly should carry the T1 floor, or whether a narrower carve-out (e.g. excluding pure dispatch/queue-management scripts from the runtime-risk category) is warranted before any blocking cutover. No such change is made in this lane.

## Reproduction

```bash
# Example: replay a single sampled lane (UTV2-1489, from its manifest's file_scope_lock)
npx tsx scripts/ops/tier-classifier.ts --declared-tier T2 \
  --files scripts/ops/lane-maximizer.test.ts,scripts/ops/lane-maximizer.ts
```

Full sweep driver used to produce this report's table (ad hoc, not committed — a reusable `--sweep`/batch mode is left as a follow-up since the spec did not require productizing the sweep tool itself, only the report as advisory evidence for this first implementation PR).
