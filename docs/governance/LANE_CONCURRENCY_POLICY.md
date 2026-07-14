# Lane Concurrency Policy — Unit Talk V2

**Status:** Canonical  
**Authority:** `docs/governance/LANE_TAXONOMY.md`, `docs/05_operations/LANE_MANIFEST_SPEC.md`  
**Issued under:** UTV2-955  
**Effective:** 2026-05-15  
**Machine-readable config:** `docs/governance/CONCURRENCY_CONFIG.json` — all limits are defined there; this document is the human-readable specification. When the two disagree, the JSON file wins.

This document defines the concurrency rules for simultaneous execution of lanes in Unit Talk V2. It supplements the lane taxonomy with the enforcement mechanism for safe parallel execution.

The operating model is: 10 total active lanes (4 Claude + 6 Codex), enforced mechanically by `ops:lane-start` reading `CONCURRENCY_CONFIG.json`. Prose policy alone does not enforce anything — scripts enforce.

**Provenance (UTV2-1533, 2026-07-14, post OS v1 lock ratification):** the prior 6-lane (2 Claude + 4 Codex) ceiling was a stabilization-era policy choice, not a mechanical limit — no external constraint (API rate limit, license seat count, host process cap) enforced 2/4/6 anywhere; only this repo's own `ops:lane-start` did. The audit backing this ramp found exactly two constraints that remain real regardless of lane count: merge-train serialization (§8b, `merge_serialized_max: 1`) and the WSL2-RAM-driven full-verification semaphore (§10a, decoupled from the active-lane cap). Raising the lane count does not touch either. See UTV2-1533 for the full audit.

---

## 1. Hard limits (always enforced)

These limits are hard caps enforced by `ops:lane-start`. The command refuses if a limit is breached.

| Limit | Value | Enforcement |
|---|---|---|
| Total active lanes (any type) | **10** | `ops:lane-start` rejects lane 11 |
| Claude executor lanes | **4** | `ops:lane-start` rejects fifth Claude lane |
| Codex executor lanes | **6** | `ops:lane-start` rejects seventh Codex lane |
| Runtime lanes | **1** | `ops:lane-start` rejects second Runtime |
| Migration lanes | **1** | `ops:lane-start` rejects second Migration |
| Modeling lanes | **1** | `ops:lane-start` rejects second Modeling |
| Data/Canonical lanes | **1** | `ops:lane-start` rejects second Data/Canonical |
| Hygiene lanes | **4** | `ops:lane-start` rejects fifth Hygiene |
| Governance lanes | **3** | `ops:lane-start` rejects fourth Governance |
| Delivery/UI lanes per app | **1** | `ops:lane-start` rejects second lane touching same app path |
| Verification lanes per target issue | **1** | `ops:lane-start` rejects second Verification for same target |

Active means `status ∈ {started, in_progress, in_review, blocked, reopened}`. Closed (`done`) and stale manifests older than 48h do not count toward these limits.

---

## 2. File-scope lock precedence

Before any limit check, `ops:lane-start` runs a **file-scope lock scan**:

1. Enumerate all active lane manifests.
2. Glob-expand each manifest's `file_scope_lock`.
3. Glob-expand the incoming lane's declared `file_scope_lock`.
4. If any paths intersect → **hard refuse** with the conflicting lane ID and path listed.

This is stricter than the type-level limits. Two Hygiene lanes may both be within the 3-lane cap and still be refused if they declare overlapping file locks.

File-scope lock scan runs first. Type-level limits run second. Both must pass.

---

## 3. Forbidden concurrent combinations

These pairs can never run simultaneously, regardless of file-scope locks or limits:

| Lane A | Lane B | Reason |
|---|---|---|
| Migration | Runtime | Serial DB+code deploy required; concurrent merge creates rollback ambiguity |
| Migration | Migration | Migration serial ordering — concurrent files break sequential numbering |
| Migration | Data/Canonical | Data/Canonical that touches schema must be its own Migration lane anyway |
| Runtime | Runtime | One active pick pipeline write path at a time |
| Modeling | Modeling | Shadow scoring paths cannot be compared against two moving baselines |

These are compile-time forbidden. `ops:lane-start` blocks them unconditionally, even if the file scopes do not overlap.

---

## 4. Allowed concurrent combinations (as of 2026-05-15)

The following combinations are explicitly allowed when file-scope locks do not conflict:

| Combination | Notes |
|---|---|
| Governance + Governance | Up to 3, distinct doc sections |
| Governance + Hygiene | Fully disjoint paths; no interaction |
| Governance + Delivery/UI | No shared files |
| Governance + Verification | No shared files |
| Hygiene + Delivery/UI | Only if different apps and different packages |
| Hygiene + Verification | Allowed if verification is read-only |
| Delivery/UI + Delivery/UI | One per app (`apps/command-center`, `apps/discord-bot`, `apps/smart-form` may each have one) |
| Verification + anything | Verification is read-only by definition; one per target issue |
| Runtime + Governance | Governance is docs-only; no shared files |
| Runtime + Hygiene | Only if Hygiene touches a package outside Runtime's `file_scope_lock` |
| Runtime + Delivery/UI | Only if Delivery/UI has no overlap with Runtime's locked files |

When in doubt, declare the file scope and let `ops:lane-start` arbitrate.

---

## 5. Concurrency matrix

`✓` = allowed (subject to file-scope lock check)  
`✗` = forbidden (hard block)  
`1/app` = allowed but one per app only  
`*` = unlimited across distinct targets/sections

|  | Runtime | Modeling | Verification | Hygiene | Migration | Governance | Delivery/UI | Data/Canonical |
|---|---|---|---|---|---|---|---|---|
| **Runtime** | ✗ | ✓† | ✓ | ✓† | ✗ | ✓ | ✓† | ✓† |
| **Modeling** | ✓† | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓† |
| **Verification** | ✓ | ✓ | ✓* | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Hygiene** | ✓† | ✓ | ✓ | ✓ (≤3) | ✓† | ✓ | ✓† | ✓ |
| **Migration** | ✗ | ✗ | ✓ | ✓† | ✗ | ✓ | ✓ | ✗ |
| **Governance** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (≤3) | ✓ | ✓ |
| **Delivery/UI** | ✓† | ✓ | ✓ | ✓† | ✓ | ✓ | 1/app | ✓ |
| **Data/Canonical** | ✓† | ✓† | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ |

**†** = allowed only if file-scope locks do not conflict

---

## 6. Scaling to 10, then 12–14 lanes safely

The current system operates safely at 3 active lanes because:
- Runtime and Migration are always singletons
- Hygiene and Governance have no runtime interaction
- Verification is read-only

To safely operate at **5 lanes**, the following combination is stable:

```
1 × Runtime
1 × Verification (for prior Runtime)
1 × Governance
1 × Hygiene
1 × Delivery/UI
```

To safely operate at **6–8 lanes**, additional Governance and Hygiene lanes may be added (up to their caps), and one Modeling lane may coexist with a Delivery/UI lane that does not touch model scoring paths:

```
1 × Runtime
1 × Verification
1 × Modeling (shadow only)
2–3 × Governance (distinct doc sections)
2–3 × Hygiene (distinct file scopes)
1/app × Delivery/UI
```

### 10-lane base ceiling (UTV2-1533, effective 2026-07-14)

The type-level caps in §1 (Hygiene ≤4, Governance ≤3, Delivery/UI 1/app across up to 4 apps, Verification unbounded across distinct targets) already accommodate 10 concurrent safe-type lanes plus one Runtime singleton without raising any type-level cap — only the executor (`claude`/`codex`) and `total` caps needed to move. Example 10-lane topology:

```
1 × Runtime          (Claude or Codex — singleton by type)
1–2 × Verification   (Claude or Codex — read-only)
2–3 × Governance      (distinct doc sections)
2–3 × Hygiene         (distinct file scopes)
1–4 × Delivery/UI     (1 per app: command-center, discord-bot, smart-form, qa-agent)
```

Total: up to 10 lanes simultaneously, Claude ≤4 / Codex ≤6, if the above distribution is respected and file-scope locks do not conflict.

**Ramp discipline (PM directive, UTV2-1533):** start a wave at 10, hold it there, and watch — ghost-lane count, stale-lease count, WSL2 memory pressure during concurrent full-verify queuing (§10a), CI/PR review delay, and merge-train drain rate. Only after that 10-lane wave runs healthy (no sustained regression in those signals) should the PM enable the disabled 12–14 trial block in `CONCURRENCY_CONFIG.json` (§11) — raising the ceiling further before the 10-lane wave is proven is explicitly out of scope for this ramp step.

---

## 7. Conflict resolution protocol

When `ops:lane-start` refuses a new lane due to concurrency conflict:

1. Identify the blocking lane(s) from the refusal output.
2. Check the blocking lane's heartbeat:
   - If heartbeat > 24h old → the lane is stranded; `ops:reconcile` auto-blocks it and releases its locks.
   - If heartbeat is fresh → the blocking lane is active; wait or split scope.
3. If the incoming work is urgent and the blocking lane cannot be expedited:
   - PM may force-close the blocking lane via `ops:lane-close --override` with a documented reason.
   - Override closes are recorded in `truth_check_history` with `verdict: "override"`.
4. Never start a conflicting lane by manually bypassing `ops:lane-start`. The manifest is the enforcement mechanism.

---

## 8. Enforcement placement

| Rule | Mechanism |
|---|---|
| Dispatch preflight artifact | `ops:preflight` writes the machine-readable preflight result before lane start/dispatch |
| Hard limits | `ops:lane-start` reads all active manifests and counts by type |
| Executor limits | Dispatch preflight records active executor lane counts and evaluates them against §10 |
| Forbidden combinations | `ops:lane-start` checks incoming `lane_type` against active `lane_type` list |
| File-scope locks | `ops:lane-start` glob-overlap check (see `LANE_MANIFEST_SPEC.md` §6) |
| Tier C path exposure | Dispatch preflight records candidate Tier C path exposure before the lane can be started |
| Dependency blockers | Dispatch preflight records branch, token, required-doc, and dependency blockers before the lane can be started |
| Stale manifest cleanup | `ops:reconcile` (cron or pre-start) transitions heartbeat-expired manifests |
| Override tracking | `ops:lane-close --override` records in manifest `truth_check_history` |

Every dispatch attempt must have a machine-readable preflight artifact that captures:

- active lane count
- executor lane count and applicable executor limit
- forbidden lane-type combination result
- file-scope overlap result
- Tier C path exposure result
- dependency blocker result
- final dispatch decision

`ops:lane-start` must refuse to proceed when the artifact reports a deterministic blocker. The manual `lane-governor` prompt is an investigation aid only; it is not an enforcement layer and must not be treated as permission to bypass a failed preflight artifact.

No prose enforces these rules. Scripts enforce them. Prose defines the policy that scripts implement.

---

## 8a. Wave-ordered dispatch

When the execution map defines a wave sequence (e.g., Wave 7A → 7B → 7C), dispatch must respect that order:

- **Later-wave issues must not be started until their gate condition is satisfied**, even if concurrency slots are available.
- Gate conditions are recorded in `docs/05_operations/EXECUTION_MAP.md` for each wave.
- `ops:lane-start` enforces dependency blockers via the dispatch preflight artifact (§8). A wave gate manifests as a `dependency_blocker` finding in the preflight output — the lane is refused until the gate clears.
- Operators must not manually bypass wave gates. If a gate is disputed, escalate to PM.

Wave ordering is advisory in prose but enforced mechanically through dependency blocker checks in the preflight artifact. Prose alone does not enforce ordering.

---

## 8b. Merge-mutex batching (`merge-train`, UTV2-1467)

**Issued under:** UTV2-1467 (Design B of the merge-queue decision packet, `docs/05_operations/UTV2-1461-merge-queue-decision-packet.md`)
**Effective:** 2026-07-09

The merge mutex (`.ops/merge-lock.json`, enforced by `scripts/ops/merge-mutex.ts`) has historically been acquired and released once per individual merge/branch-refresh operation (`pnpm ops:merge-wrapper pr-merge`, `pr-update-branch`, `main-sync`, etc. — see §8's enforcement table). `pnpm ops:merge-wrapper merge-train --candidates-file <path.json>` (`scripts/ops/ops-merge-wrapper.ts`) changes this for a *batch* of already-green, already-gate-approved PRs: the mutex is acquired **once for the whole batch**, held for the duration of a serial, no-idle-gap drain across all candidates, and released exactly once at the end — including on partial failure or an unexpected exception, so the mutex never sticks.

This is a change to *how long a single serialized hold covers*, not to `merge_serialized_max` itself:

| Config value | Before merge-train | With merge-train |
|---|---|---|
| `merge_serialized_max` | `1` | `1` (unchanged) |
| Mutex acquired | once per PR | once per **batch** of PRs |
| Required-context re-validation | once per PR, per invalidation cycle | once per PR, per invalidation cycle (unchanged — see `docs/05_operations/WORKFLOW_SPEC.md` "Merge mechanics") |

`scripts/ops/merge-mutex.ts`'s `requireSupportedMergeSerialization()` still hard-fails any `merge_serialized_max` other than `1` — merge-train does not touch or relax that guard. A train holding the mutex for an extended drain is still exactly one serialized merge actor at a time; it is simply one actor doing more work per hold.

**Do not conflate mutex scope with lane-active state.** The lanes whose PRs are queued into a train have already completed their own lifecycle (implementation, verification, PM gates) before being handed to `merge-train` — the mutex hold during a train is a merge-sequencing concern, not a lane-concurrency-limit concern under §1/§10 above. A train in progress does not count against, or interact with, the Claude/Codex executor lane caps.

Full protocol, CLI usage, and rollback: `docs/05_operations/WORKFLOW_SPEC.md`, "Merge mechanics" section.

---

## 9. Related documents

- `docs/governance/LANE_TAXONOMY.md` — lane type definitions and per-type rules
- `docs/governance/PROOF_BUNDLE_STANDARD.md` — proof requirements per lane type
- `docs/05_operations/LANE_MANIFEST_SPEC.md` — manifest schema and file-scope lock spec
- `docs/05_operations/DELEGATION_POLICY.md` — authorization tiers and sensitive-path matrix
- `docs/05_operations/EXECUTION_TRUTH_MODEL.md` — truth hierarchy and lifecycle transitions

---

## 10. Executor-level concurrency (Claude / Codex)

The type-based limits in §1 govern which lane *types* can coexist. This section governs how many lanes each *executor* (Claude Code, Codex CLI) may hold simultaneously. Both policies apply.

**Issued under:** UTV2-979 (base standard), UTV2-1533 (2026-07-14 post-lock ramp to 10)  
**Ratified:** 2026-05-16 (PM governance review); raised 2026-07-14  
**Effective:** 2026-07-14

### Ratified standard (safe work classes — enforced mechanically)

| Executor | Ratified limit | Notes |
|---|---|---|
| Claude Code | **4 active lanes** | Safe work classes only; see §10 ineligible list |
| Codex CLI | **6 active lanes** | Safe work classes only |
| Total hard cap | **10** | Matches §1; type-level limits always apply on top |

All limits are sourced from `docs/governance/CONCURRENCY_CONFIG.json`. Scripts read this file directly — no manual sync required. The limits are enforced by `ops:lane-start` before any branch or manifest is created.

Pre-dispatch gates (all required when running ≥4 total lanes):

1. `pnpm exec tsx scripts/ops/merge-risk.ts` — no `hard_fail` or `block` findings
2. `pnpm exec tsx scripts/ops/lane-maximizer.ts` — no `DISPATCH_LIMIT` or `OVERLAP` findings
3. All candidate lanes have execution packets (via `scripts/ops/execution-packet.ts`)
4. Each lane attempt has a passing dispatch preflight artifact per §8

### 10a. Full verification throttle

Executor slot counts answer "how many lanes may be active." They do not answer
"how many lanes may run the memory-heavy verification suite at the same time."
On WSL2 hosts with default memory and swap ceilings, concurrent `pnpm verify`,
`pnpm type-check`, and `pnpm test` runs can exhaust the VM and kill test
processes without a useful failure line.

Preflight therefore has an independent local semaphore for the heavy baseline
section (`pnpm type-check` followed by `pnpm test`). The default limit is **1**
concurrent full-verification slot per worktree checkout, recorded under
`.out/ops/preflight/full-verify-semaphore/`. Operators may temporarily raise the
limit with `UNIT_TALK_FULL_VERIFY_CONCURRENCY=<n>` only when the host memory and
swap ceiling have been sized for that load. This does **not** change
`CONCURRENCY_CONFIG.json` and does not raise Claude or Codex executor caps.

`scripts/ops/lane-maximizer.ts` reports the current full-verification throttle
state in `lane_saturation_forecast.full_verify_throttle`. If that throttle is
saturated, do not start another manual full `pnpm verify`/`pnpm test` run until a
slot clears, even if executor lane slots are still available.

Example 5-lane topology (safe class mix):
```
1 × Runtime          (Claude or Codex — singleton by type, not counted in executor safe-class limit)
1 × Verification     (Claude — read-only)
1 × Governance       (Claude — docs only)
2 × Hygiene          (Codex — disjoint file scopes)
```
Total: 5 lanes, Claude 2, Codex 2 (Runtime may be either).

### Safe work classes

The ratified limits apply to these lane types only:

| Lane type | Notes |
|---|---|
| Governance | Docs, policy, CI workflows, audit |
| Hygiene | Linting, cleanup, dead-code removal, scaffolding |
| Verification | Proof bundles, evidence, truth-check tooling |
| Delivery/UI | `apps/command-center`, `apps/discord-bot`, `apps/smart-form`, `apps/qa-agent` |

### Ineligible work classes (singleton per type — hard limit unchanged)

These lane types are **always singleton**, regardless of executor counts or PM wave authorization:

| Lane type | Reason |
|---|---|
| Runtime | Active pick pipeline write path; one write path at a time |
| Migration | Serial DB deploy required; concurrent merge creates rollback ambiguity |
| Modeling | Shadow scoring cannot compare against two moving baselines |
| Data/Canonical | Touches schema or ingestor; same constraints as Migration |

### 10-lane ceiling — ratified and mechanically enforced

The 10-lane operating model (4 Claude + 6 Codex) is the ratified default as of UTV2-1533 (2026-07-14), superseding the 6-lane (2 Claude + 4 Codex) stabilization-era ceiling. It is enforced by:

1. **`ops:lane-start`** — reads `CONCURRENCY_CONFIG.json` and refuses when any limit would be exceeded
2. **`ops:execution-state`** — reports `dispatch_slots` using the same config values
3. **`ops:merge-risk`** — emits `DISPATCH_LIMIT_SATURATION` based on the same config values
4. **`ops:lane-maximizer`** — evaluates candidates against the same config defaults

To raise limits above 10 requires a PM-authorized change to `CONCURRENCY_CONFIG.json` with a PR, not a prose override. Note: raising the executor cap alone does not guarantee genuine parallelism — see UTV2-1472 (Claude lanes currently dispatch sequentially in the orchestrator session; unblocked but not yet implemented as of this ramp).

### Canonical citation

When `dispatch-board`, `dispatch`, or any agent skill references executor-level lane count limits, this section (§10) is the single authoritative source. Do not duplicate limit values in prose — link here.

---

## 11. Trial governor (12–14 lane ceiling)

**Issued under:** UTV2-1165 (mechanism), UTV2-1533 (2026-07-14, retargeted from the exhausted 7–8 lane trial to a 12–14 lane trial once the 10-lane base wave proves healthy)  
**Effective:** 2026-07-14

The ratified default ceiling is 10 lanes (§1, §10). When operational demand requires temporarily operating at 12–14 lanes — and only after the 10-lane wave has run healthy per the ramp criteria in §6 — a PM-authorized trial governor may raise the ceiling for a bounded period. The prior 7–8 lane trial (UTV2-1165) expired 2026-06-26 and was absorbed into the new 10-lane base rather than renewed; it is not usable as-is.

### Enabling the trial governor

The trial governor is configured in `docs/governance/CONCURRENCY_CONFIG.json` under the `trial` key:

```json
"trial": {
  "enabled": true,
  "total": 14,
  "executors": { "claude": 5, "codex": 9 },
  "allowed_until": "2026-08-15T00:00:00Z",
  "rationale": "UTV2-XXXX: reason for trial authorization",
  "safe_types_only": ["governance", "hygiene", "delivery-ui", "verification"]
}
```

**Only PM may enable the trial governor.** Enabling it requires a PR changing `CONCURRENCY_CONFIG.json` with `tier:T1` label and PM approval, and should not happen until the 10-lane base wave has demonstrated the health criteria in §6 (no ghost-lane spike, no repeated stale-lease/substrate-guard failures, stable merge-train drain rate, stable CI/review delay).

### Behavior

`getEffectiveConfig()` in `scripts/ops/concurrency-config.ts` returns the active limit set:

| Condition | Effective limits |
|---|---|
| `trial.enabled = false` | Base limits (total: 10, claude: 4, codex: 6) |
| `trial.enabled = true` AND `allowed_until` is in the future (or null) | Trial limits (total: 14, claude: 5, codex: 9) |
| `trial.enabled = true` AND `allowed_until` is in the past | **Auto-reverts** to base limits — no action required |

### Safe-types constraint

During a trial, only `safe_types_only` lane types may fill slots above the base ceiling. Singleton-type rules (§1) are unchanged — runtime, migration, modeling, and data-canonical remain singletons regardless of trial state.

### Auto-revert

The trial governor is time-bounded. When `allowed_until` passes, `getEffectiveConfig()` silently returns base limits. No manual intervention is required. The next `ops:lane-start` call will enforce the reverted base ceiling.

### Audit trail

- Trial enables/disables are tracked in `CONCURRENCY_CONFIG.json` git history.
- The rationale field must cite the authorizing Linear issue.
- Trial must not be extended past its `allowed_until` without a new PM-authorized PR.
