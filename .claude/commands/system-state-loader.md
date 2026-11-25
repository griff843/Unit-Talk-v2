# /system-state-loader

Load current system state before acting. Run at session start and after `/clear`. Never assume state from memory.

---

## Steps

1. **Run ops:brief** — get lane health, open work orders, runtime status:
   ```bash
   pnpm ops:brief
   ```
   If active Codex lanes exist: `pnpm codex:status`

2. **Read open work orders** — `.ops/work/WORK-*.md` with no lane manifest yet (listed by `pnpm ops:brief`).

3. **Reconcile** — for each active lane manifest:
   - PR merged → `pnpm ops:lane-close <ID>`
   - Branch stale/abandoned → mark the manifest blocked
   - Code on main already → `pnpm ops:lane-close <ID> --repair-merged`
   ```bash
   pnpm github:current
   ```

4. **Read program status** — `docs/mission/plan.md` (live, reconciled against GitHub and runtime) and `docs/06_status/CURRENT_STATE.md` (a dated snapshot; check its "Last verified" line, and let live evidence override it). Identify active milestone, open risks, live routing. `PROGRAM_STATUS.md` is superseded audit history, not a status source.

5. **Answer three questions before touching code:**
   - What milestone is active?
   - What issues are executable now?
   - What is blocked and why?

## Decision

**Proceed** when milestone is clear, executable issues exist, no stale conflicts.

**Stop** when a work order conflicts with repo truth, milestone is unclear, baseline is red, or a T1 issue has no contract.
