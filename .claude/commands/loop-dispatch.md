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

## Phase 0: Safety gates (all must pass before first cycle)

Run all four checks before dispatching any issue. Abort on any failure — do not proceed to Phase 1.

### Gate 1 — Lane-governor concurrency preflight

Run the same preflight as `/dispatch` Phase 0:

```typescript
Agent({
  subagent_type: "lane-governor",
  description: "Concurrency preflight before loop-dispatch",
  prompt: "Check current lane state and confirm headroom before loop-dispatch. Report: available Claude slots, available Codex slots, any forbidden combinations active, any file-scope locks that would broadly block dispatch. Be concise — one paragraph max."
})
```

If lane-governor returns BLOCKED or any forbidden combination is active:

```
[loop-dispatch] HALTED — lane-governor blocked: {reason}. Resolve the block before running /loop-dispatch.
```

### Gate 2 — Ghost lane count

Read `docs/06_status/lanes/` and count manifests where `status ∈ {started, in_progress, in_review, blocked, reopened}` and `heartbeat_at` is older than 48 hours.

```bash
node -e "
const fs = require('fs'), path = require('path');
const dir = 'docs/06_status/lanes';
const cutoff = Date.now() - 48 * 60 * 60 * 1000;
const ACTIVE = new Set(['started','in_progress','in_review','blocked','reopened']);
const ghosts = fs.readdirSync(dir)
  .filter(f => f.endsWith('.json'))
  .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')); } catch(e) { return null; } })
  .filter(m => m && ACTIVE.has(m.status) && m.heartbeat_at && new Date(m.heartbeat_at).getTime() < cutoff);
console.log(JSON.stringify({ count: ghosts.length, ids: ghosts.map(m => m.issue_id) }));
"
```

If ghost count ≥ 2:

```
[loop-dispatch] HALTED — {N} ghost lane(s) detected. Run /lane-reconciler first.
Ghost lanes: {IDs}
```

A single ghost lane is a warning only — log it and continue.

### Gate 3 — Codex health check

```bash
npx tsx scripts/ops/codex-health-check.ts --json
```

If `healthy: false`: log a warning and continue in Claude-only mode. Do not abort.

```
[loop-dispatch] WARNING — Codex unavailable ({error}). Continuing Claude-only. Codex candidates will be routed to Claude or deferred.
```

### Gate 4 — Activation gate (Phase 1 + Phase 2 completeness)

Read `docs/06_status/SYSTEM_HARDENING_CHECKLIST.md`. Verify that every item in Phase 1 and Phase 2 shows `✅ merged`.

If any Phase 1 or Phase 2 item is not `✅ merged`:

```
[loop-dispatch] HALTED — system hardening Phase 1/2 incomplete. Finish hardening before enabling continuous dispatch.
Incomplete items: {list}
```

This gate is the deliberate activation lock for continuous dispatch. It exists because autonomous amplification of drift is worse than manual execution. The gate is satisfied when all Phase 1 and Phase 2 rows in the checklist show `✅ merged`. Phase 3 items do not affect this gate.

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
2. Log cycle header:
   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   [loop-dispatch] Cycle {cycle_count}/{max_cycles} — {timestamp}
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```
3. Invoke `/dispatch-board` for one full cycle. Capture the cycle report (merges this cycle, awaiting PM, blocked, deferred).

### After each cycle

Parse the cycle report for merge count:

- **Merge count > 0:** reset `consecutive_zero` to 0.
- **Merge count = 0:** increment `consecutive_zero`.

**Circuit breaker — consecutive zero merges:**
If `consecutive_zero ≥ 2`:
```
[loop-dispatch] STALLED — two cycles with no merges. Check blocked lanes.
Run /lane-reconciler to inspect stale state, then re-invoke /loop-dispatch.
```
Exit the loop.

**Circuit breaker — Claude slot cap:**
After each cycle, re-read `docs/06_status/lanes/` slot counts. If Claude is at cap (2/2) and no active Claude lane has a PR open for merge, pause: do not start the next cycle until a lane closes. Log:
```
[loop-dispatch] PAUSED — Claude slots at cap (2/2). Waiting for a lane to close before next cycle.
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

Cycle breakdown:
  Cycle 1: {N} merged, {N} blocked, {N} deferred
  Cycle 2: ...

Next action:
  Board clear   → nothing; run /loop-dispatch again when new issues are Ready
  Cycle limit   → run /loop-dispatch to continue
  Stalled       → run /lane-reconciler, then /loop-dispatch
  T1 gate       → review T1 PR(s) and post PM_VERDICT; then /loop-dispatch
  Halted        → resolve the reported gate failure, then /loop-dispatch
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## --dry-run behavior

When invoked as `/loop-dispatch --dry-run`:

1. Run all four safety gates (abort on failure as normal).
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
- **Phase 1+2 activation gate is non-negotiable.** If the checklist shows any Phase 1 or Phase 2 item not `✅ merged`, continuous dispatch does not run.
- **Ghost lane threshold: ≥ 2 aborts.** One ghost is a warning; two or more indicate systemic state drift.
- **Codex unavailability is a warning, not an abort.** Claude-only mode continues; do not prevent dispatch because Codex is down.
- **Claude slot cap pauses, does not abort.** The loop waits for a lane to close; it does not exit.
- **Two consecutive zero-merge cycles abort.** This prevents infinite loops against a permanently blocked board.
- **270-second inter-cycle pause is fixed.** Do not reduce it to speed up throughput — it exists to stay within the cache window and to allow manual intervention between cycles.
- **This skill owns the loop control plane only.** All board reads, routing, lane lifecycle, and merge operations are delegated to `/dispatch-board`, `/dispatch`, and `/three-brain`. Never re-implement them here.
