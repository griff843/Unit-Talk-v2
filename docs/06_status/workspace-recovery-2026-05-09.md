# Workspace Recovery — 2026-05-09

**Lane scope:** repo-state recovery (no UTV2 issue)
**Operator:** Claude (orchestrator)
**HEAD at recovery start:** `f3cb0519` (`feat(api): UTV2-869 add scorer runtime observability`)
**origin/main HEAD:** `17c39664` (local is +1 commit ahead — `f3cb0519` is committed locally but not yet pushed)

---

## 1. Initial state

- `git status --short` reported **342 dirty entries**:
  - **304 deletions** (`D`) — entire `packages/{alert-runtime,config,contracts,db,domain,events,intelligence,observability,verification}` trees
  - **20 modifications** (`M`)
  - **18 untracked** (`??`)
- No merge-conflict markers anywhere.
- `find packages -type f` returned **0** — the package directories existed as empty shells but every tracked file inside had been physically removed from disk. Whatever ran the deletion left empty directories and removed file contents.
- All tracked package contents were intact in `git ls-tree -d HEAD packages/` (304 tree entries), so HEAD was a complete restoration source.

---

## 2. Classification

Every dirty file was bucketed before any action was taken.

### Bucket A — UTV2-870 (intentional, keep)

`provider_offer_history_summarize_fix` — fixes the `p_date AS snapshot_date` collision in `summarize_provider_offer_history_partition()`.

| File | Status | Note |
|---|---|---|
| `supabase/migrations/202605090002_utv2_870_provider_offer_history_summarize_fix.sql` | `??` | new migration |
| `scripts/provider-offer-history-retention-summarize.test.ts` | `??` | unit test pinning the migration body |
| `apps/ingestor/src/scripts/utv2-772-retention-proof.ts` | `M` | renames RPC arg `p_cutoff_date → p_date` to match the new function signature |

### Bucket B — UTV2-871 (intentional, keep)

`provider_offers_quarantine_prune_fix` — adds the `created_at, id` index on `provider_offers_legacy_quarantine` and retargets the bounded prune to the quarantine base table.

| File | Status |
|---|---|
| `supabase/migrations/202605090003_utv2_871_provider_offers_quarantine_prune_fix.sql` | `??` |
| `scripts/provider-offers-quarantine-prune-fix.test.ts` | `??` |

### Bucket C — UTV2-869 (already merged locally)

Commit `f3cb0519` is on local `main` but not yet on `origin/main`. Preserved in place.

| File | Status |
|---|---|
| `docs/06_status/proof/UTV2-869-runtime-drift/` (4 files: `evidence.json`, `live-write-trace.json`, `remediation.md`, `runtime-path-analysis.md`) | `??` |

The proof directory documents the live runtime drift investigation that motivated UTV2-869's observability work. It cites `scored_candidates_total: 7051` against project `zfzdnfwdarxucxtaojxm`.

### Bucket D — Schema-drift-gate / Phase 9 reconciliation (intentional, keep — separate lane)

CI-side schema drift authorization gate plus a one-shot phase-9 schema reconciliation script. Tied together by the `package.json` and `live-schema-parity.yml` changes.

| File | Status | Note |
|---|---|---|
| `scripts/ci/schema-drift-gate.ts` | `??` | new CI gate |
| `scripts/ci/schema-drift-gate.test.ts` | `??` | |
| `scripts/ci/live-schema-parity-workflow.test.ts` | `??` | |
| `scripts/utv2-phase9-schema-reconciliation.ts` | `??` | enumerates 17 target migration versions |
| `scripts/utv2-phase9-schema-reconciliation.test.ts` | `??` | |
| `package.json` | `M` | adds `ci:schema-drift-gate` script + 3 entries in `test:ops` |
| `.github/workflows/live-schema-parity.yml` | `M` | wires the gate after `db:compare` and broadens artifact upload path |

### Bucket E — Supabase project-ref swap (intentional, keep)

11 files rewritten to swap `feownrheeefbcsehtsiw → zfzdnfwdarxucxtaojxm`. Matches the canonical project ref declared in `CLAUDE.md`.

| File | Status |
|---|---|
| `AGENTS.md` | `M` |
| `docs/05_operations/CHAMPION_INVENTORY_STANDARD.md` | `M` |
| `docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md` | `M` |
| `docs/05_operations/MERGE_DEPLOY_DISCIPLINE.md` | `M` |
| `docs/ops/rollback-rehearsal.md` | `M` |
| `scripts/db-lookup.ts` | `M` |
| `scripts/evidence-bundle/new-bundle.mjs` | `M` |
| `scripts/evidence-bundle/validate-bundle.mjs` | `M` |
| `scripts/evidence-bundle/validate-bundle.test.ts` | `M` |
| `scripts/pi-m5-verify.ts` | `M` |
| `scripts/verify-388.ts` | `M` |

### Bucket F — UTV2-854 proof rerun (regenerated, keep — needs PM review)

Six files under `docs/06_status/proof/UTV2-854/` were re-emitted at `2026-05-09T16:40:23Z` (previously `2026-05-08T15:11:44Z`). Counts moved (`scored_candidates_total: 6978 → 7051`, `null_ownership: 6978 → 7051`), consistent with the UTV2-869 drift evidence captured above. The lane was already merged (`#606`, `2c434a78`); this is a post-merge regeneration tied to the drift investigation, not new lane work.

| File | Status |
|---|---|
| `docs/06_status/proof/UTV2-854/evidence.json` | `M` |
| `docs/06_status/proof/UTV2-854/migration-results.json` | `M` |
| `docs/06_status/proof/UTV2-854/ownership-enforcement-results.csv` | `M` |
| `docs/06_status/proof/UTV2-854/ownership-persistence-summary.json` | `M` |
| `docs/06_status/proof/UTV2-854/ownership-quarantine-results.csv` | `M` |
| `docs/06_status/proof/UTV2-854/ownership-write-results.csv` | `M` |

**PM decision needed:** are post-merge proof regenerations meant to be committed back to the closed lane's proof dir, or should they live under the UTV2-869 drift investigation? Not auto-resolved.

### Bucket G — Other untracked artifacts (mixed scratch / other-lane proof)

| File | Likely owner | PM decision |
|---|---|---|
| `cron-verification-checklist.md` (repo root) | UTV2-862 (cron verification) | Move to `docs/` or delete; root scratch is not policy. |
| `manual-lifecycle-results.json` (repo root) | UTV2-862 | Same — root scratch. |
| `docs/06_status/board-audit-2026-05-09.md` | board audit | Keep, but separate lane. |
| `docs/06_status/final-board-audit-2026-05-09.md` | board audit | Keep, but separate lane. |
| `docs/06_status/proof/UTV2-860-phase9-ledger-reconciliation.json` | UTV2-860 | Keep, separate lane. |
| `docs/06_status/proof/UTV2-861-low-risk-convergence-verification.json` | UTV2-861 | Keep, separate lane. |
| `docs/06_status/proof/UTV2-862-cron-verification-plan.md` | UTV2-862 | Keep. |
| `docs/06_status/proof/UTV2-862-manual-lifecycle-verification.md` | UTV2-862 | Keep. |

None of these were created or removed by recovery. They remain untracked and quarantined for PM disposition.

### Bucket H — Accidental `packages/*` deletions (304 files, **restored**)

All tracked files under these trees had been physically removed:

```
packages/alert-runtime/   (9 files)
packages/config/          (6 files)
packages/contracts/       (13 files)
packages/db/              (30 files)
packages/domain/          (108 files)
packages/events/          (4 files)
packages/intelligence/    (4 files)
packages/observability/   (5 files)
packages/verification/    (125 files)
```

No file inside `packages/` showed any modification (`git status -s packages/` had only `D` lines and 0 `M` lines). No non-empty files remained on disk under `packages/`. Therefore HEAD was an unambiguous restoration source — no intentional in-flight work could be lost by the restore.

**Action taken:** `git checkout HEAD -- packages/`. Restored all 304 files to their HEAD content. Post-restore, `find packages -type f` returns 304, and `git status` reports 0 deletions in `packages/`.

---

## 3. Actions taken (in order)

1. Inventoried `git status --short`, `git diff --stat`, and per-file diffs without modifying state.
2. Verified that `packages/*` directories existed but were empty on disk, confirming pure deletion (no intentional rewrite under way).
3. Verified `git status -s packages/` had no `M` rows — every dirty file was a clean delete.
4. Ran `git checkout HEAD -- packages/` to restore all 304 deletions from HEAD. **Surgical**, not a hard reset.
5. Re-ran `git status --short` to confirm the deletions are gone.

No untracked file was deleted. No commit was created. No staging was performed. No migration repair, no DB writes.

---

## 4. Final state

```
git status --short  →  20 modifications, 18 untracked, 0 deletions
find packages -type f  →  304
HEAD  →  f3cb0519
```

All intentional work in buckets A–G is preserved unmodified. All 304 accidental deletions in bucket H are reverted.

---

## 5. What is still dirty (and why)

Everything in buckets A–G remains in the worktree as before recovery. None of it was discarded:

- **A + B (UTV2-870 / UTV2-871):** the live target for verification. 4 untracked files + 1 modified file (`utv2-772-retention-proof.ts` arg rename). These belong on the next branch.
- **C (UTV2-869):** proof bundle for the already-committed `f3cb0519`. Belongs on the same branch as that commit when it gets pushed.
- **D (schema-drift-gate / phase 9):** appears to be its own lane. PM should confirm the lane id before bundling.
- **E (project-ref swap):** infrastructure cleanup. PM should confirm whether this is a standalone lane or piggy-backs on D.
- **F (UTV2-854 proof rerun):** regenerated artifacts for a closed lane. PM decision on whether to commit to the original proof dir or re-home under UTV2-869.
- **G (other-lane proofs + root scratch):** UTV2-860/861/862 proofs and two repo-root scratch files. None block UTV2-870/871 verification. Two root-level scratch files (`cron-verification-checklist.md`, `manual-lifecycle-results.json`) violate "no root scratch" hygiene and should be relocated or removed.

No file was committed.

---

## 6. Recommended verification target

To verify only UTV2-870 + UTV2-871 against a clean baseline, the cheapest safe path is an **isolated worktree** at `f3cb0519` containing only the 4 bucket-A/B untracked files plus the bucket-A `utv2-772-retention-proof.ts` modification.

```
git worktree add ../utv2-870-871-verify f3cb0519
# from the new worktree:
cp <main-checkout>/supabase/migrations/202605090002_utv2_870_*.sql supabase/migrations/
cp <main-checkout>/supabase/migrations/202605090003_utv2_871_*.sql supabase/migrations/
cp <main-checkout>/scripts/provider-offer-history-retention-summarize.test.ts scripts/
cp <main-checkout>/scripts/provider-offers-quarantine-prune-fix.test.ts scripts/
git checkout main -- apps/ingestor/src/scripts/utv2-772-retention-proof.ts  # then re-apply the p_date rename
```

This avoids entangling buckets D/E/F/G with the 870/871 proof.

The current `main` worktree is **safe to leave dirty** for the moment because every file in buckets A–G is intentional or pending PM decision and is no longer mixed with catastrophic damage. Verification of 870/871 specifically should still be done in the isolated worktree to keep the proof bundle uncontaminated.

---

## 7. Guardrails honored

- ✅ No DB writes.
- ✅ No migration repair.
- ✅ No broad `git reset --hard`. Restore was scoped to `packages/`.
- ✅ No untracked file deleted.
- ✅ No commit, no `git add`.
- ✅ No file in buckets A–G was touched.
