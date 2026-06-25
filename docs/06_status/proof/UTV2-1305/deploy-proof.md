# Deploy Proof — UTV2-1305

**Lane:** UTV2-1305 — G-CONST-13 Deploy SHA Alignment
**Tier:** T2 | **Lane type:** runtime | **Executor:** claude
**Branch:** griffadavi/utv2-1305-g-const-13-deploy-sha-alignment-production-must-match

---

## Deploy Run Evidence

| Field | Value |
|---|---|
| **Run ID** | 28151774361 |
| **Run URL** | https://github.com/griff843/Unit-Talk-v2/actions/runs/28151774361 |
| **Deployed SHA** | `70783c079efc3d81f5a1d2b8dffd339d64457984` |
| **Main SHA at dispatch** | `70783c079efc3d81f5a1d2b8dffd339d64457984` |
| **SHA match** | ✅ ALIGNED |
| **Trigger** | `workflow_dispatch` — ref `main` |
| **Started** | 2026-06-25T06:37:53Z |
| **Completed** | 2026-06-25T06:44:03Z |
| **Duration** | ~6 minutes |
| **Conclusion** | **success** |

---

## Pre-Deploy State

- **Prior production SHA:** `975ee453e20fe15073a88e7f65c492548e7fe69d` (deployed 2026-06-24T03:56:17Z)
- **Gap:** 12 commits behind main (all docs/lane-close commits + UTV2-1304 codex-exec fix)
- **`975ee45` ancestry:** confirmed ancestor of main (`git merge-base --is-ancestor` returned 0)

---

## Job Results

| Job | Status | Conclusion |
|---|---|---|
| verify | completed | ✅ success |
| rollback-dry-run | completed | ✅ success |
| build (ingestor) | completed | ✅ success |
| build (discord-bot) | completed | ✅ success |
| build (api) | completed | ✅ success |
| build (worker) | completed | ✅ success |
| Canary deploy | completed | ✅ success |
| Promote production | completed | ✅ success |
| Post-deploy functional smoke | completed | ✅ success |

---

## Post-Deploy Verification

- **Production SHA:** `70783c079efc3d81f5a1d2b8dffd339d64457984` ← aligned with main
- **Canary pass:** confirmed — canary ran without rollback trigger
- **Production promote:** confirmed success
- **Smoke test:** Post-deploy functional smoke passed

---

## Guardrails Confirmed

- No DB mutation
- No backfill  
- No public Discord enablement change
- No P3/P4/P5 certification
- No CLV/ROI/edge claims
- Deploy was single-service rollout via approved GHA workflow
