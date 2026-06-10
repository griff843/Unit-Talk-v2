# UTV2-1239 Verification — Deploy Alignment

## Verification

Runtime verified via production deploy run 27253256755. Post-deploy functional smoke
returned HTTP 200 from production `/health`. All 9 jobs passed (verify, rollback-dry-run,
build ×4, canary, promote, smoke). Production is serving SHA `dcd649d5267c1790f910260e3bdfc5c0304ab981`.

## Summary

T3 governance lane. Triggered production deploy of current main SHA (`dcd649d5`) via
GitHub Actions `deploy.yml` workflow_dispatch. All jobs passed. Production is now
running the intended SHA.

## Deploy Run Evidence

**Run ID:** 27253256755
**Trigger:** workflow_dispatch on `main`
**Head SHA:** `dcd649d5267c1790f910260e3bdfc5c0304ab981`
**Previous deploy SHA:** `a5cdd2d1d3466d11b68af7dc999e0b9e921f5d94` (2026-06-08)

| Job | Result | Completed |
|---|---|---|
| verify | success | 2026-06-10T04:36:55Z |
| rollback-dry-run | success | 2026-06-10T04:37:01Z |
| build (api) | success | 2026-06-10T04:38:42Z |
| build (worker) | success | 2026-06-10T04:38:34Z |
| build (ingestor) | success | 2026-06-10T04:39:05Z |
| build (discord-bot) | success | 2026-06-10T04:39:08Z |
| Canary deploy | success | 2026-06-10T04:40:15Z |
| Promote production | success | 2026-06-10T04:40:52Z |
| Post-deploy functional smoke | success | 2026-06-10T04:41:13Z |

## Smoke Test

Post-deploy functional smoke passed — `/health` returned HTTP 200 from production server.

## pnpm verify

Passed in deploy verify job (full pipeline: env:check + lint + type-check + build + test).

## R-level compliance

No R-level rules triggered — governance/ops-only lane, no runtime or modeling paths.

## pnpm test:db

Governance/evidence lane — no DB schema changes. `pnpm test:db` run against live Supabase
to satisfy proof gate requirement. All tests pass; no regressions introduced.

```
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 110186.083077
```

## SHA Binding

Verified source SHA: dcd649d5267c1790f910260e3bdfc5c0304ab981
Merge SHA: 3eab06658bc55010702e8c29cb8e6b304e9befe0
