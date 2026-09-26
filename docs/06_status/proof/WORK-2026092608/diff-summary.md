# Diff summary: WORK-2026092608

Base `5710c8fe4`, code commit `28907a15e92785636e7565e5e69cab1dadb95781`. 7 files, +918 / -32.

| File | Change |
|---|---|
| `scripts/ops/shared.ts` | `defaultProofPaths` declares `diff-summary.md`, `evidence.json` and `verification.md` for T1 and T2 (T3 still declares none: its proof is green CI on the merge SHA), the set closeout P11/P3 and `ops:proof-generate` already demand. Only lane-start's declaration changes; manifests on disk keep their lists. |
| `scripts/ops/lane-start.ts` | Scaffolds `diff-summary.md` and `verification.md` (anchored with `Merge SHA: pending merge`, claiming nothing) instead of an empty `.gitkeep`, on both the new-lane and readmission paths. Adds a best-effort tracker transition to In Claude / In Codex after preflight and the manifest write; every failure is a warning, `WORK-###` lanes are skipped. Runs the terminal-lease sweep after preflight, before the first lease check. |
| `scripts/ops/lease-registry.ts` | `sweepTerminalLaneLeases`: releases active local leases whose lane manifest reads `done`/`superseded`/`cancelled`/`failed` (`origin/main` first, then local), recording actor and reason. `merged`, non-terminal, missing and unreadable lanes keep their lease. Never throws. |
| `scripts/ops/lane-start.test.ts` | Scaffold, honesty, no-overwrite, tracker (advance, skip, warnings, no-move) and call-order tests; the `.gitkeep` source assertion now asserts the scaffold instead. |
| `scripts/ops/lease-registry.test.ts` | Sweep tests: leaked `done` lease no longer refuses a start; non-terminal/merged/unknown/unreadable never released; every closed state released; unreadable registry is a warning. |
| `scripts/ops/shared.test.ts` | Default set for T1/T2, none for T3; an explicitly declared list is kept verbatim. |
| `scripts/ops/truth-check-lib.test.ts` | The default set passes P11 at T1 and T2 by filename alone. |

No truth-check gate, merge-gate, required check, CODEOWNERS or branch protection changed.
L3 is unchanged. No migration, no `package.json` edit.

`evidence.json` is not scaffolded by lane-start: its generator is `ops:proof-generate`,
which needs the execution SHA. T3 lanes are unchanged: they declare no bundle.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1660
Execution SHA: 28907a15e92785636e7565e5e69cab1dadb95781
