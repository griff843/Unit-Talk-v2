# Lane Concurrency Policy — Unit Talk V2

**Status:** Canonical  
**Authority:** `docs/governance/LANE_TAXONOMY.md`, `docs/05_operations/LANE_MANIFEST_SPEC.md`  
**Issued under:** UTV2-955  
**Effective:** 2026-05-15  

This document defines the concurrency rules for simultaneous execution of lanes in Unit Talk V2. It supplements the lane taxonomy with the enforcement mechanism for safe parallel execution.

The goal is to scale from 3 active lanes to 5 safely, with a clear path to 6–8.

---

## 1. Hard limits (always enforced)

These limits are hard caps enforced by `ops:lane:start`. The command refuses if a limit is breached.

| Limit | Value | Enforcement |
|---|---|---|
| Total active lanes (any type) | **5** | `ops:lane:start` rejects lane 6 |
| Runtime lanes | **1** | `ops:lane:start` rejects second Runtime |
| Migration lanes | **1** | `ops:lane:start` rejects second Migration |
| Modeling lanes | **1** | `ops:lane:start` rejects second Modeling |
| Data/Canonical lanes | **1** | `ops:lane:start` rejects second Data/Canonical |
| Hygiene lanes | **3** | `ops:lane:start` rejects fourth Hygiene |
| Governance lanes | **3** | `ops:lane:start` rejects fourth Governance |
| Delivery/UI lanes per app | **1** | `ops:lane:start` rejects second lane touching same app path |
| Verification lanes per target issue | **1** | `ops:lane:start` rejects second Verification for same target |

Active means `status ∈ {started, in_progress, in_review, blocked, reopened}`. Closed (`done`) and stale manifests older than 48h do not count toward these limits.

---

## 2. File-scope lock precedence

Before any limit check, `ops:lane:start` runs a **file-scope lock scan**:

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

These are compile-time forbidden. `ops:lane:start` blocks them unconditionally, even if the file scopes do not overlap.

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

When in doubt, declare the file scope and let `ops:lane:start` arbitrate.

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

## 6. Scaling to 5–8 lanes safely

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

Total: up to 8 lanes simultaneously if the above distribution is respected.

---

## 7. Conflict resolution protocol

When `ops:lane:start` refuses a new lane due to concurrency conflict:

1. Identify the blocking lane(s) from the refusal output.
2. Check the blocking lane's heartbeat:
   - If heartbeat > 24h old → the lane is stranded; `ops:reconcile` auto-blocks it and releases its locks.
   - If heartbeat is fresh → the blocking lane is active; wait or split scope.
3. If the incoming work is urgent and the blocking lane cannot be expedited:
   - PM may force-close the blocking lane via `ops:lane:close --override` with a documented reason.
   - Override closes are recorded in `truth_check_history` with `verdict: "override"`.
4. Never start a conflicting lane by manually bypassing `ops:lane:start`. The manifest is the enforcement mechanism.

---

## 8. Enforcement placement

| Rule | Mechanism |
|---|---|
| Hard limits | `ops:lane:start` reads all active manifests and counts by type |
| Forbidden combinations | `ops:lane:start` checks incoming `lane_type` against active `lane_type` list |
| File-scope locks | `ops:lane:start` glob-overlap check (see `LANE_MANIFEST_SPEC.md` §6) |
| Stale manifest cleanup | `ops:reconcile` (cron or pre-start) transitions heartbeat-expired manifests |
| Override tracking | `ops:lane:close --override` records in manifest `truth_check_history` |

No prose enforces these rules. Scripts enforce them. Prose defines the policy that scripts implement.

---

## 9. Related documents

- `docs/governance/LANE_TAXONOMY.md` — lane type definitions and per-type rules
- `docs/governance/PROOF_BUNDLE_STANDARD.md` — proof requirements per lane type
- `docs/05_operations/LANE_MANIFEST_SPEC.md` — manifest schema and file-scope lock spec
- `docs/05_operations/DELEGATION_POLICY.md` — authorization tiers and sensitive-path matrix
- `docs/05_operations/EXECUTION_TRUTH_MODEL.md` — truth hierarchy and lifecycle transitions
