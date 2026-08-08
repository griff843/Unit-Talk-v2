# Compatibility Map

**Status:** Canonical contract — AUT-1
**Purpose:** For each existing mechanical mechanism the autonomy program touches or depends on, state
explicitly whether this system **wraps** it, **replaces** it, or **coexists** with it unchanged, and why.
This document exists so AUT-2/AUT-3/AUT-4 do not each independently guess at this and drift — every "do I
call the existing tool or build a new one" question in this program should be answerable by looking here
first.

**Default stance:** overwhelmingly **coexist, reuse verbatim**. This program adds a new *caller* (the
kernel) that invokes existing mechanical primitives the same way a human orchestrator session already does
— it does not reimplement lane lifecycle, concurrency enforcement, merge serialization, or truth-checking.
The one genuinely new class of state is the kernel's own mode/cycle bookkeeping, which has no pre-existing
equivalent to reuse and is deliberately kept in its own, clearly-named artifact rather than overloading an
existing one.

---

| Mechanism | Verdict | Why |
|---|---|---|
| **Digest / brief** (`ops:brief`, `ops:digest`, `ops:daily-digest`) | **Coexists, extended** | The kernel's `NOTIFICATION_TAXONOMY.md` §1 explicitly feeds its own section into the existing digest rather than creating a parallel reporting surface. PM continues to read one digest for both human-lane and kernel-lane status. No new digest tool is built. |
| **Substrate guard** (`ops:substrate-guard`) | **Coexists, reused verbatim (Gate 0)** | The kernel's `gating` cycle state (`STATE_MACHINE.md` §3) calls this exact command, exactly as `/dispatch` and `/loop-dispatch` already do before dispatching. No new substrate-safety logic is invented — this is precisely the tool that already tolerates transient WSL ENOENT and detects unsafe lease/merge-lock/worktree state; reimplementing it for the kernel would be pure duplication risk. |
| **Merge risk** (`ops:merge-risk`) | **Coexists, reused verbatim (Gate 1)** | Same reasoning as substrate guard — `hard_fail`/`block` findings halt the kernel's cycle exactly as they'd halt a human-invoked `/dispatch`. |
| **Execution state** (`ops:execution-state`) | **Coexists, reused verbatim (Gate 2) — but see naming caveat below** | The kernel uses this **unmodified** as its concurrency authority (active lanes by executor, available slots, stale heartbeats, singleton blockers, merge mutex state) before selecting candidates. **Naming caveat:** the kernel's *own* self-state artifact (`schemas/autonomy_execution_state_v1.schema.json`) is a deliberately, intentionally different, new artifact — it reports the kernel's mode/cycle/heartbeat, not lane concurrency. The two must never be confused: `ops:execution-state`'s output answers "what lanes are active system-wide," the kernel's own execution-state answers "what is the kernel itself doing." AUT-2's implementation must give the kernel's file a distinct path (not under `docs/06_status/lanes/` and not literally named to collide with the existing `execution-state-v1.md` schema doc) — this is called out here precisely because the name collision is real and has caused confusion before it was even implemented. |
| **Lane maximizer** (`ops:lane-maximizer`) | **Coexists, reused verbatim (Gate 3)** | Dispatch-recommendation authority is unchanged — the kernel treats its output the same way `/dispatch` already does, including deferring to it for executor caps and singleton/forbidden-combination rules rather than hardcoding numeric limits (`LANE_CONCURRENCY_POLICY.md` §10's "canonical citation" rule applies to the kernel too). |
| **Orchestration reconcile** (`ops:orchestration-reconcile`) | **Coexists, reused verbatim (Gate 4)** | Manifest↔Linear drift reconciliation is unchanged; the kernel runs it exactly as `/dispatch`/`/loop-dispatch` do and halts the cycle on the same repair-plan-required outcome. |
| **Lane manifests** (`docs/06_status/lanes/*.json`, `LANE_MANIFEST_SPEC.md`) | **Coexists, unchanged** | Kernel-dispatched lanes get a manifest created by `ops:lane-start` exactly like any human-dispatched lane — same schema, same lifecycle, same rank-3 truth authority (`EXECUTION_TRUTH_MODEL.md` §1). The kernel does not create a parallel lane-tracking mechanism; a kernel-originated lane is, from the manifest's perspective, indistinguishable in shape from a human-originated one (only `created_by`, already an existing enum value slot per `LANE_MANIFEST_SPEC.md` §4.2, would need a new value such as `autonomy-kernel` — a small, additive schema change, not a new mechanism). |
| **Leases** (`scripts/ops/lease-registry.ts`) | **Coexists, unchanged — and separately used as the design model for the kernel's own liveness** | The lease mechanism itself is not modified; kernel-dispatched lanes reserve/heartbeat leases the same way any lane does. Distinct from that, `CRASH_RESTART_SEMANTICS.md` §1 explicitly models the kernel's *own* self-liveness signal on this mechanism's heartbeat+TTL pattern — reuse of the *pattern*, not an extension of the *mechanism* (the kernel does not become a new kind of lease). |
| **Merge locks / merge mutex** (`scripts/ops/merge-mutex.ts`, `.ops/merge-lock.json`) | **Coexists, reused verbatim** | Kernel merges go through `ops:merge-wrapper` exactly like any other actor — the kernel does not acquire the merge lock directly or reimplement serialization. Explicitly **not** the model for the kernel's own liveness signal — `CRASH_RESTART_SEMANTICS.md` §1 calls out this tool's `isProcessAlive()`/PID-based liveness check as the specific pattern to avoid, grounded in the real `orphaned_pid` false-positive this repo produced on 2026-07-23. |
| **`/loop-dispatch`** | **Wrapped (for now — not replaced)** | Mechanically, the autonomy kernel is a scheduled, unattended, mode-gated invoker of the same Gate 0-4 sequence and dispatch primitives `/loop-dispatch`/`/dispatch-board` already define for session-invoked use. AUT-4's scheduler wraps that cycle-pacing/circuit-breaker responsibility for the headless context rather than reimplementing board iteration from scratch. The two are not expected to run concurrently — mutual exclusion is achieved the same way any two dispatch actors would conflict: shared substrate-guard state and the same lane-concurrency ceilings, plus the kernel's own single-invocation concurrency group (`LIMITS.md` §1). **This is "wrap," not "replace," as a deliberate scope decision for AUT-1**: whether the scheduled kernel eventually *fully* supersedes session-invoked `/loop-dispatch` for T2/T3 work is a later, separate PM-gated decision (the program directive itself says "eventually replace/wrap" — AUT-1 does not resolve that ambiguity, it only ensures the two can coexist safely today). |
| **Scheduled-workflow pattern** (`.github/workflows/track-a-monitor.yml`) | **Pattern reused, workflow itself not wrapped** | AUT-4's scheduler follows the same shape (`schedule` trigger + `workflow_dispatch` + install + run + upload-artifact) but cannot literally *be* `track-a-monitor.yml`, because that workflow's own guardrails are explicitly read-only ("no production mutation... no backfill"). The autonomy scheduler is, by design, a **mutating** workflow (opens PRs, dispatches lanes, merges) and therefore needs its own permissions block (broader than `track-a-monitor.yml`'s `contents: read`) and its own guardrail comment header stating what it *is* allowed to mutate — copying `track-a-monitor.yml`'s literal permissions would either under-provision the kernel (breaking it) or the kernel's broader permissions would be a silent, undocumented widening of what that workflow file's own header promises if reused in place. Reuse the shape; do not reuse the file or its permissions grant. |

---

## Summary

| Category | Verdict |
|---|---|
| Digest/brief | Coexist, extended |
| Substrate guard | Coexist, reused verbatim |
| Merge risk | Coexist, reused verbatim |
| Execution state (lane concurrency) | Coexist, reused verbatim — distinct name from kernel's own state |
| Lane manifests | Coexist, unchanged |
| Leases | Coexist, unchanged; pattern reused for kernel liveness |
| Merge locks | Coexist, reused verbatim; pattern explicitly NOT reused for kernel liveness |
| `/loop-dispatch` | Wrapped (replace is a later, separate decision) |
| Scheduled-workflow pattern | Pattern reused; workflow file and permissions are new, not shared |

**Nothing in this program replaces an existing mechanism outright.** The one new mechanism this program adds
is the kernel's own mode/cycle state and audit log — deliberately scoped as narrowly as possible so the vast
majority of this program's safety properties are inherited from mechanisms already proven in production use,
not reinvented.
