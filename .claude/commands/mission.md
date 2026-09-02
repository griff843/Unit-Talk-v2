# /mission

Orient on the Production Recovery mission before acting. Replaces `/dispatch` and
`/system-state-loader` as the session entry point: there is no queue to pull from and no lane to
admit — there is a plan, a set of branches, and live runtime truth.

**Authority:** `docs/mission/intent.md` (Griff-owned) · **Live plan:** `docs/mission/plan.md` (Claude-owned)

---

## Steps

1. **Read the plan.** `docs/mission/plan.md`. Note its "Last reconciled against live truth" date.
2. **If the plan is more than ~2 days stale, reconcile it before acting on it.** Reconcile against
   live truth, in this order — never against docs, chat, or a prior terminal:

   ```bash
   git fetch origin && git log --oneline -5 origin/main
   gh pr list --json number,title,headRefName,mergeStateStatus,statusCheckRollup
   gh api repos/griff843/Unit-Talk-v2/branches/main/protection --jq '.required_status_checks.contexts'
   ```

   Then runtime/DB state for anything the plan asserts about the running system. An assertion with a
   date on it is a measurement, and measurements expire.
3. **Pick the work.** Take the executable item nearest to the current milestone. Executable means:
   the plan lists it, and nothing blocks it. No admission step exists.
4. **Classify the risk** before you start, with the same policy the merge gate uses:

   ```bash
   pnpm ops:classify-diff   # once you have a diff; reads the same policy the gate reads
   ```

   `auto` → green CI is the whole gate. `human` → write it and open the PR anyway; it waits for
   Griff at merge, and nothing else waits with it.
5. **Execute.** Worktree + branch → commits → PR on green CI. Delegate bounded implementation to
   Codex with a packet (`docs/mission/packets/TEMPLATE.md`, `pnpm ops:codex-packet`).
6. **Update the plan** as part of finishing — what moved, what was learned, what is now blocked.
   The plan is rewritten as reality changes; it is not a log and not a backlog.

---

## Stop conditions (from `docs/mission/intent.md`)

Return to Griff **only** when:

- a genuinely reserved decision or action is reached (`RESERVED_RISK_SURFACES.json`);
- a hard safety boundary fires and cannot be resolved within existing authority; or
- the mission exit criteria are actually satisfied.

Otherwise, keep working. Do not stop for administrative state, and do not create a ticket in order
to grant yourself permission to fix something the mission requires.

---

## Red flags

- Acting on a plan whose reconciliation date is old, without re-measuring.
- Treating a Linear issue, a prior terminal's handoff, or a lane manifest as current state.
- Waiting for approval on a change that touches no reserved surface.
- Calling something done because a PR merged. Done is the production-readiness contract passing on
  live evidence (`docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md`).
