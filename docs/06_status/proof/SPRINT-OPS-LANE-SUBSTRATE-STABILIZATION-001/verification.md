# SPRINT-OPS-LANE-SUBSTRATE-STABILIZATION-001 — Verification

**Mission:** Investigate and stabilize the lane-execution substrate after `.ops/leases`,
`.ops/merge-lock.json`, the UTV2-1196 worktree directory, and its git worktree registration
appeared to vanish mid-dispatch. Add a fail-closed dispatch preflight guard.

**Executor:** Claude (no Codex launched). **Base SHA:** `a9ae6d9fff32e333ef169fb4cd90f2d8a657b057`
**Merge SHA:** `cc903083174e0ec7340dd74aff373d1eea353b67` (PR #952, merged 2026-06-03)
**State:** merged to main. **Date:** 2026-06-03

> Constraints honored: Codex not launched · UTV2-1196 not started/dispatched · UTV2-1150 deploy WIP untouched.

---

## Summary

Added a fail-closed lane-substrate guard (`scripts/ops/substrate-guard.ts`, `pnpm ops:substrate-guard`)
that refuses dispatch when the lane-execution substrate is unsafe, wired mechanically into `/dispatch`
Phase 0 and `ops:lane-start`. Root cause of the substrate "vanish" was WSL2/filesystem transient ENOENT,
not deletion. Includes the proof-gate lane recovery-state restore and this evidence bundle. No Codex
launched; no proof-gate implementation; the proof-gate lane not started; the deploy WIP untouched.

## Evidence

Per-outcome evidence, commands, and machine-readable results are recorded below (Outcomes 1–7) and in
`evidence.json` in this directory.

---

## Outcome 1 — Root cause of the "vanish"

**Conclusion: WSL2 / filesystem transient ENOENT — NOT a cleanup script, NOT `git worktree prune`,
NOT Claude/Codex cleanup behavior.**

Evidence:

1. **Code search (two independent sweeps) found no automatic/background deletion** of `.ops/leases/`,
   `.ops/merge-lock.json`, or `.out/worktrees/`:
   - `lease-registry.ts` — `releaseLease`/`reclaimLease`/`markExpiredActiveLeases` mutate **status only**, never `unlink`.
   - `merge-mutex.ts` `releaseMergeLock` sets status `released`, never deletes the file.
   - `orchestration-reconciler.ts` proposes `git worktree remove` only for `merged`/`done` lanes and is **dry-run only** (`Cleanup apply is not automated yet`).
   - `lane-clean.ts` is validator-first and refuses to delete without explicit opt-in.
   - No `.husky/`, no cron, no `setInterval`, no pnpm pre/post hook, no GitHub Action performs substrate deletion.
2. **Mtime evidence — files were never recreated, therefore never deleted.** At the moment they were
   reported "missing" (~15:32Z), the files were present with mtimes *predating* that observation:
   `.ops/leases/UTV2-1196.json` mtime `11:29` (15:29Z), `.ops/merge-lock.json` mtime `11:25`. A delete+recreate
   would have produced fresh mtimes; they did not.
3. **Transience probe:** 12 rapid `stat` cycles on the worktree + `.ops/leases` → **12 hits, 0 misses.**
4. **Environment:** `.out` is ext4 on the WSL2 virtual disk (`/dev/sdd`, mount option `discard`) with
   **122 registered git worktrees** — heavy directory pressure, a known source of transient ENOENT under load.

Process check (`ps`) during the incident window showed **no** reaper/reconciler/dispatch process running.

| Candidate cause | Verdict |
|---|---|
| Known cleanup script | ❌ ruled out (all deletion explicit + dry-run + fail-closed) |
| `git worktree prune` | ❌ ruled out (worktree still registered + on disk; mtimes unchanged) |
| Claude/Codex cleanup | ❌ ruled out (no agent process; no deletion path) |
| **WSL / filesystem instability (transient ENOENT)** | ✅ **most supported** |
| Unknown | partially — exact WSL trigger (memory pressure / VHDX I/O) not isolatable from inside the guest |

---

## Outcome 2 — Safe lane-substrate expectations (restored / asserted)

Current substrate confirmed intact and healthy:

- `.ops/leases/` — present (directory); guard initializes it idempotently if genuinely absent.
- `.ops/merge-lock.json` — present, status `released` (valid idle state). A missing/released/held lock is
  the normal idle/active state; only a *present-but-corrupt* lock is unsafe.
- `.out/worktrees/` — 122 worktrees registered; UTV2-1196 worktree present on disk.
- git worktree registration — UTV2-1196 registered at `88737607` and directory exists.

The guard encodes these as machine-checkable expectations (see Outcome 3).

---

## Outcome 3 — Fail-closed dispatch preflight guard (the deliverable)

New: `scripts/ops/substrate-guard.ts` (+ `scripts/ops/substrate-guard.test.ts`), `pnpm ops:substrate-guard`.

Refuses dispatch (exit 1) when:

| # | Condition | Code | Severity |
|---|---|---|---|
| 1 | `.ops/leases/` missing AND cannot be initialized | `lease_dir_uninitializable` | hard_fail |
| 2 | `.ops/merge-lock.json` present-but-invalid/corrupt | `merge_lock_invalid` | hard_fail |
| 3+4 | active lane's registered worktree directory missing | `active_lane_missing_worktree` | hard_fail |
| 5 | Linear state conflicts with local manifest (with `--check-linear`) | `linear_manifest_conflict` | hard_fail |
| 6 | existing board `hard_fail` lane (folds in `ops:merge-risk`) | `board_hard_fail:<code>` | hard_fail |
| — | orphan registered worktree dir missing (prune candidate) | `orphan_worktree_missing_dir` | warning |

**WSL robustness (directly addresses Outcome 1):** existence of substrate that would *fail closed* is
probed with bounded retries (`robustExists`) before being declared genuinely absent, so a transient ENOENT
cannot produce a false hard_fail. A genuinely-missing path still fails closed after retries are exhausted.

**Mechanical enforcement points (not prose-only):**
- `pnpm ops:substrate-guard` is wired as the FIRST gate of `/dispatch` Phase 0 (`.claude/commands/dispatch.md`).
- `scripts/ops/lane-start.ts` runs the guard (local checks) before reserving a lease / creating a worktree —
  so no lane can move toward "In Codex" or launch Codex on unsafe substrate even if Phase 0 is skipped.
  Break-glass: `--force-unsafe-substrate` (logged in the failure payload).
- Codex launch is transitively gated: `codex-exec` requires the manifest that only a successful
  guarded `lane-start` produces.

Linear/manifest conflict (condition 5) is best-effort: without `LINEAR_API_TOKEN` (or `--check-linear`) it is
reported as a **skipped warning, never a silent pass**, and authoritative Linear drift detection is delegated
to `ops:orchestration-reconcile` (also in Phase 0).

---

## Outcome 4 — UTV2-1196 recovery state (validated + stabilized)

| Check | Result |
|---|---|
| Linear state | `Ready for Codex` (unstarted) — no false "In Codex" |
| Linear history | Backlog → Ready (15:23) → In Codex (15:29) → **Ready (15:56, clean revert)** |
| branch / commit | `codex/utv2-1196-…` @ `88737607` present |
| worktree | present on disk + registered |
| manifest (main checkout) | **restored** from `88737607` (was branch-only) → lane is resume-consistent |
| lease | orphaned `active` lease (owner pid 29736 **dead**) → **released** via `ops:lease release` |
| Codex | **not launched** (no `codex exec` process) |

Two inconsistencies found and stabilized: (a) an orphaned active lease with a dead owner pid (released), and
(b) the manifest living only on the branch (restored to main checkout). Result: branch + worktree + manifest
all present and consistent ⇒ **safely redispatchable** via `/dispatch UTV2-1196 --executor=codex` later.

---

## Outcome 5 — UTV2-1150 deploy WIP untouched

My changeset for this sprint is exactly: `scripts/ops/substrate-guard.ts` (new),
`scripts/ops/substrate-guard.test.ts` (new), `scripts/ops/lane-start.ts` (edit), `package.json` (edit),
`.claude/commands/dispatch.md` (edit), `docs/06_status/lanes/UTV2-1196.json` (restored), and this proof bundle.
**No UTV2-1150 / deploy path is in that set.**

UTV2-1150 WIP blob hashes (operator content, unmodified by me):

```
1187e21518224a8fbb7997adc509fa5f65089f19  .github/workflows/deploy.yml
7496729f5d8dc95371a827423f9f1cac6b197e4d  .github/workflows/staging-deploy.yml
15d7446cc6019cd9d9d173f759e0fcbb1de565be  deploy/production/docker-compose.yml
c3e8eac3b1f3923cdd10dd9b5a5bdb9eabc94d47  deploy/production/topology-spec.yml
6788cbc733f6e3c5fdafbdbd6b7de304abcf3cbe  docs/06_status/lanes/UTV2-1150.json
fbe40a0d42fe4a564e7164dfb5150a6e4c1fc7fc  docs/06_status/proof/UTV2-1150/evidence.json
da6db1e78b4d74c3917efe983fa4c23e44450e7b  scripts/deploy-check.test.ts
9877070270f70adf777fd9dbf8a2e99730bd459f  scripts/deploy-check.ts
```

(Note: the operator independently advanced UTV2-1150 to `status: done` between turns, which cleared the
earlier `MERGED_PR_ACTIVE_LANE` board hard_fail. That was the operator's action, not mine.)

---

## Outcome 7 — Commands run (results)

- `git status --short` — captured (my files vs operator WIP cleanly separated). ✅
- `git worktree list` — 122 worktrees; UTV2-1196 registered @ `88737607`. ✅
- lane preflight command `pnpm ops:substrate-guard` — `ok: true`, 0 hard_fail (full + `--skip-merge-risk`). ✅
- `pnpm ops:merge-risk` (folded into guard) — 0 hard_fail / 0 block / 0 warning. ✅
- `npx tsx --test scripts/ops/substrate-guard.test.ts` — **18/18 pass**. ✅
- `pnpm type-check` — **PASS** (exit 0). ✅
- `pnpm test` (via `pnpm verify`) — **PASS**: test 113/113, including `scripts/ops/substrate-guard.test.ts` 18/18. ✅
- `pnpm lint` — **PASS** (exit 0). ✅
- `pnpm verify` — **PASS (exit 0)**: env:check + lint + type-check + build + test + verify:commands (command-manifest check, 117 migrations version-checked + linted) all green. ✅

---

## Acceptance

> PASS only if future dispatch fails closed when lane substrate is unsafe and UTV2-1196 can be safely redispatched later.

- **Fails closed when unsafe:** unit tests prove every hard_fail condition blocks (`ok:false`); live guard
  blocks on a board hard_fail; `lane-start` refuses on unsafe local substrate. ✅
- **Does not paralyze when safe:** transient ENOENT tolerated via retry; orphan worktrees are warnings, not
  hard_fails; live guard returns `ok:true` on the current healthy substrate. ✅
- **UTV2-1196 redispatchable:** branch + worktree + manifest consistent, Linear `Ready for Codex`, lease released. ✅

**Status: PASS** — `pnpm verify` green (exit 0).
