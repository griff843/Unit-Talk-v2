# WORK-2026092402 — Tier Label Check resolves repository-owned WORK identities

Tier: T1 (mechanical floor: `.github/workflows/`) · Lane type: governance · Executor: claude

## Problem

`.github/workflows/tier-label-check.yml` extracts the work identity with
`/(?:^|\/)((?:utv2|uni)-\d+)/i` and fails with "No issue ID found in PR branch or title" when that
finds nothing. `tier-label-apply.yml` re-validates the plan's id against `^(?:UTV2|UNI)-\d+$`.
Neither knows the repository-owned `WORK-###` identity that the ratified tracker-independence
correction introduced and that `merge-gate.yml` already accepts (#1570).

Measured over the last 100 runs: 62 of 62 on non-UTV2 branches failed, and 37 of 38 on UTV2
branches passed. Every open WORK PR shows a red Tier Label Check. The check is not required,
so nothing is blocked. But a check that is always red on the sanctioned path teaches reviewers to
ignore it.

The failure step also fails a second time: the "blocked tier state" comment gets 403
`Resource not accessible by integration` from `POST /issues/{n}/comments`.

## Outcome

- Both workflows resolve `UTV2-`, `UNI-` and `WORK-` identities with the same both-ends-bounded
  grammar `merge-gate.yml` uses, so `homework-123` and `work-123abc` still do not resolve.
- Nothing else changes: the tier still comes only from the lane manifest, and the apply workflow
  still validates every label against `^tier:T[123]$`.

## Acceptance

- `scripts/ci/tier-label-workflow.test.ts` (new, wired into `test:ops`) pins that both workflows accept WORK ids with the bounded grammar
  and that their grammars match merge-gate's. Reverting either regex turns a named test red.
