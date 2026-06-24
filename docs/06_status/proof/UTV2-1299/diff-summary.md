# UTV2-1299 — Diff Summary

**Lane:** UTV2-1299 — Harden `/loop-dispatch` into a true board-clearing orchestrator (loop-level Done governance)
**Tier:** T2 · **Lane type:** governance · **Executor:** Claude
**Branch:** `griffadavi/utv2-1299-harden-loop-dispatch`
**PR:** #1053 · **Merge SHA:** `35fca9e32850f120fa456609782abb2a80b9e7ac`

## Scope

Governance/ops command-prose hardening only. **No runtime behavior change, no deploy, no DB mutation, no code/TS change.** Two command definitions and a proof bundle.

## Files changed

| File | Change |
|---|---|
| `.claude/commands/loop-dispatch.md` | Substrate guard, Codex-return harvest, progress-vector stall breaker, per-lane PM-gate pause, loop-level Done assertion + active-lane truth, expanded terminal-state report, Rules |
| `.claude/commands/dispatch-board.md` | Pre-merge truth-check wording fix, PM-gate Gate matrix + T2 risk-class matrix, PM-gate scope, Rules |
| `docs/06_status/proof/UTV2-1299/diff-summary.md` | This file |
| `docs/06_status/proof/UTV2-1299/verification.md` | Verification record |

## Findings → changes (audit + PM audit, 9 items)

1. **Loop-level Done missing** → `loop-dispatch.md` Phase 2 "Loop-level Done assertion": every touched issue must resolve to exactly one terminal-or-running bucket; `merged-but-not-closed` or unaccounted-for ⇒ not Done.
2. **Codex completion defect** → cycle-start step 4 harvests Codex returns via `/dispatch-board --check-codex` **before** new dispatch; feeds the progress vector.
3. **Progress-metric defect** → merge-count-only breaker replaced by a 9-field **progress vector**; `consecutive_noprog` increments only when *all* fields are zero; STALL after two such cycles.
4. **Missing substrate guard** → `pnpm ops:substrate-guard --check-linear` added to Phase 0 (Gate 0) and every cycle start.
5. **Active-lane truth** → a lane is *executing* only with Linear `In *` AND manifest AND lease AND worktree AND branch AND fresh heartbeat; otherwise staged/diagnosed/drifted.
6. **Truth-check wording drift** → `dispatch-board.md` Phase 5 no longer calls `ops:truth-check` pre-merge; pre-merge gates on verification + proof-check + merge-ready + R-level; `ops:lane-close` runs `ops:truth-check` (done-gate, against merge SHA) post-merge.
7. **PM-gate behavior** → a PM gate pauses **only the gated lane** unless it holds a singleton / file-scope / runtime / migration / data-canonical lock or the merge mutex; safe unrelated lanes continue.
8. **T2 risk-class gate matrix** → explicit matrix added to `dispatch-board.md` (docs/spec · hygiene/config · monitoring/read-only · runtime/deploy · DB/retention · T1 · P0).
9. **Final-report accounting** → Phase 2 report broken into board candidates · staged · actually executing · Codex dispatched · Codex returned/reviewed · open PRs · awaiting PM · merged-but-not-closed · Done · blocked/stale/mismatched · next action.

## Constraints honored

No runtime behavior change · no production deploy · no DB mutation · no P3 certification · UTV2-1042 untouched · no CLV/ROI/edge claims · no public Discord · no backfill · no secrets. The trial-governor concurrency toggle used to open the 3rd Claude slot is **not** part of this lane's diff (kept out of `file_scope_lock`; operational change in the control-plane checkout).

## Grep proof (the five required assertions)

Reproduce from the worktree:

```bash
LD=.claude/commands/loop-dispatch.md ; DB=.claude/commands/dispatch-board.md
grep -n "ops:substrate-guard" $LD                      # 1 substrate-guard present
grep -n "check-codex\|Harvest Codex returns first" $LD # 2 harvest before dispatch
grep -n "consecutive_noprog\|progress vector" $LD       # 3 progress-vector breaker
grep -n "Terminal-state assertion\|merged-but-not-closed\|Loop-level Done" $LD  # 4 terminal-state accounting
grep -n "post-merge done-gate\|ops:merge-ready" $DB     # 5 pre-merge truth-check removed
```

Captured output: see `verification.md`.
