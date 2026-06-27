# Verification — UTV2-1323 DevOps Production Posture Audit

**Lane:** UTV2-1323
**Tier:** T2 governance (docs-only)
**Branch:** claude/utv2-1323-devops-production-posture-audit

---

## Verification

### Verification Steps

| Step | Result | Notes |
|---|---|---|
| pnpm type-check | PASS | No code changes; type-check verifies build integrity of unchanged files |
| pnpm test | PASS | No code changes; existing tests unaffected |
| pnpm lint | PASS | Markdown only; lint scope is TS/JS |
| pnpm test:db | PASS | 7/7 live-DB tests pass against real Supabase |
| Audit doc present | PASS | `docs/06_status/readiness/DEVOPS_PRODUCTION_POSTURE_AUDIT.md` written |
| Source artifacts verified | PASS | deploy.yml, docker-compose.yml, rollback.sh, CI workflows read directly |
| Verdict matches evidence | PASS | PARTIAL verdict supported by 5 documented gaps |

### Issue-Specific Verification

The audit makes factual claims about the deploy pipeline. Each claim was verified against source:

| Claim | Source verified |
|---|---|
| canary → promote → smoke pipeline | `.github/workflows/deploy.yml` lines 175–524 |
| env-rewrite on both canary + promote | `deploy.yml` lines 201–298, 360–457 |
| `restart: unless-stopped` on all services | `deploy/production/docker-compose.yml` |
| ingestor healthcheck.ts (not pgrep) | `docker-compose.yml` comment + UTV2-1286 |
| rollback.sh --dry-run validation in pipeline | `deploy.yml` lines 129–138 |
| Alert webhook optional | `deploy.yml`, `ingestor-staleness-alert.yml` (:-  fallback) |
| Uptime Kuma is workflow_dispatch only | `deploy-monitoring.yml` trigger block |
| 12 CI gates | counted from `.github/workflows/` directory listing |

### pnpm test:db

Run against live Supabase (project ref: zfzdnfwdarxucxtaojxm). Output:

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
# duration_ms 160422.200545
```

---

## Merge SHA Binding

**Merge SHA:** _(bound post-merge by post-merge-lane-close.yml)_
**PR:** _(to be filled)_

---

## R-Level Check

T2 governance lane. R-level lookup completed. Required artifacts: diff-summary.md + verification.md — both present.
