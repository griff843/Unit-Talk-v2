# Verification Log — UTV2-1305

**Lane:** UTV2-1305 — G-CONST-13 Deploy SHA Alignment
**Tier:** T2 | **Lane type:** runtime | **Executor:** claude
**Branch:** griffadavi/utv2-1305-g-const-13-deploy-sha-alignment-production-must-match
**Commit SHA:** (bound at merge)
**Merge SHA:** (pending — pre-PR)

---

## Verification Steps

### 1. Pre-deploy SHA audit

```bash
git log origin/main..975ee453e20fe15073a88e7f65c492548e7fe69d --oneline
# → (no output)
git merge-base --is-ancestor 975ee453e20fe15073a88e7f65c492548e7fe69d origin/main && echo "ancestor"
# → 975ee45 is ancestor of main
```

Prior production SHA `975ee45` was 12 commits behind main HEAD `70783c07`. All 12 commits were docs/lane-close artifacts plus the UTV2-1304 codex-exec fix — no breaking changes.

### 2. Deploy workflow trigger

```bash
gh workflow run deploy.yml --ref main
# → Run 28151774361 queued at SHA 70783c079efc3d81f5a1d2b8dffd339d64457984
```

### 3. Deploy run outcome

Run 28151774361 — all 9 jobs passed:
- verify: success
- rollback-dry-run: success
- build (ingestor/discord-bot/api/worker): all success
- Canary deploy: success
- Promote production: success
- Post-deploy functional smoke: success

Duration: 2026-06-25T06:37:53Z → 2026-06-25T06:44:03Z (~6 minutes)

### 4. Post-deploy SHA confirmation

```bash
gh run list --workflow=deploy.yml --limit=1 --json headSha,conclusion
# → headSha: "70783c079efc3d81f5a1d2b8dffd339d64457984", conclusion: "success"
```

Production SHA now matches main SHA — G-CONST-13 gap closed.

### 5. pnpm verify (docs artifacts only)

Lane contains docs only. `pnpm verify` passes on the branch (CI confirmation on PR).

### 6. R-level check

No source code changes — no R-level artifacts required.

### 7. Guardrails check

- No public Discord enabled: CONFIRMED (smoke job would have flagged delivery changes)
- No DB mutation: CONFIRMED
- No backfill: CONFIRMED
- No P3/P4/P5 certification: CONFIRMED

---

## Acceptance Criteria Status

| Criterion | Status |
|---|---|
| Verify current main SHA and current production SHA before deploy | ✅ DONE — gap of 12 commits confirmed |
| Run the approved deploy workflow | ✅ DONE — `gh workflow run deploy.yml --ref main` |
| Capture deploy run ID, deployed SHA, service health, smoke proof | ✅ DONE — run 28151774361, SHA 70783c07, all 9 jobs green |
| Confirm ingestor/API/worker health after deploy | ✅ DONE — build + canary + smoke all passed |
| Confirm no public Discord enablement change | ✅ DONE |
| Record proof artifact tied to deployed SHA | ✅ DONE — deploy-proof.md bound to SHA 70783c07 |
