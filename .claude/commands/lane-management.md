---
description: "Use when: starting, progressing, blocking, closing any lane"
---
# /lane-management

Govern lane lifecycle. The lane manifest is the sole authority for active lane state — not Linear, not chat.

**Done-gate / close checklist:** `/verification`
**Specs:** `docs/05_operations/LANE_MANIFEST_SPEC.md`, `docs/05_operations/EXECUTION_TRUTH_MODEL.md`

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
| `ops:lane-start <UTV2-###>` | create manifest, worktree, branch, file locks |
| `ops:lane-close <UTV2-###>` | run truth-check, transition Linear, close manifest |
| `ops:truth-check <UTV2-###>` | the done-gate |
| `ops:lane:resume <UTV2-###>` | re-preflight and resume stranded/blocked lane |
| `ops:lane:block <UTV2-###>` | mark blocked with reason |

**No start without preflight. No close without truth-check.**

**T3 docs-only fast path:** T3 issues whose complete file set is limited to `docs/06_status/**` or `.claude/commands/*.md` may bypass worktree, manifest, lease, sync, and truth-check closeout ceremony after the scripts validate the boundary:
```bash
pnpm ops:preflight UTV2-### --tier T3 --branch <branch> --docs-only-fast-path --files <path1> [--files <path2> ...]
pnpm ops:lane-start UTV2-### --tier T3 --branch <branch> --docs-only-fast-path --files <path1> [--files <path2> ...]
```
`--files` must be repeated once per path (`--files a --files b`), never space-separated after a single `--files` — the parser only consumes the next token as each flag's value, so additional space-separated paths are silently dropped as ignored positionals and would let an undetected non-docs path through. The second command must return `code: "docs_only_fast_path"`. Any non-docs path, missing file list, or non-T3 tier fails closed and requires the normal lane lifecycle.

---

## Lane start checklist

- [ ] Issue has tier label (T1/T2/T3)
- [ ] Preflight token valid (current session)
- [ ] `file_scope_lock[]` declared
- [ ] No overlap with active lanes
- [ ] `expected_proof_paths[]` set (non-empty for T1/T2)
- [ ] No prior manifest for this issue (unless `done`)

For the T3 docs-only fast path, replace this checklist with the two script validations above plus normal PR CI, branch discipline, lane authority, merge gate, tier label, and Linear auto-close. Do not create a manifest or sync file for a validated fast-path lane.

## Lane close checklist

Pre-closure checklist (R-level, proof, CI, tier label, truth-check) lives in `/verification`. Run it before `ops:lane-close`.

---

## File-scope lock

Declared at lane start, immutable for lane life. Overlap check is hard — second lane is refused. Locks release on `status: done`. Blocked/reopened lanes retain locks.

Do not edit files outside your lane's scope. Scope bleed in a returned Claude or Codex lane is a rejection reason — the same standard applies to both executors.

## Concurrent lanes

Multiple lanes — Claude and/or Codex, in any mix — may be active at once, up to the executor limits in `docs/governance/CONCURRENCY_CONFIG.json`. Claude is not single-threaded: `/dispatch` runs Claude implementation as a background agent per lane (`/dispatch` Phase 4), the same pattern already used for Codex, so several Claude lanes can execute with overlapping windows as long as each has its own worktree and a disjoint `file_scope_lock`. Concurrency applies to execution only — merge and lane-close remain serialized through the merge mutex (`ops:merge-lock`) regardless of executor or how many lanes finished implementing around the same time.

---

## Heartbeats

| Age | Action |
|---|---|
| < 4h | Normal |
| 4–24h | Flagged stale |
| > 24h | Auto-blocked (`stranded`) |

Resume stranded lanes with `ops:lane:resume`.

---

## Blocked / reopened

**Blocked:** retain manifest, branch, worktree, file locks. Block any new lane on overlapping scope. Resume via `ops:lane:resume`.

**Reopened:** post-Done truth-check failure → `status: reopened`. Fix the specific failing check, then re-run truth-check. Never cosmetically re-close.

---

## Rationalization resistance

| You might think… | But actually… |
|---|---|
| "I'll update the lane manifest later" | The manifest is the sole authority for active state. Update it now or the lane doesn't exist. |
| "File scope is close enough" | Scope lock is exact. One file outside scope = rejection. Declare it or don't touch it. |
| "Preflight passed last time" | Preflight tokens are session-scoped. New session = new preflight. |
| "I can close without truth-check, it's obvious" | No close without truth-check. Obvious is not verified. |
| "Two lanes won't really overlap" | Overlap check is hard. If scopes touch, the second lane is refused. No exceptions. |


## Pre-closure checklist and lane-close (moved from CLAUDE.md, WORK-2026112502)

**Pre-closure checklist (7 steps — all required before `ops:lane-close`):**
1. `pnpm verify` green on the branch
2. R-level lookup in `docs/05_operations/r1-r5-rules.json` — all triggered `required[]` artifacts present
3. Proof SHA binding automated — `post-merge-lane-close.yml` runs `ops:proof-generate --merge-sha` after merge; no manual append needed
4. CI green on merge SHA (not just branch CI)
5. For T1: `pnpm test:db` green + evidence bundle generated and validated
6. Tier label auto-applied by `ops:lane-finalize`; verify tier label is set in Linear
7. `ops:truth-check` runs and exits 0

`ops:lane-close <ID>` is already the one-command post-merge entry point: it runs `ops:truth-check` internally, and on success marks the manifest `done` and transitions the Linear issue to Done — no separate manual truth-check invocation is required first. If the manifest is missing its merge SHA or drifted from the merged PR, `ops:lane-close <ID> --repair-merged` repairs it directly from GitHub's authoritative merge state (`pr.mergeSha`) before running truth-check, instead of requiring a manual `ops:lane-manifest record-merge` step. `ops:lane-finalize <ID>` remains a required separate call for tier-label application (step 6); `ops:lane-close` does not apply tier labels.
