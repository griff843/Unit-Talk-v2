# Diff Summary: UTV2-1541

## Problem

`.lane/lanes/governance.yml`'s `allowed_path_globs` had two gaps, both flagged
during PM review of PR #1218 (UTV2-1536) and PR #1219 (UTV2-1537):

1. `AGENTS.md` was not in the allowlist at all.
2. The allowlist had `docs/06_status/incidents/**` (lowercase), but the repo's
   real incident-log directory has always been `docs/06_status/INCIDENTS/**`
   (uppercase — confirmed via `INC-2026-04-10-utv2-519-...md`, which predates
   this fix by three months). `matchesAny()` in `scripts/lane-contract.ts` calls
   `micromatch.isMatch(file, patterns, { dot: true })` with no `nocase` option,
   so the match is case-sensitive and the lowercase entry never matched anything
   real.

A File Scope Lock override cannot resolve either gap — Lane Authority
(`scripts/lane-check.ts` / `.github/workflows/lane-check.yml`) is a separate
control that reads `.lane/lanes/governance.yml` directly.

## Fix

`.lane/lanes/governance.yml`: added `AGENTS.md` and `docs/06_status/INCIDENTS/**`
to `allowed_path_globs`. The existing lowercase `docs/06_status/incidents/**`
entry was left in place (additive change, no removals).

## Tests

`scripts/lane-contract.test.ts`: 5 new tests loading the real
`.lane/lanes/governance.yml` via `loadLaneManifest('governance')` (not a
synthetic manifest) and asserting:

- `AGENTS.md` is now accepted
- `docs/06_status/INCIDENTS/INC-2026-07-14-example.md` is now accepted
- the legacy lowercase `docs/06_status/incidents/**` form still works
- an unrelated path (`apps/worker/src/something.ts`) is still rejected — no
  over-broadening
- a mixed-case near-miss (`docs/06_status/Incidents/...`) is still rejected —
  confirms matching stays case-sensitive rather than accidentally becoming
  case-insensitive as a side effect of this fix

## Scope

Implementation: `.lane/lanes/governance.yml`, `scripts/lane-contract.test.ts`.
No other governance.yml changes — kept narrowly scoped per this issue's own
declared intent, since UTV2-1536 and UTV2-1537 are both blocked on exactly
these two entries and nothing else.
