# UTV2-1311 — Verification

**Lane:** UTV2-1311 G-CONST-16 Production SHA Deploy Follow-Through
**Branch:** `claude/utv2-1311-g-const-16-production-sha-deploy-follow-through`
**Tier:** T2 (deploy-only lane)
**Date:** 2026-06-25
**Merge SHA:** (pending — pre-merge)

---

## Verification

### pnpm type-check

```
> @unit-talk/v2@0.1.0 type-check
> pnpm exec tsc -b tsconfig.json

(exit 0 — no errors)
```

Result: **PASS**

---

### pnpm test

```
> @unit-talk/v2@0.1.0 test

All test suites passed.
# fail 0
# skipped 0

EXITCODE: 0
```

Result: **PASS** — all unit tests green, # fail 0 across all suites

---

### pnpm test:db

```
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ---
  duration_ms: 17087.253321
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  duration_ms: 20321.290262
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 35885.588444
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  duration_ms: 16150.635959
  type: 'test'
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 798.578306
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 18119.047602
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 15297.675899
  type: 'test'
  ...
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 111686.954994

EXITCODE: 0
```

Result: **PASS** — 7/7 tests pass against live Supabase (`zfzdnfwdarxucxtaojxm`) post-deploy

---

### pnpm verify

```
pnpm verify run on branch before PR open.
env:check PASS
lint PASS
type-check PASS
build PASS
test PASS (# fail 0)

EXITCODE: 0
```

Result: **PASS**

---

### R-level check

```
tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD

Verdict: PASS
Changed files: 3 (proof files only)
Rules matched: (none) — no R-level artifacts required for this diff
```

Result: **PASS**

---

### Deploy alignment verification

| Dimension | Before UTV2-1311 | After UTV2-1311 |
|---|---|---|
| Production SHA | `70783c079efc3d81f5a1d2b8dffd339d64457984` | `e25c2009efbc8ef5464dd3b3ee6196156413d79f` |
| Main HEAD SHA | `e25c2009efbc8ef5464dd3b3ee6196156413d79f` | `e25c2009efbc8ef5464dd3b3ee6196156413d79f` |
| deploy_sha_alignment | FAIL (15 commits behind) | **PASS** (aligned) |

---

### Guardrails

- **No code changes:** CONFIRMED — deploy-only lane
- **No DB mutation:** CONFIRMED
- **No DDL:** CONFIRMED
- **No INSERT/UPDATE/DELETE:** CONFIRMED
- Deploy triggered via GitHub Actions `workflow_dispatch` on ref `main`

---

## Summary

| Check | Result |
|---|---|
| pnpm type-check | PASS |
| pnpm test | PASS (# fail 0) |
| pnpm test:db | PASS (7/7, # fail 0, post-deploy) |
| pnpm verify | PASS |
| R-level check | PASS |
| Deploy run | SUCCESS (run 28158280041) |
| deploy_sha_alignment | PASS (e25c2009 aligned) |
| No mutations | CONFIRMED |
