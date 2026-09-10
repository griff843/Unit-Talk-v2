# /system-state-loader

Load current system state before acting. Run at session start and after `/clear`. Never assume state from memory.

---

## Steps

1. **Run ops:brief** — get lane health, local work, runtime status:
   ```bash
   pnpm ops:brief
   ```
   If active Codex lanes exist: `pnpm codex:status`

2. **Read mission and local scope** — `docs/mission/{intent,spec,plan}.md`, `.ops/work/<ID>.md`, current PRs, active manifests, leases and worktrees. No Linear access is required, including with a configured token.

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

**Stop** when manifest, worktree or PR state conflicts with repo truth, milestone is unclear, baseline is red, or a T1 issue has no contract.
