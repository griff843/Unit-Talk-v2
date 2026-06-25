# Deploy Proof — UTV2-1311

**Lane:** UTV2-1311 — G-CONST-16 Production SHA Deploy Follow-Through
**Tier:** T2 | **Lane type:** runtime | **Executor:** claude
**Branch:** claude/utv2-1311-g-const-16-production-sha-deploy-follow-through
**Merge SHA:** (pending — pre-merge)

---

## Deploy Run Evidence

| Field | Value |
|---|---|
| **Run ID** | 28158280041 |
| **Run URL** | https://github.com/griff843/Unit-Talk-v2/actions/runs/28158280041 |
| **Deployed SHA** | `e25c2009efbc8ef5464dd3b3ee6196156413d79f` |
| **Main SHA at dispatch** | `e25c2009efbc8ef5464dd3b3ee6196156413d79f` |
| **SHA match** | ALIGNED |
| **Trigger** | `workflow_dispatch` — ref `main` |
| **Started** | 2026-06-25T08:47:41Z |
| **Conclusion** | **success** |

---

## Pre-Deploy State

- **Prior production SHA:** `70783c079efc3d81f5a1d2b8dffd339d64457984`
- **Gap:** 15 commits behind main (all governance/proof/lane-close commits from UTV2-1309/1310/1312 batch)
- **Gap type:** governance/docs only — no runtime code changes

---

## Job Results

| Job | Status | Conclusion |
|---|---|---|
| verify | completed | success |
| rollback-dry-run | completed | success |
| build (ingestor) | completed | success |
| build (discord-bot) | completed | success |
| build (api) | completed | success |
| build (worker) | completed | success |
| Canary deploy | completed | success |
| Promote production | completed | success |
| Post-deploy functional smoke | completed | success |

---

## Post-Deploy Verification

- **Production SHA:** `e25c2009efbc8ef5464dd3b3ee6196156413d79f` aligned with main
- **Canary pass:** confirmed
- **Production promote:** confirmed success
- **Smoke test:** Post-deploy functional smoke passed

---

## pnpm test:db — Post-Deploy Live DB Proof

```
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 111686.954994
```

Run against project `zfzdnfwdarxucxtaojxm` post-deploy (SHA `e25c2009`). All 7 live DB assertions passed.

---

## Guardrails Confirmed

- No code changes — deploy-only lane
- No DB mutation or DDL
- No backfill
- No public Discord enablement
- No P3 certification
