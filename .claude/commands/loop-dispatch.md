# /loop-dispatch

Continuous dispatch loop. Invokes `/dispatch-board` repeatedly until the board is empty, all remaining issues are blocked/external-gated, or a circuit breaker trips. Hard limit: 5 cycles per invocation.

**This skill orchestrates. It does not implement.** `/dispatch-board` owns the board read, routing, execution, and merge. `/loop-dispatch` owns cycle pacing, safety gates, circuit breakers, and exit reporting.

**Usage:**
- `/loop-dispatch` — run continuous dispatch until board empty or all blocked
- `/loop-dispatch --dry-run` — show what one cycle would dispatch (delegates to `/dispatch-board --dry-run`, no state change)
- `/loop-dispatch --cycles N` — override max cycles (max 10; values above 10 are clamped to 10)

**Arguments:** `$ARGUMENTS`

---

## Ownership boundary

**This skill owns the loop control plane. `/dispatch-board` owns the board loop. `/dispatch` owns the lane. `/three-brain` owns routing.** Never re-implement board reads, issue filtering, executor routing, or lane lifecycle here — call `/dispatch-board`.

---

## Phase 0: Live safety gates (all must pass before first cycle)

Run the live governor and reconciliation checks before dispatching any issue. Abort on any hard fail or block — do not proceed to Phase 1.

### Gate 1 — Merge risk

```bash
pnpm ops:merge-risk
```

If the report includes any `hard_fail` or `block` condition:

```
[loop-dispatch] HALTED — merge-risk blocked: {top condition}. Resolve the block before running /loop-dispatch.
```

### Gate 2 — Execution state

```bash
pnpm ops:execution-state
```

Use this report as the concurrency authority for active lanes by executor, available slots, blocked lanes, stale heartbeats, singleton blockers, merge mutex state, proof readiness, and recommended actions. If it reports a hard fail, block, unavailable merge mutex for a required merge action, or no available slot for the candidate executor:

```
[loop-dispatch] HALTED — execution-state blocked: {reason}. Resolve the block before running /loop-dispatch.
```

### Gate 3 — Lane maximizer

```bash
pnpm ops:lane-maximizer
```

Use this report as the dispatch recommendation authority. If it reports no safe dispatchable candidates, a hard fail, or a blocked wave plan:

```
[loop-dispatch] HALTED — lane-maximizer found no safe dispatch wave: {reason}.
```

### Gate 4 — Current-state reconciliation

```bash
pnpm ops:orchestration-reconcile --current --json
```

If the verdict is not pass, surface exactly one repair command from the first repair-plan action and stop before dispatching:

```
[loop-dispatch] HALTED — reconciliation drift detected.
Repair command: {first repair_plan action command | none available}
```

### Optional operator readout — Lane-governor summary

After the executable gates pass, the operator may ask the lane-governor agent for a concise summary. This is advisory only; the scripts above are the authority.

```typescript
Agent({
  subagent_type: "lane-governor",
  description: "Concurrency preflight before loop-dispatch",
  prompt: "Check current lane state and confirm headroom before loop-dispatch. Report: available Claude slots, available Codex slots, any forbidden combinations active, any file-scope locks that would broadly block dispatch. Be concise — one paragraph max."
})
```

Concurrency limits, singleton classes, and forbidden combinations come from `docs/governance/CONCURRENCY_CONFIG.json`; policy rationale lives in `docs/governance/LANE_CONCURRENCY_POLICY.md`. Do not copy numeric lane limits into this command.

---

## Phase 1: Cycle loop

After all four safety gates pass, begin the cycle loop.

Initialize state:
```
cycle_count      = 0
consecutive_zero = 0
max_cycles       = 5   (or --cycles N, clamped to 10)
```

### Cycle start

1. Increment `cycle_count`.
2. Re-run the live safety gates:
   ```bash
   pnpm ops:merge-risk
   pnpm ops:execution-state
   pnpm ops:lane-maximizer
   pnpm ops:orchestration-reconcile --current --json
   ```
   Stop before new dispatch on any hard fail/block. If reconciliation does not pass, surface exactly one repair command from the first repair-plan action.
3. Log cycle header:
   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   [loop-dispatch] Cycle {cycle_count}/{max_cycles} — {timestamp}
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```
4. Invoke `/dispatch-board` for one full cycle. Capture the cycle report (merges this cycle, awaiting PM, blocked, deferred).

### After each cycle

Parse the cycle report for merge count:

- **Merge count > 0:** reset `consecutive_zero` to 0.
- **Merge count = 0:** increment `consecutive_zero`.

**Circuit breaker — consecutive zero merges:**
If `consecutive_zero ≥ 2`:
```
[loop-dispatch] STALLED — two cycles with no merges. Check blocked lanes.
Run `pnpm ops:orchestration-reconcile --current --json` to inspect and repair stale state, then re-invoke /loop-dispatch.
```
Exit the loop.

**Circuit breaker — executor slot cap:**
After each cycle, re-run `pnpm ops:execution-state`. If the next recommended executor has no available slot and no active lane is ready to merge, pause: do not start the next cycle until a lane closes. Log:
```
[loop-dispatch] PAUSED — {executor} slots unavailable per CONCURRENCY_CONFIG.json. Waiting for a lane to close before next cycle.
```
Wait and re-check. Once a slot opens, resume.

**T1 gate — do not bypass:**
If `/dispatch-board` surfaces a T1 plan gate or T1 merge gate, `/loop-dispatch` must surface it to PM identically to how `/dispatch-board` would. Do not bypass, skip, or auto-approve T1 gates. The loop pauses at the gate until PM responds. After PM responds, the loop resumes if cycles remain.

### Board empty or all blocked check

After each cycle, run:

```bash
pnpm ops:digest --json 2>/dev/null || source local.env && export LINEAR_API_TOKEN && npx tsx scripts/ops/daily-digest.ts --json
```

Parse `dispatch_candidates`. If empty (all remaining issues are external-gated, blocked, or untiered):

```
[loop-dispatch] Board clear — no remaining dispatchable issues.
```

Exit the loop and proceed to Phase 2.

### Cycle-end reconciliation

Before deciding whether to run another cycle, run:

```bash
pnpm ops:orchestration-reconcile --current --json
```

If the verdict is not pass, stop the loop and surface exactly one repair command:

```
[loop-dispatch] HALTED — post-cycle reconciliation drift detected.
Repair command: {first repair_plan action command | none available}
```

### Cycle limit

After `cycle_count` reaches `max_cycles`:
```
[loop-dispatch] Cycle limit reached ({max_cycles}). Re-invoke /loop-dispatch to continue.
```
Exit the loop and proceed to Phase 2.

### Inter-cycle pause

If neither exit condition nor circuit breaker has fired: wait 270 seconds before the next cycle. This keeps loop actions within the Claude cache window and prevents runaway dispatch. Log the pause:

```
[loop-dispatch] Cycle {cycle_count} complete. Pausing 270s before next cycle.
```

---

## Phase 2: End-of-session report

After the loop exits (any reason), emit:

```
LOOP-DISPATCH — SESSION COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cycles run:       {cycle_count}
Exit reason:      {board_clear | cycle_limit | stalled | halted | t1_gate}
Total merged:     {N} (across all cycles)
Awaiting PM:      {N} T1 PR(s) open
Still blocked:    {N} issue(s)
External-gated:   {N} issue(s) deferred
Active lanes:     Claude {N}, Codex {N}, Unknown {N}
Available slots:  Claude {N}, Codex {N}
Blocked lanes:    {issue IDs or none}
CI/PM waiting:    {PR numbers and reason or none}
Recommendations:  {execution-state and lane-maximizer next recommendations}

Cycle breakdown:
  Cycle 1: {N} merged, {N} blocked, {N} deferred
  Cycle 2: ...

Next action:
  Board clear   → nothing; run /loop-dispatch again when new issues are Ready
  Cycle limit   → run /loop-dispatch to continue
  Stalled       → run `pnpm ops:orchestration-reconcile --current --json`, then /loop-dispatch
  T1 gate       → review T1 PR(s) and post PM_VERDICT; then /loop-dispatch
  Halted        → resolve the reported gate failure, then /loop-dispatch
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## --dry-run behavior

When invoked as `/loop-dispatch --dry-run`:

1. Run all live safety gates (abort on failure as normal).
2. Invoke `/dispatch-board --dry-run` once (shows routing table, no state change).
3. Print:
   ```
   [loop-dispatch] --dry-run complete. No lanes started. Re-invoke without --dry-run to execute.
   ```
4. Exit. Do not enter the cycle loop.

---

## Rules

- **Never bypass a T1 gate.** The loop pauses; PM must respond. This applies inside a continuous loop exactly as it does in a manual `/dispatch-board` run.
- **Hard limit: 5 cycles per invocation (default).** `--cycles N` overrides up to 10. This is a hard cap — no exceptions. Autonomous amplification of drift is worse than manual execution.
- **Live ops scripts are authoritative.** `ops:merge-risk`, `ops:execution-state`, `ops:lane-maximizer`, and `ops:orchestration-reconcile --current --json` must pass before each cycle starts.
- **Reconciliation gates bookend each cycle.** Start and end every cycle with `ops:orchestration-reconcile --current --json`; surface one repair command on drift.
- **CONCURRENCY_CONFIG.json owns lane limits.** Do not duplicate numeric executor caps in this command prose.
- **Executor slot caps pause, they do not abort.** The loop waits for a lane to close; it does not exit.
- **Two consecutive zero-merge cycles abort.** This prevents infinite loops against a permanently blocked board.
- **270-second inter-cycle pause is fixed.** Do not reduce it to speed up throughput — it exists to stay within the cache window and to allow manual intervention between cycles.
- **This skill owns the loop control plane only.** All board reads, routing, lane lifecycle, and merge operations are delegated to `/dispatch-board`, `/dispatch`, and `/three-brain`. Never re-implement them here.
