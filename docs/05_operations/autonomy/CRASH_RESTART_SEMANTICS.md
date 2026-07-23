# Crash/Restart Semantics

**Status:** Canonical contract — AUT-1
**Purpose:** Exact recovery procedure, exact idempotency guarantees. Grounded in a real incident observed in
this repo today (§1), not a hypothetical.

---

## 1. Liveness signal: heartbeat + TTL, never raw PID-alive

**The incident that grounds this section:** while reconciling a stale lane manifest today (2026-07-23), the
existing `scripts/ops/merge-mutex.ts` tool was observed flagging a lock it had itself just acquired as
`stale_reason: "orphaned_pid"` on the very next short-lived `tsx` invocation. `merge-mutex.ts`'s
`isProcessAlive()` uses `process.kill(pid, 0)` (POSIX signal-0 existence probe) against the PID recorded at
lock-acquisition time. Because each CLI invocation is its own OS process that exits normally when the
command finishes, the **next** invocation in a sequence of short-lived governed commands is, by definition,
a different PID — so a naive "is the recorded owner PID still alive" check misfires as "orphaned" even when
there was no crash at all, just normal sequential process completion.

This is exactly the failure mode the autonomy kernel must not repeat, and it is more dangerous here than in
`merge-mutex.ts`'s context, because the kernel is designed to run unattended and repeatedly on a schedule —
a liveness check with this false-positive shape would cause the kernel to treat its own immediately-prior,
perfectly healthy invocation as crashed on every single wake, corrupting recovery logic from day one.

**The fix, already proven elsewhere in this repo:** `scripts/ops/lease-registry.ts` does not use PID
liveness at all. A lease has `heartbeat_at` and `expires_at` (TTL-derived); liveness is "has this heartbeat
been refreshed within its TTL," fully decoupled from OS process identity. A lease reserved by invocation A
and heartbeated by invocation B (a different PID, same logical lane) is still correctly "alive" under this
model, because nothing about the check depends on which process wrote the last heartbeat — only *when*.

**Binding rule for AUT-2:** the kernel's own liveness determination
(`schemas/autonomy_execution_state_v1.schema.json`'s `last_heartbeat_at` + `heartbeat_ttl_seconds`, default
900s per `LIMITS.md` §5) **must** follow the `lease-registry.ts` heartbeat+TTL pattern. `owner_pid` may be
recorded for human debugging only and **must never** be read by any liveness-determination code path — the
schema comment on that field states this explicitly and a code reviewer should treat any PID-based liveness
check in AUT-2 as a defect, citing this section.

---

## 2. Recovery procedure on every wake

Every invocation, whether following a clean prior exit or a crash, runs the **same** procedure — there is no
special "crash recovery mode" that only sometimes runs, because the kernel cannot reliably distinguish "the
prior invocation exited cleanly" from "the prior invocation crashed" without doing this check anyway.

1. **Read persisted `autonomy_execution_state`.** If the file is missing, corrupt, or fails schema
   validation: treat as `initial_state`, `mode: halted` (fail closed — an unreadable state file is never
   interpreted as "assume the last known-good mode").
2. **Check `last_heartbeat_at` against `heartbeat_ttl_seconds`.**
   - If fresh (within TTL) and `cycle_state !== "idle"`: another invocation may genuinely still be running.
     The `concurrency` group (`LIMITS.md` §1) should already prevent this from happening via GitHub Actions
     itself, but the check is defense in depth — if hit, this invocation exits immediately without acting
     (logs an `info`-severity audit event and stops; does not treat this as an error).
   - If stale (TTL exceeded) and `cycle_state !== "idle"`: the prior cycle is presumed crashed or killed
     mid-cycle. Proceed to step 3.
   - If `cycle_state === "idle"`: normal case, prior cycle completed cleanly. Proceed directly to a fresh
     cycle (`STATE_MACHINE.md` §3, starting at `waking`).
3. **Reconcile `active_dispatch_ids`** (present only when step 2 found a stale, non-idle prior cycle). For
   **every** `idempotency_key` in that list:
   - **Never assume the action succeeded. Never assume it failed. Never blind-retry it.** Look it up against
     rank-1/rank-2 truth: does a lane manifest exist for the associated `issue_id` at the expected `status`?
     Does a PR exist at the expected URL? Is there a corresponding `outcome`-phase audit event that simply
     hadn't been reconciled into `active_dispatch_ids` yet? This is the same truth-hierarchy discipline
     `EXECUTION_TRUTH_MODEL.md` §1 already mandates for lane state — the kernel does not get a special
     exemption to trust its own last-written snapshot over GitHub/manifest truth.
   - Record the reconciliation outcome as a `crash_recovery_reconciled` audit event (`outcome: "confirmed_done"
     | "confirmed_not_done" | "confirmed_in_progress_externally_unblocked"`), then clear that key from
     `active_dispatch_ids`.
   - If reconciliation finds the action **partially applied** in a way that cannot be cleanly classified
     (e.g. a lane manifest was created but the PR was never opened, and it is ambiguous whether the intended
     next mechanical step is safe to resume) — this is a `high`-severity finding, not a `critical` auto-halt,
     but it **is** a `NOTIFICATION_TAXONOMY.md` immediate-notify event, and the kernel does **not** attempt
     to guess the right corrective action; it leaves the partially-applied lane exactly as found for a human
     to resolve (consistent with `KILL_SWITCH_CONTRACT.md` §3's "does not auto-clean-up" principle, applied
     here to self-recovery rather than an explicit halt).
4. **Reset `cycle_state` to `idle`** once reconciliation completes (or immediately, if step 2 found nothing
   stale). This is the point at which the persisted `cycle_state` value from before the crash is discarded —
   it is never used as a "resume from this step" instruction, because a step recorded mid-write cannot be
   trusted to describe reality after an uncontrolled process exit.
5. **Proceed to a fresh cycle** (`waking` → ... per `STATE_MACHINE.md` §3), subject to the kill switch check
   (`KILL_SWITCH_CONTRACT.md` §2) as the very next thing that happens.

---

## 3. Idempotency guarantee

Every mutating action the kernel takes is tied to a deterministic `idempotency_key`
(`dispatch_packet_v1.schema.json`: `f(issue_id, action_type, cycle_id)`). Before attempting **any** mutating
call, the kernel checks whether an `outcome`-phase audit event already exists for that exact key:

- If yes: the action was already durably completed (or durably failed-and-recorded) in a prior cycle or
  invocation. The kernel does **not** repeat it. This is what makes step 3 of the recovery procedure safe —
  reconciliation can always fall back to "check the audit log for a matching outcome event" as the fastest
  path, before falling back to the more expensive GitHub/manifest truth lookup.
- If no: proceed, emitting the `intent` event first, then attempting the action, then emitting the
  `outcome` event.

This guarantee composes with, rather than replaces, the idempotency already built into the underlying
mechanical tools: `ops:lane-start` already refuses to create a second manifest for an issue with an active
one (`LANE_MANIFEST_SPEC.md` §8: "second `ops:lane-start` on same issue refuses unless previous manifest is
`done`"), and `ops:lane-close`/`ops:truth-check` are themselves idempotent for pass/ineligible outcomes
(`TRUTH_CHECK_SPEC.md` §6: "Truth-check is idempotent for `0` and `2`"). The kernel's own idempotency layer
exists to protect the **kernel's bookkeeping** (execution-state, audit log) from getting out of sync with
reality after a crash — it is not a replacement for those tools' own safety, it is an additional layer above
them so the kernel never even *attempts* a redundant call in the first place, rather than relying solely on
the downstream tool to reject it.

---

## 4. What is explicitly NOT guaranteed

- **Exactly-once execution of the underlying mechanical action** (e.g. a PR being opened exactly once) is
  **not** independently guaranteed by the kernel — it is inherited from the underlying tools' own
  idempotency (`ops:lane-start`, GitHub's own duplicate-PR prevention, etc.). The kernel's guarantee is
  narrower and precise: **the kernel itself will not knowingly attempt a duplicate mutating call** once it
  has reconciled and found an existing `outcome` event or matching truth-source state.
- **Recovery is not guaranteed to complete within a single invocation's timeout** in a pathological case with
  a large `active_dispatch_ids` backlog. If reconciliation itself cannot complete within `LIMITS.md` §2's
  job-level timeout, the invocation exits without having reset `cycle_state`, and the next invocation retries
  reconciliation from the same (still-stale) state — this converges but is not bounded to complete in one
  attempt. A reconciliation that fails to converge after 3 consecutive attempts counts toward
  `LIMITS.md` §4's consecutive-infra-failure auto-halt threshold.
