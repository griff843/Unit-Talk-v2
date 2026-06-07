# Verification: UTV2-1227 — D-CONST-6 Downstream Activation

**Lane:** UTV2-1227 | **Date:** 2026-06-07 | **Tier:** T1  
**Branch:** `claude/utv2-1227-d-const-6-downstream-activation`

## Verification

### pnpm verify

```
# tests 113
# suites 13
# pass 113
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 663.682299

[command-manifest] Verified 14 command definition(s)
[check-migration-versions] 118 migration file(s) verified — no duplicate versions.
[lint-migrations] 118 migration file(s) checked — no findings.
```

Exit code 0 — PASS.

### pnpm test:db

```
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 108277.457838
```

Run against live Supabase project `zfzdnfwdarxucxtaojxm` — PASS.

### R-level check

```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

### Diff summary

**Changed:** `.github/workflows/deploy.yml` — added `SYNDICATE_MACHINE_ENABLED=true` to the "Write deploy gate env" heredoc (production env section).

**Root cause fixed:** Board scan in `apps/api/src/index.ts` is gated on `environment.SYNDICATE_MACHINE_ENABLED === 'true'`. Without this flag, `runBoardScan` runs every 5 minutes with `enabled: false`, producing zero candidates → zero scoring → zero board. This variable was never set in any prior deploy.yml commit.

### Constitutional constraints verified

- SGO key: existing key only, no new subscription activated
- Governance brake: Phase 7A `awaiting_approval` lifecycle state unchanged — board pipeline outputs remain governed
- P3 status: ACTIVE_NOT_CERTIFIED (unchanged)
- P5 status: FROZEN_NOT_CERTIFIED (unchanged)
- UTV2-1042: remains data-gated
- No edge, CLV, ROI, or production-readiness claim made
- No secret values in any proof artifact

## Summary

UTV2-1227 adds `SYNDICATE_MACHINE_ENABLED=true` to the deploy.yml production env section. This unblocks the D-CONST-6 downstream pipeline (Candidates → Scoring → Board). All static verification passes. Live-DB atomicity tests pass 7/7.

Post-deploy freshness verification (Candidates/Scoring/Board FRESH) is required to close D-CONST-6 fully and will be documented in `docs/06_status/proof/D-CONST-6/freshness-report.json` after deploy.
