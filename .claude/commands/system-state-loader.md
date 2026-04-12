# /system-state-loader

Load current system state before acting. Run at session start and after `/clear`. Never assume state from memory.

---

## Steps

1. **Run ops:brief** — get lane health, Linear queue, runtime status:
   ```bash
   pnpm ops:brief
   ```
   If active Codex lanes exist: `pnpm codex:status`

2. **Read Linear queue** — via `pnpm linear:work` or Linear MCP. Note Ready, In Progress, In Review issues.

3. **Reconcile** — for each In Progress/In Review issue:
   - PR merged → mark Done
   - Branch stale/abandoned → mark blocked
   - Code on main already → mark Done
   ```bash
   pnpm github:current
   ```

4. **Read program status** — `docs/06_status/PROGRAM_STATUS.md`. Identify active milestone, open risks, live routing.

5. **Answer three questions before touching code:**
   - What milestone is active?
   - What issues are executable now?
   - What is blocked and why?

## Decision

**Proceed** when milestone is clear, executable issues exist, no stale conflicts.

**Stop** when Linear conflicts with repo truth, milestone is unclear, baseline is red, or a T1 issue has no contract.
