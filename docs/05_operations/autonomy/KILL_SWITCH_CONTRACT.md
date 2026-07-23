# Owner Kill-Switch Contract

**Status:** Canonical contract — AUT-1
**Purpose:** Exact mechanism, exact latency guarantee, exact scope. "Griff can kill this instantly" is a
program requirement (see program directive); this document is what makes that mechanically true rather than
aspirational.

---

## 1. Two independent layers

A single flag is not a kill switch if the thing you're trying to kill can ignore that flag — a buggy or
compromised kernel is exactly the failure mode this needs to survive (`THREAT_MODEL.md` #6). The contract
therefore has **two layers that do not depend on each other**:

### Layer 1 — In-band: the `halted` field

The kernel's own persisted execution-state (`schemas/autonomy_execution_state_v1.schema.json`) has a
`halted: boolean` field (mirrored by `mode: "halted"`). Griff sets it directly (owner has unconditional
write authority — `AUTHORITY_MATRIX.md` §3). Every mechanical entry point the kernel has checks this field:

- At the top of `waking` (before any Gate 0-4 call) — `STATE_MACHINE.md` §3.2.
- Immediately before every individual mutating action (`ops:lane-start`, PR open, `gh pr review --approve`,
  `ops:merge-wrapper`, Linear write) — not just once at cycle start. This is the
  `kill_switch_check` field required on every `dispatch_packet_v1` (re-checked, not reused from
  cycle-start).

This layer is **fast** (sub-second once read) but **trusts the kernel's own code to actually check it**.

### Layer 2 — Out-of-band: GitHub-level control

Independent of anything the kernel's code does or checks: Griff can disable the scheduled trigger itself
(disable/delete the GitHub Actions workflow, or revoke the workflow's required secret/token) at the GitHub
platform level. This works even if Layer 1's check were somehow broken, bypassed, or the kernel's own code
were compromised — because it removes the kernel's ability to *run at all*, rather than asking a running
kernel to behave.

**This is why `.github/workflows/**` for the kernel's own scheduler, and the kernel's own config surface, are
in the never-permitted list in `AUTHORITY_MATRIX.md` §1** — a kernel that could edit its own workflow file
or disable-detection could defeat Layer 2. Layer 2's guarantee depends on the kernel never having write
access to the mechanism that would let it undermine Layer 2, which is a governance-path exclusion, not a
runtime check.

**Neither layer alone is the kill switch. Both together are.** A correct implementation must support Griff
using either one independently and get the same result: zero further autonomous mutating action.

---

## 2. Exact latency guarantee

| Scenario | Guaranteed bound |
|---|---|
| Kernel is `idle` (between cycles) when Griff sets `halted: true` | Next scheduled trigger reads `halted` at the top of `waking` and immediately transitions to `halted_noop` (`STATE_MACHINE.md` §3.2) before any gate runs. Bound: **one scheduling interval** (`LIMITS.md` §1 default: 15 minutes), same as any cron-driven check. |
| Kernel is mid-cycle (`gating`/`selecting`/`dispatching`/`shadow_evaluating`) when Griff sets `halted: true` | The `kill_switch_check` on the **next** dispatch packet (not yet acted on) sees `halted: true` and the packet is discarded as a contradiction (schema `kill_switch_check.halted` is `const: false` for a live packet). Any single mutating action already **in flight** (e.g. a `ops:lane-start` call already issued) is allowed to complete to its own atomic conclusion — it is not killed mid-call, because half-completing a mechanical gate call is worse than letting one bounded operation finish. Bound: **time to complete one in-flight atomic operation**, hard-capped by `LIMITS.md` §2's per-operation timeout (10 minutes). No **new** operation may start after the check fails. |
| Griff uses Layer 2 (disables the workflow) | Bound: **immediate for any not-yet-triggered invocation** (GitHub will not fire a disabled scheduled workflow). An invocation already running when the workflow is disabled is not forcibly killed by GitHub disablement alone — Griff must also cancel the in-progress run (a standard GitHub Actions action) for an immediate stop; combined, this bound is the same as Layer 1's mid-cycle bound above. |
| Griff wants absolute certainty with no bound uncertainty | Use **both** layers together: set `halted: true` AND cancel the in-progress workflow run AND disable the trigger. This collapses the guarantee to "as fast as GitHub's own run-cancellation," which is the practical floor — nothing in this system can be faster than the platform primitive itself. |

**Worst-case combined bound, Layer 1 alone, mid-flight:** one in-flight atomic operation's completion (≤10
minutes, `LIMITS.md` §2) plus zero further cycles. This is the number to cite as "the kill switch's
latency guarantee": **≤10 minutes to zero new autonomous mutating actions, with any single already-started
mechanical call left to finish rather than aborted mid-write.**

---

## 3. Exact scope — what "halted" actually stops

### Stops immediately (no new instance permitted once `halted: true` is observed)

- New `ops:lane-start` calls (no new lanes created by the kernel).
- New PR opens by the kernel.
- New `gh pr review --approve` / `ops:merge-wrapper` merge calls by the kernel.
- New Linear state writes by the kernel (including `ops:lane-close`'s Linear transition).
- New dispatch packets of any kind, including shadow-mode ones — `halted` mode runs **no** evaluation at
  all (`STATE_MACHINE.md` §2.1), not even the read-only shadow pipeline.
- Mode auto-rollback/auto-halt logic (moot — already at floor).

### Does NOT stop (halting is not the same as reverting or cleaning up)

- **In-flight lanes already dispatched before the halt.** A lane the kernel started before `halted` was set
  continues to exist as an ordinary lane (manifest, branch, possibly an open PR) — the kill switch does not
  auto-abandon, auto-close, or auto-revert it. A human (Griff or the orchestrator) must decide what to do
  with it, exactly as with any other stranded/orphaned lane per `LANE_MANIFEST_SPEC.md` §7.
- **Already-granted GitHub permissions or already-merged PRs.** The kill switch is forward-only; it does not
  retroactively unmerge anything. Rollback of a bad merge is a separate, human-driven revert, not part of
  this contract.
- **Read-only reporting.** The kernel's own state and audit log remain readable; `ops:brief`/`ops:digest`
  and any other read-only tool continue to function normally against a halted kernel's persisted state.
- **Manual/human-invoked dispatch.** Halting the *kernel* does not halt `/dispatch` or `/loop-dispatch` run
  by a human in a session — those are a different actor (`AUTHORITY_MATRIX.md`), governed by
  `DELEGATION_POLICY.md`, not by this kill switch. (If Griff wants to stop *all* dispatch, human and
  kernel both, that is a broader instruction outside this document's scope.)
- **The audit log.** Halting does not pause audit-event emission for the halt itself — a `kill_switch_engaged`
  and `kill_switch_confirmed_halted` event pair is still written (this is the one action a halted kernel is
  explicitly permitted to take, per `AUTHORITY_MATRIX.md` §2's "minimal" notification row).

---

## 4. Re-enabling

Re-enabling is **always** an explicit owner promotion (`halted` → `shadow`, never directly to a live mode —
`STATE_MACHINE.md` §2.2). There is no "resume where it left off" — a kernel coming out of `halted` starts a
fresh `shadow` evaluation cycle and reconciles from current truth, same as any restart
(`CRASH_RESTART_SEMANTICS.md`). The kernel itself never re-enables; only Griff can.
