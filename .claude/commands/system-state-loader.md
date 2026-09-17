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

3. **Reconcile** — compare active manifests with PR, branch and lease evidence.
   A merged PR or code already on main is not sufficient evidence of completed work;
   use the existing truth-check and lane-close controls. Investigate stale branches
   against current work before changing their state.
   ```bash
   pnpm github:current
   ```

4. **Read program status** — `docs/06_status/CURRENT_STATE.md` and `docs/mission/plan.md`.
   Identify active milestone, open risks and live routing; verify snapshots against
   current evidence. `PROGRAM_STATUS.md` is superseded history, not status authority.

5. **Answer three questions before touching code:**
   - What milestone is active?
   - What issues are executable now?
   - What is blocked and why?

## Decision

**Proceed** when milestone is clear, executable issues exist, no stale conflicts.

**Reconcile the affected task** when manifest, worktree or PR evidence conflicts, the milestone is unclear, or a required baseline/contract is missing. Determine the actual dependent work; do not treat an unrelated historical failure as a mission-wide stop. Required gates remain controlling. Follow intent.md stop conditions for the broader mission.

Report integrated code, deployed version and user-verified behavior separately. Read plan-lessons.md only for relevant diagnoses. Verify a claimed PR blocker against its current GitHub state and lane evidence before repeating it.
