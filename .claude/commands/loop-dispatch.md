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

### Gate 0 — Lane substrate

`/dispatch` runs the substrate guard before it starts a lane; the loop must do the same before it starts a *board* of lanes. Run it first:

```bash
pnpm ops:substrate-guard --check-linear
```

This validates the lease dir, merge-lock, active-lane worktree integrity, board hard-fail state, and (with `--check-linear`, when `LINEAR_API_TOKEN` is present) manifest↔Linear drift. On any `hard_fail`:

```
[loop-dispatch] HALTED — substrate unsafe: {top finding}. Run `pnpm ops:substrate-guard` for detail and resolve before /loop-dispatch.
```

If `--check-linear` reports `linear_check_skipped` (no token), do not treat the board as reconciled on the strength of substrate-guard alone — Gate 4 (`ops:orchestration-reconcile --current`) remains the Linear/manifest drift authority.

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
cycle_count        = 0
consecutive_noprog = 0          # cycles with an all-zero progress vector
max_cycles         = 5          # (or --cycles N, clamped to 10)
touched_issues     = {}         # issue_id → terminal-state accounting (Phase 2)
```

**Progress vector.** Each cycle produces a progress vector — the loop's unit of "did anything advance," replacing the old merge-count-only signal. Fields (all integers, per cycle):

```
lanes_dispatched         # new lanes started this cycle
prs_opened               # PRs opened this cycle
codex_returns_harvested  # finished Codex PRs picked up via --check-codex
prs_reviewed             # PRs diff-reviewed (Claude review or PM gate surfaced)
prs_merged               # PRs merged
lanes_closed             # ops:lane-close completed
pm_gates_surfaced        # T1/PM gates raised to PM this cycle
blocked_lanes_repaired   # lanes moved out of blocked via reconcile repair
stale_lanes_reconciled   # ghost/orphan lanes reconciled to a coherent state
```

A cycle **made progress** if any field is non-zero. Merges are one field among nine — a Codex-heavy or PM-gated cycle that opens PRs, harvests returns, or reconciles drift is progress even with `prs_merged = 0`.

### Cycle start

1. Increment `cycle_count`.
2. Re-run the live safety gates:
   ```bash
   pnpm ops:substrate-guard --check-linear
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
4. **Harvest Codex returns first — before any new dispatch.** Codex lanes close only on the `--check-codex` re-entry; plain `/dispatch-board` dispatches them but never closes them. If `ops:execution-state` shows any active Codex lane with an open PR, run:
   ```bash
   /dispatch-board --check-codex
   ```
   This reviews/merges/closes finished Codex PRs and feeds `codex_returns_harvested`, `prs_reviewed`, `prs_merged`, and `lanes_closed` into this cycle's progress vector. Skipping this is the root cause of the false-STALL on Codex-heavy boards: work was dispatched but never harvested, so merge count read zero. Record every issue touched here into `touched_issues`.
5. Invoke `/dispatch-board` for one full cycle of new dispatch. Capture the cycle report (lanes dispatched, PRs opened, merges, awaiting PM, blocked, deferred) and fold its counts into this cycle's progress vector. Record every issue touched into `touched_issues`.

### After each cycle

Assemble this cycle's progress vector from the harvest step (4) and the dispatch step (5):

- **Any field non-zero** (a lane dispatched, PR opened, Codex return harvested, PR reviewed/merged, lane closed, PM gate surfaced, blocked lane repaired, or stale lane reconciled): reset `consecutive_noprog` to 0.
- **All fields zero:** increment `consecutive_noprog`.

**Circuit breaker — no progress (not "no merges"):**
If `consecutive_noprog ≥ 2`:
```
[loop-dispatch] STALLED — two cycles with an all-zero progress vector (no dispatch, no PR, no Codex harvest, no merge, no close, no reconcile). Check blocked lanes.
Run `pnpm ops:orchestration-reconcile --current --json` to inspect and repair stale state, then re-invoke /loop-dispatch.
```
Exit the loop. Do **not** STALL on `prs_merged = 0` alone — a cycle that harvested Codex returns, opened PRs, surfaced a PM gate, or reconciled drift made progress and must continue.

**Circuit breaker — executor slot cap:**
After each cycle, re-run `pnpm ops:execution-state`. If the next recommended executor has no available slot and no active lane is ready to merge, pause: do not start the next cycle until a lane closes. Log:
```
[loop-dispatch] PAUSED — {executor} slots unavailable per CONCURRENCY_CONFIG.json. Waiting for a lane to close before next cycle.
```
Wait and re-check. Once a slot opens, resume.

**PM gate — pause the lane, not the loop:**
If `/dispatch-board` surfaces a T1 plan gate, a T1 merge gate, or any PM-visible gate (see the T2 risk-class matrix in `/dispatch-board`), `/loop-dispatch` surfaces it to PM identically and records `pm_gates_surfaced`. Never bypass, skip, or auto-approve a PM gate.

The gate pauses **only the gated lane** — it does not halt the loop — *unless* the gated lane holds a singleton / file-scope / runtime / migration / data-canonical lock or the merge mutex, in which case lanes it conflicts with also wait. Safe, unrelated lanes (docs/spec, hygiene, read-only monitor) continue to dispatch and close in the same and subsequent cycles. The gated lane sits in `awaiting PM` accounting until PM responds; the loop resumes full dispatch for it once a verdict lands and cycles remain.

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

## Phase 2: Loop-level Done assertion

Lane-level Done is mechanical and strong (`ops:truth-check` + `ops:lane-close`). The loop adds a **loop-level Done** check that lane-level Done cannot give: *every issue this session touched is now in a coherent terminal-or-running state.* Counting merges is not enough — a board-clearing orchestrator must not leave an issue it started in limbo.

### Active-lane truth (classify before reporting)

Before the report, classify every issue in `touched_issues`. A lane may be reported **executing** only if **all** of these hold:

```
Linear state ∈ {In Claude, In Codex}
  AND lane manifest exists (docs/06_status/lanes/UTV2-###.json, non-done status)
  AND lease exists (.ops/leases/UTV2-###.json)
  AND worktree exists (git worktree list)
  AND branch exists (local or remote)
  AND heartbeat is fresh (per execution-state staleness threshold)
```

If any element is missing, the lane is **not executing** — classify it precisely instead:

- **staged** — substrate provisioned (branch/worktree/manifest) but no work product and Linear not `In *` (e.g. lane-start ran, then Linear reverted to `Ready`).
- **diagnosed** — analysis done, no branch/commit yet.
- **drifted** — manifest, Linear, and GitHub disagree (merged-but-`In Claude`, manifest-`started` but Linear `Ready`, branch with no PR, etc.).

Never report a staged/diagnosed/drifted lane as "executing." A drifted lane is a finding, not a running lane — surface it and let the next reconcile repair it. (`ops:execution-state` infers "active" from the manifest alone; this classification is stricter on purpose and is the loop's defense against the ghost-lane class.)

### Terminal-state assertion

Every touched issue must resolve to exactly one bucket:

```
Done                  # merged + ops:lane-close ran (truth-check exit 0)
merged-but-not-closed # PR merged, lane-close not yet run → REPAIR before exit
awaiting-PM           # PM/T1 gate surfaced, verdict pending
blocked               # specific failing check or linked blocker
external-gated        # needs:operator-action | needs:live-data | needs:hetzner
executing             # passes active-lane truth above (valid running lane)
staged/diagnosed/drifted   # NOT executing — surface as drift to reconcile
```

If any touched issue fits **none** of these buckets, or sits in **merged-but-not-closed**, the loop is not Done. Run `pnpm ops:orchestration-reconcile --current --json` and complete the closeout (or surface the exact repair command) before emitting the session report. Do not report `board_clear` while a touched issue is unaccounted-for.

## Phase 2 report: End-of-session

After the assertion passes (or its unresolved items are surfaced), emit:

```
LOOP-DISPATCH — SESSION COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cycles run:           {cycle_count}
Exit reason:          {board_clear | cycle_limit | stalled | halted | pm_gate}

— Board —
Board candidates:     {N} dispatchable at session start
Staged lanes:         {issue IDs — substrate but not executing, or none}
Actually executing:   {issue IDs that pass active-lane truth, or none}

— Codex —
Codex dispatched:     {issue IDs this session}
Codex returned/rev'd: {issue IDs harvested via --check-codex}

— PR / merge state —
Open PRs:             {PR#→issue, or none}
Awaiting PM:          {issue IDs + PR# — gate surfaced, verdict pending}
Merged but not closed:{issue IDs — REPAIR, none expected at clean exit}
Done this session:    {issue IDs — merged + lane-closed}

— Drift —
Blocked/stale/mismatched: {issue IDs + one-line reason, or none}

— Progress (vector totals across all cycles) —
dispatched {N} · prs_opened {N} · codex_harvested {N} · reviewed {N} · merged {N} · closed {N} · pm_gates {N} · repaired {N} · reconciled {N}

— Executor state (from ops:execution-state) —
Active lanes:     Claude {N}, Codex {N}, Unknown {N}
Available slots:  Claude {N}, Codex {N}
Blocked lanes:    {issue IDs or none}
CI/PM waiting:    {PR numbers and reason or none}
Recommendations:  {execution-state and lane-maximizer next recommendations}

Cycle breakdown:
  Cycle 1: vector {dispatched/opened/harvested/reviewed/merged/closed/...}
  Cycle 2: ...

Next action:
  Board clear   → nothing; run /loop-dispatch again when new issues are Ready
  Cycle limit   → run /loop-dispatch to continue
  Stalled       → run `pnpm ops:orchestration-reconcile --current --json`, then /loop-dispatch
  PM gate       → review the gated PR(s) and post PM_VERDICT; then /loop-dispatch
  Halted        → resolve the reported gate/substrate failure, then /loop-dispatch
  Drift found   → run the surfaced repair command, then /loop-dispatch
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

- **Substrate guard runs first.** `pnpm ops:substrate-guard --check-linear` gates Phase 0 and every cycle start, exactly as `/dispatch` runs it before a single lane. A `hard_fail` halts the loop.
- **Harvest Codex returns before new dispatch.** Each cycle runs `/dispatch-board --check-codex` before `/dispatch-board`, because Codex lanes close only on the `--check-codex` re-entry. Dispatching Codex without harvesting is the bug that makes a working board look stalled.
- **Progress is a vector, not a merge count.** STALL only when the whole progress vector is zero for two consecutive cycles. A cycle that harvested a Codex return, opened a PR, surfaced a PM gate, or reconciled drift made progress — never STALL it on `prs_merged = 0`.
- **Never bypass a PM gate.** Surface T1 plan/merge gates and any PM-visible gate (per the `/dispatch-board` T2 risk-class matrix). A PM gate pauses **only the gated lane** unless it holds a singleton / file-scope / runtime / migration / data-canonical lock or the merge mutex; safe unrelated lanes keep moving.
- **Loop-level Done is asserted, not assumed.** Before exit, every touched issue must land in exactly one terminal-or-running bucket (Done / awaiting-PM / blocked / external-gated / executing) and pass active-lane truth. `merged-but-not-closed` or unaccounted-for issues mean the loop is not Done — repair before reporting.
- **Active-lane truth is strict.** Report a lane as *executing* only with Linear `In *` AND manifest AND lease AND worktree AND branch AND fresh heartbeat. Anything weaker is staged / diagnosed / drifted — a finding, not a running lane.
- **Hard limit: 5 cycles per invocation (default).** `--cycles N` overrides up to 10. This is a hard cap — no exceptions. Autonomous amplification of drift is worse than manual execution.
- **Live ops scripts are authoritative.** `ops:substrate-guard`, `ops:merge-risk`, `ops:execution-state`, `ops:lane-maximizer`, and `ops:orchestration-reconcile --current --json` must pass before each cycle starts.
- **Reconciliation gates bookend each cycle.** Start and end every cycle with `ops:orchestration-reconcile --current --json`; surface one repair command on drift.
- **CONCURRENCY_CONFIG.json owns lane limits.** Do not duplicate numeric executor caps in this command prose.
- **Executor slot caps pause, they do not abort.** The loop waits for a lane to close; it does not exit.
- **270-second inter-cycle pause is fixed.** Do not reduce it to speed up throughput — it exists to stay within the cache window and to allow manual intervention between cycles.
- **This skill owns the loop control plane only.** All board reads, routing, lane lifecycle, and merge operations are delegated to `/dispatch-board`, `/dispatch`, and `/three-brain`. Never re-implement them here.
