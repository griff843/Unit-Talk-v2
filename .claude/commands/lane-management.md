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

## Lane close checklist (pre-closure — all 7 steps required)

- [ ] `pnpm verify` green on the branch
- [ ] R-level lookup in `docs/05_operations/r1-r5-rules.json` — all triggered `required[]` artifacts present
- [ ] Proof tied to merge SHA (not the branch HEAD SHA — the SHA after merge)
- [ ] CI green on merge SHA (not just branch CI)
- [ ] For T1: `pnpm test:db` green + evidence bundle generated and validated
- [ ] Tier label is set on PR: verify with `gh pr view <number> --json labels`
      If missing: `gh pr edit <number> --add-label "tier:T1"` (adjust tier as needed)
- [ ] `ops:truth-check` runs and exits 0

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

---

## Rationalization resistance

| You might think… | But actually… |
|---|---|
| "I'll update the lane manifest later" | The manifest is the sole authority for active state. Update it now or the lane doesn't exist. |
| "File scope is close enough" | Scope lock is exact. One file outside scope = rejection. Declare it or don't touch it. |
| "Preflight passed last time" | Preflight tokens are session-scoped. New session = new preflight. |
| "I can close without truth-check, it's obvious" | No close without truth-check. Obvious is not verified. |
| "Two lanes won't really overlap" | Overlap check is hard. If scopes touch, the second lane is refused. No exceptions. |
