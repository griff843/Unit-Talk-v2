# /lane-management

Govern lane lifecycle from `ops:lane:start` to `ops:lane:close`. The lane manifest is the sole authority for active lane state — not Linear, not chat.

**Specs:** `LANE_MANIFEST_SPEC.md`, `EXECUTION_TRUTH_MODEL.md`

---

## Lifecycle

```
Ready → Started → In Progress → In Review → Merged → Done
            │           │            │          │
            └→ Blocked  └→ Blocked   └→ Blocked └→ Reopened
```

## Commands

| Command | Purpose |
|---|---|
| `ops:preflight` | verify env/git/deps, emit preflight token |
| `ops:lane:start <UTV2-###>` | create manifest, worktree, branch, file locks |
| `ops:lane:close <UTV2-###>` | run truth-check, transition Linear, close manifest |
| `ops:truth-check <UTV2-###>` | the done-gate |
| `ops:lane:resume <UTV2-###>` | re-preflight and resume stranded/blocked lane |
| `ops:lane:block <UTV2-###>` | mark blocked with reason |

**No start without preflight. No close without truth-check.**

---

## Lane start checklist

- [ ] Issue has tier label (T1/T2/T3)
- [ ] Preflight token valid (current session)
- [ ] `file_scope_lock[]` declared
- [ ] No overlap with active lanes
- [ ] `expected_proof_paths[]` set (non-empty for T1/T2)
- [ ] No prior manifest for this issue (unless `done`)

---

## File-scope lock

Declared at lane start, immutable for lane life. Overlap check is hard — second lane is refused. Locks release on `status: done`. Blocked/reopened lanes retain locks.

Do not edit files outside your lane's scope. Scope bleed in Codex returns is a rejection reason.

---

## Heartbeats

| Age | Action |
|---|---|
| < 4h | Normal |
| 4–24h | Flagged stale |
| > 24h | Auto-blocked (`stranded`) |

Resume stranded lanes with `ops:lane:resume`.

---

## Blocked lanes

Retain manifest, branch, worktree, and file locks. Block any new lane on overlapping scope. Resume via `ops:lane:resume`.

## Reopened lanes

Post-Done truth-check failure → `status: reopened`. Fix the specific failing check, then re-run truth-check. Never cosmetically re-close.
