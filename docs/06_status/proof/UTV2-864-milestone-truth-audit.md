# UTV2-864 Milestone Truth Audit

**Date:** 2026-05-10
**Auditor:** Claude (orchestrator)
**Repo HEAD on `main`:** `fcd4ce4e82ea5136a2fe352a8098969f0d315fa7`
**Local working tree:** dirty (see Repo Truth section)

---

## 1. Executive Summary

UTV2-864 — *First legitimate model-attributed candidate proof* — is **blocked end-to-end**. The deployed runtime on the production host is still the pre-UTV2-854 build, so live `pick_candidates` writes continue to skip the ownership trio (`model_registry_id`, `scoring_run_id`, `ownership_timestamp`). The runtime observability and Dockerfile fixes that would prove this are committed to `origin/main` and have built clean container images, but **deployment never released** because five deploy secrets are missing in GitHub Actions.

In parallel, the provider-history lifecycle (UTV2-862) only partially recovered. UTV2-870 and UTV2-871 fixes exist as **local-only migrations and proof artifacts** that have not been committed, pushed, or applied live. Linear marks both as *Ready to Close*, which currently overstates truth.

The candidate pool itself is also a blocker: 552 `qualified` candidates remain unscored, but **all 552 map to `market_universe.is_stale = true`**, so even a freshly deployed scorer has no eligible row to attribute. A fresh-ingestion / eligibility step is required before any ownership-attributed scoring run can happen.

There is therefore no path to UTV2-864 proof today. The minimum sequence is: push & apply 870/871 → populate deploy secrets → re-run Deploy → prove runtime SHA convergence on host → repair partition ownership and re-run lifecycle → trigger fresh viable candidates → run scorer → capture proof. UTV2-863 cannot reopen until runtime SHA convergence is proven and a viable candidate is available.

---

## 2. Milestone Definition

A fresh, live-scored production `pick_candidates` row that satisfies **all** of the following, with proof tied to the deployed runtime SHA:

| Field | Required state |
|---|---|
| `model_registry_id` | `NOT NULL`, references a row in `model_registry` |
| `scoring_run_id` | `NOT NULL`, references a `system_runs` row with `run_type = 'candidate.scoring'` |
| `ownership_timestamp` | `NOT NULL` |
| Source | written by the deployed runtime, **not** manual fabrication, historical backfill, stale code, or local-only script |
| Provenance | `system_runs.metadata.runtime_version` (or equivalent) returns the same SHA exposed by the production `/runtime-version` endpoint |

---

## 3. Truth Gate Status

| # | Gate | Status | Evidence |
|---|---|---|---|
| G1 | DB / schema truth | 🟢 GREEN | `pick_candidates` ownership columns + indexes live; migration `202605070002` semantically present (UTV2-863 confirmed). |
| G2 | Migration / ledger truth | 🟡 YELLOW | UTV2-870 and UTV2-871 migration files exist locally but are uncommitted, unpushed, and unapplied live. Ghost migration `202604300003` from UTV2-862 audit still unresolved (UTV2-868 in Backlog). |
| G3 | Runtime deploy truth | 🔴 RED | Code at `fcd4ce4e` is on `origin/main` and Docker images built clean (run #25628794052), but deploy job **failed at `Validate deploy secrets`**. Five secrets empty: `UNIT_TALK_DEPLOY_HOST`, `UNIT_TALK_DEPLOY_USER`, `UNIT_TALK_DEPLOY_PATH`, `UNIT_TALK_DEPLOY_HEALTH_URL`, `UNIT_TALK_DEPLOY_SSH_KEY`. Production host still runs pre-UTV2-854 binary. |
| G4 | Scorer execution truth | 🔴 RED | `system_runs` shows **0** rows with `run_type = 'candidate.scoring'`. May 9 write burst (1,000 rows in ~12 s) had only `worker.heartbeat` runs in window. The ownership-aware path defined at `38392b5a` cannot be the writer. |
| G5 | Ownership persistence truth | 🔴 RED | 7,051 / 7,051 scored candidates have NULL ownership trio. `ownership_write_success_pct = 0`. No partial-ownership rows exist (rules out post-write nulling). |
| G6 | Fresh candidate availability truth | 🔴 RED | 552 qualified unscored candidates exist; **0 viable** because every mapped `market_universe` row has `is_stale = true`. Scorer correctly skips these. No fresh runtime data has appeared since 2026-05-01. |
| G7 | Provider-history lifecycle truth | 🔴 RED | UTV2-862 final live re-run (`UTV2-862-final-lifecycle-results.json`): `summarize` PASS, `drop_old_provider_offer_history_partitions(7)` FAIL with `42501: must be owner of table provider_offer_history_p20260502`, `prune_provider_offers_bounded(7,5000,20)` FAIL with `57014: statement timeout`. UTV2-870 / UTV2-871 fixes are not yet live. |
| G8 | CI / repo verification truth | 🟡 YELLOW | CI green on `fcd4ce4e` (verify, all 4 image builds). Local working tree dirty: 19 modified, 22+ untracked, including the two new migration files and most proof bundles. UTV2-870/871 self-reports `pnpm verify`/`pnpm test:db` green on the recovered slice but workspace not clean. |
| G9 | Final proof truth | 🔴 RED | No fresh ownership-attributed `pick_candidates` row exists. No `system_runs` row of type `candidate.scoring` exists. No deploy SHA fingerprint exposed live. UTV2-864 cannot be claimed. |

Overall: **1 green, 2 yellow, 6 red** → milestone not achievable in current state.

---

## 4. Repo Truth

### 4.1 Pushed to `origin/main`
- `f3cb0519` — `feat(api): UTV2-869 add scorer runtime observability` — adds `/runtime-version` route, `runtime-version.ts`, candidate-scoring instrumentation, Dockerfile + env additions. 20 files, 649 insertions.
- `fcd4ce4e` — `fix(api): UTV2-869 repair docker runtime image build` — removes the `apps/operator-web/package.json` COPY (UTV2-873 work, but commit message tagged UTV2-869).

### 4.2 Local-only / uncommitted
Migration files (the actual fixes for 870/871 are sitting on disk only):
- `supabase/migrations/202605090002_utv2_870_provider_offer_history_summarize_fix.sql`
- `supabase/migrations/202605090003_utv2_871_provider_offers_quarantine_prune_fix.sql`

Proof artifacts (untracked):
- `docs/06_status/proof/UTV2-862-final-lifecycle-verification.md`
- `docs/06_status/proof/UTV2-862-final-lifecycle-results.json`
- `docs/06_status/proof/UTV2-862-manual-lifecycle-verification.md`
- `docs/06_status/proof/UTV2-862-cron-verification-plan.md`
- `docs/06_status/proof/UTV2-869-runtime-drift/{evidence.json,live-write-trace.json,remediation.md,runtime-path-analysis.md}`
- `docs/06_status/proof/UTV2-870-summarize-fix-verification.json`
- `docs/06_status/proof/UTV2-871-prune-fix-verification.json`
- `docs/06_status/proof/UTV2-860-phase9-ledger-reconciliation.json`
- `docs/06_status/proof/UTV2-861-low-risk-convergence-verification.json`

Modified-but-uncommitted (touched during 870/871 closeout and unrelated workspace recovery):
- `apps/ingestor/src/scripts/utv2-772-retention-proof.ts` (intentional, 870 scope)
- `docs/06_status/proof/UTV2-854/*` (5 files, ownership proof artifacts)
- 14 unrelated paths (`AGENTS.md`, `package.json`, several scripts and docs) flagged in 870/871 verification reports as outside-scope dirty.

### 4.3 Stale or superseded
- UTV2-873 description says "Ready for Codex" with the Dockerfile work as outstanding. The Dockerfile work is **already in `fcd4ce4e` on `main`** and the build has passed. UTV2-873 should be reclassified as Ready to Close (or rolled into the deploy-secrets follow-up).
- UTV2-869 description still cites the SUPABASE_URL failure; that failure is fixed. The current blocker for UTV2-869 to be observably live is the deploy-secrets gap, not SUPABASE_URL.

---

## 5. Runtime Truth

### 5.1 What is on `main`
Runtime observability surface is in code:
- `apps/api/src/runtime-version.ts` and `apps/api/src/routes/runtime-version.ts` (new endpoint)
- `apps/api/src/candidate-scoring-service.ts` updated to emit the runtime fingerprint into `system_runs.metadata`
- Dockerfile updated, then repaired by `fcd4ce4e`

### 5.2 Deploy pipeline state
Last three Deploy runs:

| Run | SHA | Verify | Build (×4) | Deploy job | Failure point |
|---|---|---|---|---|---|
| `25618823962` | f3cb0519 | FAIL | — | — | Verify: `SUPABASE_URL is not set or empty` |
| `25619421725` | f3cb0519 | PASS | FAIL | — | Build: Dockerfile expected `apps/operator-web/package.json` |
| `25628794052` | fcd4ce4e | PASS | PASS (api/worker/ingestor/discord-bot) | **FAIL** | `Validate deploy secrets` step in `deploy` job |

Inspecting `.github/workflows/deploy.yml` lines 102–117, the failed step requires all of:
- `UNIT_TALK_DEPLOY_HOST`
- `UNIT_TALK_DEPLOY_USER`
- `UNIT_TALK_DEPLOY_PATH`
- `UNIT_TALK_DEPLOY_HEALTH_URL`
- `UNIT_TALK_DEPLOY_SSH_KEY` (in the next step, "Install SSH key", which was skipped)

Subsequent steps `Install SSH key`, `Upload compose manifest`, and `Release containers` were `skipped`. Container images **were pushed to GHCR**, but the host never pulled them.

### 5.3 What is deployed
Per UTV2-869 runtime drift analysis: zero `Deploy` workflow runs ever reached the host successfully, zero GitHub deployment records exist, and `system_runs` has zero `candidate.scoring` rows. The runtime currently hitting prod is older than `38392b5a` (UTV2-854 ownership work). Exact host SHA is not recoverable until the new `/runtime-version` endpoint is reachable, which requires a successful release.

### 5.4 What is blocking release
Operator action only: populate the five deploy secrets in the GitHub Actions repository secret store and re-run workflow `deploy.yml` on `fcd4ce4e`. No code change is required.

---

## 6. DB / Provider Lifecycle Truth

### 6.1 UTV2-862 final lifecycle (live, 2026-05-10)

| Step | Status | Notes |
|---|---|---|
| `summarize_provider_offer_history_partition('2026-04-29')` | ✅ PASS | `rows_summarized = 0` (history table empty) |
| `drop_old_provider_offer_history_partitions(7)` | ❌ FAIL | `42501: must be owner of table provider_offer_history_p20260502` |
| `prune_provider_offers_bounded(7,5000,20)` | ❌ FAIL | `57014: canceling statement due to statement timeout` |

No row loss observed (live counts unchanged before/after). Lifecycle gate `merge_provider_offer_staging_cycle` correctly remains closed.

### 6.2 UTV2-870 — summarize fix
Migration `202605090002_utv2_870_provider_offer_history_summarize_fix.sql` rewrites the function to alias `p_date AS snap_dt` instead of the ambiguous `snapshot_date`. Repo-side test `scripts/provider-offer-history-retention-summarize.test.ts` PASSES. Live behavior already passes for `summarize` because that path was the first to be hand-fixed; the local migration formalises it. **Truth status:** the fix exists locally but has not been committed/pushed/applied through the canonical migration workflow.

### 6.3 UTV2-871 — prune fix
Migration `202605090003_utv2_871_provider_offers_quarantine_prune_fix.sql` adds `provider_offers_legacy_quarantine_created_at_id_idx` (CONCURRENTLY) and retargets `prune_provider_offers_bounded` directly at the quarantine base table instead of the view. Repo-side test PASSES. **Live `(7,5000,20)` still times out**, so the index/retarget alone has not yet been proven sufficient under the contract budget — and the migration is not even on `main` yet.

### 6.4 Conclusions
- **UTV2-870** is **not** truly Done. It is "fix written, repo-tested" and needs commit + push + live apply + a re-run of `summarize` against a non-empty partition or at least documented behavioural parity.
- **UTV2-871** is **partially** done. The prune fix is written and repo-tested, but the live `(7,5000,20)` contract still does not complete. Even after applying the migration, a live re-run is needed; if it still times out the implementation budget needs further work (e.g. lower `p_batch_size`, raise `statement_timeout` for the function role, or split the work across multiple invocations).
- **UTV2-862** cannot truly close. `drop_old_provider_offer_history_partitions(7)` fails on a partition-ownership defect that no migration in this slice addresses.

### 6.5 Relationship to UTV2-864
The provider-history lifecycle is **not on the critical path** for UTV2-864. UTV2-864 only needs a fresh ownership-attributed scored candidate. The lifecycle blocks the `merge_provider_offer_staging_cycle` gate (i.e. staging-cycle activation), not the ownership write path. They share an executor (Codex) and a workspace, but they should be tracked as parallel tracks.

---

## 7. Ownership Persistence Truth

| Layer | State | Evidence |
|---|---|---|
| Live schema | 🟢 Ready | `pick_candidates.{model_registry_id, scoring_run_id, ownership_timestamp}` present (UTV2-854 evidence). |
| Migration ledger | 🟢 Present | `202605070002` semantically applied. |
| Repo write contract | 🟢 Persists trio + asserts | `apps/api/src/candidate-scoring-service.ts` and `packages/db/src/runtime-repositories.ts:assertValidModelScoreUpdate()`. |
| Deployed write contract | 🔴 Pre-UTV2-854 | Live writes update only `model_score`, `model_tier`, `model_confidence`. No `candidate.scoring` `system_runs` rows ever observed. |
| Live ownership coverage | 🔴 0% | 7,051 scored candidates, 7,051 with NULL ownership trio. |
| Eligible candidate pool | 🔴 0 viable | 552 qualified unscored, **all** behind `market_universe.is_stale = true`. |

### Required evidence still missing before UTV2-863 can reopen
1. Production `/runtime-version` returns a SHA `>= fcd4ce4e` (proving deploy succeeded).
2. At least one `system_runs` row with `run_type = 'candidate.scoring'` referencing that SHA.
3. At least one fresh `pick_candidates` row written **after** that deploy with the ownership trio populated.
4. `ownership_write_success_pct > 0` in a re-run of `scripts/model-ownership/run-ownership-persistence-proof.ts`.

A fresh-candidate generation issue is required: even after a successful deploy, the current pool produces zero attributable rows. UTV2-863's existing description anticipates this in its Exit Criteria ("Produce one fresh scored candidate from the current ownership path, or document why no eligible candidate can be generated"), but no separate Linear issue tracks the upstream ingestion / staleness side. That issue must exist and complete before 863 can satisfy 864.

No additional DB or schema issue remains for ownership; the schema layer is already adequate.

---

## 8. Linear Issue Audit

Legend: ✅ matches truth · ⚠️ Linear overstates · ❌ Linear understates · 🆕 needs creation

| Issue | Linear status | Truth status | Notes |
|---|---|---|---|
| UTV2-855 | Backlog (umbrella) | ✅ Backlog | Correct as a tracking parent. |
| UTV2-856 | Done | ✅ Done | Doc shipped (`8194bcfc` + `17d7545d`). |
| UTV2-857 | Done | ✅ Done | Schema parity workflow merged. |
| UTV2-858 | Done | ✅ Done | Doc shipped. |
| UTV2-859 | Done | ✅ Done | Inspection toolkit shipped. |
| UTV2-860 | Done | ✅ Done | Reconciliation proof present. |
| UTV2-861 | Done | ✅ Done | Convergence proof present. |
| UTV2-862 | Done | ⚠️ Premature | Audit/governance is done, but **the lifecycle gate is not cleared** (drop + prune fail live). Two follow-up issues from this audit are still unfiled. The lane itself was closed because the *audit* finished, not because lifecycle is healthy. |
| UTV2-863 | Blocked Internal | ✅ Blocked Internal | Correctly blocked on runtime drift. |
| UTV2-864 | Blocked Internal | ✅ Blocked Internal | Correctly blocked on 863. |
| UTV2-865 | Done | ✅ Done | Drift gate shipped. |
| UTV2-866 | Done | ✅ Done | Runbook shipped. |
| UTV2-867 | Done | ✅ Done | Cost/branch policy shipped. |
| UTV2-868 | Backlog | ✅ Backlog | Ghost migration `202604300003` still unresolved; not on critical path for UTV2-864 but still real. |
| UTV2-869 | Blocked Internal | ⚠️ Description stale | Description says blocker is `SUPABASE_URL`. Truth is: SUPABASE_URL fixed, Docker fix shipped (`fcd4ce4e`), images built. Real residual blocker is the five missing deploy secrets. Update description and move to whichever status reflects "code shipped, deploy not yet released". |
| UTV2-870 | Ready to Close | ⚠️ Premature | Migration is **uncommitted**. Cannot be Ready to Close until pushed and applied live through the canonical workflow, with at least a documented live-run trace. |
| UTV2-871 | Ready to Close | ⚠️ Premature | Migration uncommitted. Even after apply, live `(7,5000,20)` may still time out — needs live verification. |
| UTV2-873 | Ready for Codex | ❌ Stale | Work is already merged in `fcd4ce4e`. Should be Ready to Close once the next deploy run releases successfully (which is itself blocked by missing deploy secrets, not by 873). |

### Issues that should exist but don't
| ID | Subject | Why missing | Blocking |
|---|---|---|---|
| 🆕 A | Populate GitHub Actions deploy secrets and release UTV2-869 runtime | Deploy is failing at `Validate deploy secrets`; no Linear issue tracks this Operator-only task. | UTV2-869 release, UTV2-863 reopen, UTV2-864 |
| 🆕 B | Verify deployed runtime SHA on production host (`/runtime-version` + `system_runs` trace) | After deploy succeeds, we still need to *prove* convergence; that proof is a distinct artefact. | UTV2-863 reopen, UTV2-864 |
| 🆕 C | Repair partition ownership for `drop_old_provider_offer_history_partitions` | UTV2-862 final results filed it as a follow-up but no Linear issue exists. Standalone DB ownership / SECURITY DEFINER work. | UTV2-862 lifecycle gate (not UTV2-864) |
| 🆕 D | Make `prune_provider_offers_bounded(7,5000,20)` complete live within statement_timeout | UTV2-871 fix may be insufficient under live data volume; needs post-apply verification and potential additional remediation. | UTV2-862 lifecycle gate (not UTV2-864) |
| 🆕 E | Generate fresh viable scoring-eligible candidates (clear `market_universe.is_stale` blockage) | 552 qualified rows exist but 0 are scoreable; without this, even a deployed scorer cannot produce a ownership-attributed proof row. | UTV2-863, UTV2-864 |
| 🆕 F | Land UTV2-870 + UTV2-871 migrations on `main` and apply live | Both migrations exist only locally; Linear shows them Ready to Close while origin/main has neither. | UTV2-862 lifecycle gate, lane truth hygiene |
| 🆕 G | UTV2-864 milestone proof bundle (final) | UTV2-864 itself can serve, but it should be reframed/updated to enumerate Sections 2 and required artefact list above. | n/a — owns the milestone close |

---

## 9. Missing Issue Specifications

### 🆕 A — Operator: populate GitHub Actions deploy secrets, release UTV2-869 runtime
- **Owner:** Operator (Griff)
- **Project:** System Wire
- **Parent:** UTV2-855
- **Priority:** Urgent
- **Status:** Ready for Operator
- **Tier:** T1 (release-affecting)
- **Description:** Populate the five missing GitHub Actions secrets (`UNIT_TALK_DEPLOY_HOST`, `UNIT_TALK_DEPLOY_USER`, `UNIT_TALK_DEPLOY_PATH`, `UNIT_TALK_DEPLOY_HEALTH_URL`, `UNIT_TALK_DEPLOY_SSH_KEY`). Re-run `deploy.yml` on `fcd4ce4e`. Confirm the `deploy` job clears `Validate deploy secrets`, executes `Install SSH key`, `Upload compose manifest`, and `Release containers`, and that the `/health` polling loop succeeds.
- **Acceptance criteria:**
  - All 5 secrets resolve as non-empty in a fresh Deploy workflow run.
  - Deploy run conclusion = `success`.
  - Host `.unit-talk-release` file matches `fcd4ce4e` (or later).
  - `/health` returns 200 after release loop.
- **Dependencies:** none.
- **Blocks:** UTV2-869 close, 🆕 B, UTV2-863 reopen, UTV2-864.

### 🆕 B — Verify production runtime SHA convergence
- **Owner:** Codex
- **Project:** System Wire
- **Parent:** UTV2-855
- **Priority:** Urgent
- **Status:** Ready for Codex (blocked by 🆕 A)
- **Tier:** T1
- **Description:** Once 🆕 A succeeds, hit the production `/runtime-version` endpoint and capture the response. Run the scorer (or wait for a scheduled tick), then query `system_runs` for `run_type = 'candidate.scoring'` rows; assert at least one row exists and that its `metadata.runtime_version` equals the `/runtime-version` SHA. Capture both as proof under `docs/06_status/proof/UTV2-869/runtime-convergence/`.
- **Acceptance criteria:**
  - Production `/runtime-version` returns a SHA `>= fcd4ce4e`.
  - At least one `system_runs.candidate.scoring` row exists with that SHA.
  - Proof artefact committed.
- **Dependencies:** 🆕 A.
- **Blocks:** UTV2-863 reopen, UTV2-864.

### 🆕 C — Repair partition ownership for `drop_old_provider_offer_history_partitions`
- **Owner:** Codex (DB)
- **Project:** System Wire
- **Parent:** UTV2-855 (or UTV2-862 if treated as direct follow-up)
- **Priority:** Urgent
- **Status:** Ready for Codex
- **Tier:** T1
- **Description:** `drop_old_provider_offer_history_partitions(7)` fails with `42501: must be owner of table provider_offer_history_p20260502`. Either reassign existing partition ownership to the function's execution role, mark the function `SECURITY DEFINER` with an owner that owns all partitions (and audit the security implications), or change the partition-creation path so future partitions are owned by the correct role. Apply via canonical migration workflow.
- **Acceptance criteria:**
  - Migration shipped on `main` and applied live.
  - `drop_old_provider_offer_history_partitions(7)` succeeds end-to-end live with no `42501`.
  - Verification proof committed.
- **Dependencies:** UTV2-862 audit understanding (already complete).
- **Blocks:** UTV2-862 lifecycle gate clearing. **Does not block** UTV2-864.

### 🆕 D — Make `prune_provider_offers_bounded(7,5000,20)` complete live within statement_timeout
- **Owner:** Codex (DB)
- **Project:** System Wire
- **Parent:** UTV2-855 (or UTV2-871)
- **Priority:** Urgent
- **Status:** Ready for Codex (blocked by 🆕 F)
- **Tier:** T1
- **Description:** Once 🆕 F applies UTV2-871 live, re-run `prune_provider_offers_bounded(7,5000,20)`. If it still times out (8.2M-row legacy quarantine), additionally tune one of: lower `p_batch_size`, raise per-function `statement_timeout`, or split into multiple smaller scheduled invocations. Document chosen approach.
- **Acceptance criteria:**
  - Live `prune_provider_offers_bounded(7,5000,20)` completes without `57014`.
  - Returns sane `(batches_run, deleted_rows, cutoff, remaining_rows)`.
  - Verification proof committed.
- **Dependencies:** 🆕 F.
- **Blocks:** UTV2-862 lifecycle gate clearing. **Does not block** UTV2-864.

### 🆕 E — Restore fresh viable scoring-eligible candidate pool
- **Owner:** Codex (ingestor + intelligence)
- **Project:** System Wire
- **Parent:** UTV2-855
- **Priority:** Urgent
- **Status:** Ready for Codex (blocked by 🆕 B)
- **Tier:** T1
- **Description:** All 552 currently qualified-unscored candidates map to `market_universe.is_stale = true`. Investigate why `market_universe` rows have gone stale system-wide (ingestion gap? cron drift?), restore freshness for at least one active sport's slate, and confirm the scorer has at least one viable candidate to attribute. If restoration is infeasible in the current operating window, document the explicit operator-overridable path used to manufacture one viable candidate without violating fail-closed.
- **Acceptance criteria:**
  - At least one `pick_candidates` row exists with `status='qualified'`, `model_score IS NULL`, and a non-stale mapped `market_universe` row.
  - Rationale for stale-universe condition documented.
  - Proof committed.
- **Dependencies:** 🆕 B (so we know we're testing the deployed runtime's view of staleness, not a stale binary's).
- **Blocks:** UTV2-863, UTV2-864.

### 🆕 F — Land UTV2-870 + UTV2-871 migrations on `main` and apply live
- **Owner:** Claude / Codex (whichever is on lane)
- **Project:** System Wire
- **Parent:** UTV2-855
- **Priority:** Urgent
- **Status:** Ready
- **Tier:** T1 (DB)
- **Description:** Commit `supabase/migrations/202605090002_utv2_870_provider_offer_history_summarize_fix.sql` and `supabase/migrations/202605090003_utv2_871_provider_offers_quarantine_prune_fix.sql` plus their proof JSONs and the related test files; open PRs through the canonical workflow; obtain Operator approval; apply live; record live SHAs and post-apply behaviour.
- **Acceptance criteria:**
  - Both migration files merged to `main`.
  - Both applied live with ledger entries recorded.
  - Live `summarize` re-run still PASSES; live `prune` re-run captured (handed off to 🆕 D for further work if it still times out).
  - UTV2-870 and UTV2-871 Linear status changed from Ready to Close → Done with merge SHAs and live-apply proof.
- **Dependencies:** none.
- **Blocks:** 🆕 D, UTV2-870/871 close-out.

### 🆕 G — UTV2-864 final proof bundle
- **Owner:** Codex
- **Project:** System Wire
- **Parent:** UTV2-855
- **Priority:** Urgent
- **Status:** Blocked Internal (current state, but description should be tightened with the schema in §2 above)
- **Tier:** T1
- **Description:** Update UTV2-864's exit criteria to enumerate the exact six artefacts required (live row id, ownership trio values, `system_runs` row id, `runtime-version` SHA, ownership-persistence summary regenerated, all-tied-to-merge-SHA bundle). Once 🆕 A → 🆕 E land, generate the bundle under `docs/06_status/proof/UTV2-864/` and tie to the merge SHA at proof time.
- **Acceptance criteria:** matches §2.
- **Dependencies:** 🆕 A, 🆕 B, 🆕 E, UTV2-863 reopen + green.
- **Blocks:** milestone close.

---

## 10. Dependency Graph

```
                            🆕 A (deploy secrets — Operator)
                                       │
                                       ▼
                   🆕 B (runtime SHA convergence proof — Codex)
                                       │
                                       ▼
            ┌──────────────────────────┴──────────────────────────┐
            │                                                     │
            ▼                                                     ▼
  🆕 E (fresh viable candidates — Codex)              UTV2-869 close (description refresh)
            │
            ▼
   UTV2-863 reopen + green ownership-persistence proof
            │
            ▼
   🆕 G / UTV2-864 final proof bundle  ← MILESTONE
            │
            ▼
   UTV2-864 Done

—— Independent track (does not block UTV2-864) ——

  🆕 F (commit + apply 870/871 live)
            │
            ▼
   🆕 C (partition ownership)         🆕 D (prune timeout under contract)
            │                                    │
            └──────────────┬─────────────────────┘
                           ▼
       UTV2-862 lifecycle gate cleared (merge_provider_offer_staging_cycle)
```

---

## 11. Exact Next Execution Order

Critical path to UTV2-864:

1. **🆕 A** — Operator populates the 5 deploy secrets and re-runs `deploy.yml` on `fcd4ce4e`. Block here until success.
2. **🆕 B** — Codex captures `/runtime-version` from production and proves at least one `candidate.scoring` `system_runs` row references the deployed SHA.
3. **UTV2-869 close-out** — refresh description (SUPABASE_URL fixed; deploy released; observability live), set Ready to Close; close on PM verdict.
4. **🆕 E** — Codex investigates and restores at least one viable scoring-eligible candidate (or operator-approved equivalent).
5. **UTV2-863 reopen** — run scorer, capture proof of one fresh row with full ownership trio and matching `system_runs` row; rerun ownership-persistence proof and capture `ownership_write_success_pct > 0`.
6. **🆕 G / UTV2-864** — assemble proof bundle per §2; close UTV2-864 on PM verdict.

Independent / parallel track (clears UTV2-862 lifecycle gate, does not gate UTV2-864):

A. **🆕 F** — commit & push the two migrations, apply live, update UTV2-870 / UTV2-871.
B. **🆕 C** — fix partition ownership; live re-run `drop_old_provider_offer_history_partitions(7)`.
C. **🆕 D** — live re-run prune; further remediation if needed.
D. **UTV2-862 close** — only when full lifecycle (summarize → drop → prune) passes live in one sequence.

UTV2-873 should be moved to Ready to Close in step 3 since its work shipped in `fcd4ce4e`.

UTV2-868 (ghost migration) remains Backlog — not on either critical path.

---

## 12. What Not to Do

- **Do not** mark UTV2-870 or UTV2-871 Done before their migrations are committed, pushed, and applied live with a live re-run captured in proof.
- **Do not** mark UTV2-862 Done with the audit/lane closure alone — the lifecycle gate is not cleared.
- **Do not** attempt to fabricate a UTV2-864 proof from existing 7,051 ownership-NULL rows or from any historical backfill — UTV2-864 by definition rejects this.
- **Do not** retry deploys before populating the missing secrets; each retry burns CI minutes and produces identical noise.
- **Do not** lower the prune `(7,5000,20)` contract on its own; the contract is the integrity boundary. Address timeout via implementation, not contract weakening, unless a deliberate operator-approved policy change is filed.
- **Do not** apply UTV2-870 / UTV2-871 outside the canonical migration workflow (no MCP `apply_migration` shortcut).
- **Do not** mutate live DB during this audit phase — this audit is read-only.
- **Do not** treat the `workspace:intelligence` UTV2-864 lane as parallelizable with UTV2-863's reopen — they are strictly sequential.
- **Do not** edit unrelated dirty files in the working tree as part of this audit; resolving workspace cleanliness is its own hygiene task and is not in scope.
