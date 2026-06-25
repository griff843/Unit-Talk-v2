# Diff Summary — UTV2-1317 Readiness Regression Gate

**Lane:** UTV2-1317
**Tier:** T3 hygiene
**Branch:** claude/utv2-1317-readiness-regression-gate
**Generated at:** 2026-06-25T19:00:00Z

---

## Changes

### Files added

- `.github/workflows/readiness-regression-gate.yml` — new GHA workflow

### What it does

PR check that reads `docs/06_status/readiness/readiness-score.json` on every PR targeting `main` and:

- Hard fails if `verdict = RED`
- Warns (exit 0 with annotation) if `verdict = YELLOW`
- Hard fails if `generated_at > 48h` stale
- Warns if `generated_at > 24h` stale
- Passes if `verdict = GREEN` and ledger is recent

---

## Scope

- No source changes
- No schema changes
- No migrations
- No test changes
- Single GHA workflow file added

R-level check: PASS — 1 changed file, no R-level artifacts required.

---

## Readiness Impact

Protects the GREEN verdict established at 2026-06-25T17:08:00Z. Future PRs that would regress readiness (or that merge with a stale/abandoned ledger) will now be caught at CI rather than discovered post-merge.

---

## Merge SHA Binding

**Merge SHA:** `d1cce107ea6e2e9e5c650537ebfd02d6c4faf5ae`
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1078
**Merged at:** 2026-06-25T19:10:42Z
