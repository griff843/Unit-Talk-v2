# UTV2-1411 Verification

## Verification

| Check | Result |
| --- | --- |
| `pnpm type-check` | Passed — TypeScript project references completed without errors. |
| `pnpm test` | Passed — root aggregate test suite completed successfully. |
| `pnpm test:db` | Passed — live database repository smoke test passed (1 test, 0 failures). |
| `git diff --check origin/main...HEAD` | Passed — no whitespace errors. |
| Model-routing validation | Passed — `jq -e` confirmed issue ID, schema version, selected model/profile, medium reasoning effort, no legacy compatibility or override, and exit code `0`. |

`pnpm test:db` node:test result:

```text
1..1
# tests 1
# pass 1
# fail 0
# skipped 0
```

## Issue-specific verification

Live read-only query against `public.picks` (Supabase project `zfzdnfwdarxucxtaojxm`), run 2026-07-14, last 30 days, excluding `metadata.testRun`-tagged rows:

```sql
select
  case
    when metadata->'domainAnalysis'->>'fallbackReason' is not null then metadata->'domainAnalysis'->>'fallbackReason'
    when metadata ? 'domainAnalysis' then 'no-fallback-real-edge'
    else 'no-domainAnalysis'
  end as edge_state,
  count(*) as n
from picks
where created_at > now() - interval '30 days'
  and not (metadata ? 'testRun')
group by 1
order by n desc;
```

Result:

```text
no-fallback-real-edge  8395
no-confidence          4698
no-domainAnalysis      2801  (2799 of these are source='t1-proof' test fixtures, excluded from the analysis below)
```

Per-source breakdown query and full finding are recorded in `diff-summary.md`. Summary:
residual fallback today is ~36% of real production picks (down from the audit's cited
55-60%), entirely attributable to `no-confidence` (missing capper-submitted confidence
at submission time for automated/system sources), and independently confirmed to be
unrelated to UTV2-1398's market-family classifier gap by reading
`apps/api/src/domain-analysis-service.ts:60-133`.

The branch diff against `origin/main` is otherwise limited to lane/sync metadata and UTV2-1411 proof artifacts — no runtime, schema, contract, domain, or API code was changed. The required `model-routing.json` is present and structurally validates with the expected UTV2-1411 routing values.

The additional live-DB smoke run (`pnpm test:db`) passed to satisfy the proof auditor's executed-command requirement, although this T2 lane does not modify `supabase/migrations/**`, `packages/db/**`, or an API service.

## Commit binding

Evidence was captured for commit `cedcf59d0a05e6a1caf1dfc418a6c80ab1874ed9`.
