# UTV2-1837 — Diff Summary

MERGE_SHA: pending merge

19 files changed, +1397 / -91 (measured `git diff --stat origin/main`).

## Source

| File | Change |
|---|---|
| `scripts/ops/preflight.ts` | PE2/PL1–PL6 report `skip` when no tracker credential is present; the declared `--tier` is raised by `classifyMechanicalMinimum()` and a tier below that floor is a hard `fail`. `runLinearChecks` and `resolveVerdict` exported so the branch is testable by calling it. |
| `scripts/ops/shared.ts` | `ISSUE_PATTERN` admits `WORK-###`; new `TRACKER_REF_PATTERN` (deliberately excludes `WORK-###`); `LaneManifest.tracker_ref`; new `resolveTrackerRef()` with three-valued semantics. |
| `scripts/ops/truth-check-lib.ts` | New `tracker_available` input. L1–L4 and C1 `skip` with no tracker; C7 keeps its manifest-vs-GitHub failure mode unconditionally. The `infra_error` early return on a missing token is gone — it aborted the checks that needed no tracker. |
| `scripts/ops/lane-close.ts` | New `LaneCloseTrackerSync` (`synced` / `skipped` / `not_eligible`) on the success result; the tracker transition is wrapped so a failure is recorded and warned rather than thrown after the lease has already been committed. |
| `scripts/ops/lane-finalize.ts` | `--apply-linear-tier-label` returns `tracker_sync: 'skipped'` and exit 0 on a missing token or a failed write, instead of throwing. |
| `scripts/ops/execution-packet.ts` | New `local-description` contract source kind; `readLocalTaskSource()` / `localTaskSourcePath()` reading `.ops/work/<ID>.md`, with `--description` > `--description-file` > file precedence; `captureOrReadTaskContract` and `resolveTaskContractAcrossRoots` consult it before the tracker. Identity regex at `:1124` widened to admit `WORK-###` — a fourth independent copy of the rule, found by a failing test. |
| `scripts/ops/lane-maximizer.ts` | `resolveCandidateSource()` falls back to the queue file when no tracker credential is present. |

## Schema and specs

| File | Change |
|---|---|
| `docs/05_operations/schemas/lane_manifest_v1.schema.json` | `issue_id` pattern admits `WORK-###`; new optional nullable `tracker_ref`. |
| `docs/05_operations/LANE_MANIFEST_SPEC.md` | New §17 — repo-owned work identity, `tracker_ref` three-valued semantics, and the known bound that a `WORK-###` lane is not yet mergeable. |
| `docs/05_operations/PREFLIGHT_SPEC.md` | New §3.4.1 — PE2 and PL1–PL6 with no credential, and the floor-not-waiver rule. |
| `docs/05_operations/TRUTH_CHECK_SPEC.md` | New §4.3.1 — tracker-ref resolution, which checks skip, and why C7 does not skip wholesale. |

## Tests

`scripts/ops/{preflight,shared,truth-check-lib,execution-packet,lane-maximizer,lane-close}.test.ts`
— +31 tests. Suite totals after the change: preflight 32, shared 93, truth-check-lib 132,
execution-packet 103, lane-maximizer 91, lane-close 180, lane-finalize 27 — all green.
Repo-wide: 5938 tests, 0 failures.

## Not changed

`merge-gate.yml`, `p0-protocol.yml`, `executor-result-validator.yml`, `tier-label-check.yml`,
branch protection, CODEOWNERS, the tier classifier's risk semantics, proof-bundle
requirements and lane isolation. Merge authority is a reserved surface.
