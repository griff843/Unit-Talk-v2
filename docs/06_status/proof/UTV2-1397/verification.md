# UTV2-1397 Verification

## Verification

Commands run from `/home/griff843/code/Unit-Talk-v2/.out/worktrees/griffadavi__utv2-1397-evidence-flow-proof-real-production-samples-for-alert-agent`:

- `pnpm exec tsx scripts/audits/utv2-1397-evidence-flow-observation.ts --days 30` — live-DB run, wrote `docs/06_status/proof/UTV2-1397/evidence-flow-summary.json`, overall_verdict=INSUFFICIENT_DATA
- `pnpm exec tsx --test scripts/audits/utv2-1397-evidence-flow-observation.test.ts` — pass (4/4)
- `pnpm type-check` — pass
- `pnpm lint` — pass
- `pnpm verify` — pass (includes `pnpm test` and `pnpm test:db` against live Supabase)
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS, no R-level artifacts required for this diff

### `scripts/audits/utv2-1397-evidence-flow-observation.test.ts` TAP output

```
TAP version 13
# Subtest: UTV2-1397: a source with zero real rows reports INSUFFICIENT_DATA, not PASS/FAIL
ok 1 - UTV2-1397: a source with zero real rows reports INSUFFICIENT_DATA, not PASS/FAIL
  ---
  duration_ms: 2.918842
  type: 'test'
  ...
# Subtest: UTV2-1397: a real (non-fixture) row is counted and classified per-source
ok 2 - UTV2-1397: a real (non-fixture) row is counted and classified per-source
  ---
  duration_ms: 0.855108
  type: 'test'
  ...
# Subtest: UTV2-1397: majority confidence-fallback on a populated source is PARTIAL, not PASS
ok 3 - UTV2-1397: majority confidence-fallback on a populated source is PARTIAL, not PASS
  ---
  duration_ms: 6.855611
  type: 'test'
  ...
# Subtest: UTV2-1397: does not read or claim delivery status when absent from metadata
ok 4 - UTV2-1397: does not read or claim delivery status when absent from metadata
  ---
  duration_ms: 0.864031
  type: 'test'
  ...
1..4
# tests 4
# suites 0
# pass 4
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 883.953106
```

Issue-specific proof:

- Live-DB read against `public.picks` for the 30-day window
  (2026-06-02T16:39:46.456Z → 2026-07-02T16:39:46.456Z), filtered to
  `source IN (alert-agent, model-driven, smart-form)`, returned
  `real_sample_count: 0` for all three sources after excluding 1,745 /
  1,721 / 22,349 test/proof-fixture rows respectively.
- Production-wiring research (code inspection, not runtime probing) confirms
  none of the three sources are present in `docker-compose.prod.yml`'s
  service list or `.github/workflows/deploy.yml`'s build matrix — see
  `docs/06_status/proof/UTV2-1397/audit-report.md` for full detail per source.
- No picks were triggered, no synthetic samples were created, no DB rows
  were mutated, no fixture rows were cleaned, no delivery was activated, and
  no ROI/CLV/edge-performance claims were made, per this lane's constraints.

## Merge SHA

Branch head SHA at proof time: `5d6d63f3420dbe7324aceb5994ed353ca19f0b1a`.

Pending merge — this lane closes on tier policy (T2: orchestrator merge on
green, no PM_VERDICT required), per `docs/05_operations/WORKFLOW_SPEC.md`.
This section will be rebound to the merge SHA automatically by
`post-merge-lane-close.yml` (`ops:proof-generate --merge-sha`) after merge.
