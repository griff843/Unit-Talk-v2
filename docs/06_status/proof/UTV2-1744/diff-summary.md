# UTV2-1744 — diff summary

MERGE_SHA: df4cf115c6de564bf129847f1296325c0ba976ce

## Files changed

| File | Lines | Purpose |
|---|---|---|
| `scripts/ops/outbox-triage.ts` | +330 | Read-only `distribution_outbox` triage: dead-letter classifier, fail-closed target verifier, per-target stuck-claim analyser, and a replay verdict function with no approving branch. CLI issues one `SELECT`. |
| `scripts/ops/outbox-triage.test.ts` | +240 | 12 tests, each proving a control fails on the condition it names. Fixture mirrors the real `distribution_outbox` Row type field for field and reproduces the exact 2026-08-26 production population. |
| `docs/06_status/proof/UTV2-1744/verification.md` | new | Proof bundle: assertions, mutation evidence, live runtime evidence, findings. |
| `docs/06_status/proof/UTV2-1744/diff-summary.md` | new | This file. |
| `docs/06_status/proof/UTV2-1744/evidence.json` | new | Schema v2 evidence with SHA binding. |
| `docs/06_status/proof/UTV2-1744/model-routing.json` | new | Model routing record (generated at lane start). |
| `docs/06_status/lanes/UTV2-1744.json` | new | Lane manifest. |
| `.ops/sync/UTV2-1744.yml` | new | Per-issue sync metadata. |

## What this lane does NOT change

No production data is written. No worker, adapter, queue, or delivery path is
modified. No existing module imports the new script; it is a standalone
read-only operator tool. `apps/worker`, `packages/db`, and every delivery
surface are untouched.

## Behavioural surface

- `classifyDeadLetter(reason)` → one of six classes; null/blank maps to
  `unclassified_null_reason`, unmatched maps to `unrecognised`.
- `isMemberFacingTarget(target)` → true for anything not a reviewed canary
  prefix. Fails closed on unknown targets.
- `verifyTargets(rows)` → `safe` only when no `pending`/`processing` row targets
  a member-facing channel. Dead letters are excluded: they are inert unless
  replayed, and nothing here replays them.
- `analyseStuckClaims(rows, {now, configuredTargets, staleClaimMs})` → claims
  held strictly longer than the threshold, with `reachableByReaper` computed
  from the worker's configured target set.
- `replayVerdict(class)` → always `approved: false`, with a class-specific
  reason. No approving branch exists.
- `buildTriageReport(rows, options)` → `anyClassApprovedForReplay` typed as the
  literal `false`.

## Correction made during the lane

The first draft filtered the read with `.neq('status', 'delivered')`. Production
has no `delivered` status — the terminal status is `sent`. The filter matched
nothing and pulled all 3,758 terminal rows into the triage read. Fixed to
`.in('status', ['pending', 'processing', 'dead_letter'])`, with the terminal
status exported as `TERMINAL_STATUS` and pinned by two regression tests.
