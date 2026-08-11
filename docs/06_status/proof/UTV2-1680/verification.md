# PROOF: UTV2-1680

MERGE_SHA: ccd485646ad521b92b0e92c85c9d982866c6cc0d

Verified implementation SHA: `ccd485646ad521b92b0e92c85c9d982866c6cc0d`

> Pre-merge, `MERGE_SHA` carries the verified implementation SHA. The post-merge closeout workflow rebinds this anchor to the authoritative merge SHA.

## ASSERTIONS:

- [x] Execution-state reports the canonical local plus open-PR-head union.
- [x] Capacity uses the canonical per-lane classification matrix rather than active-lock membership.
- [x] Every capacity metric names its source population, observation timestamp, and classification rule.
- [x] Parked lanes remain visible while consuming zero executor, total, and lane-type capacity.
- [x] Active-lane discovery failures refuse the report instead of producing an empty board.

## EVIDENCE:

The measured commands and issue-specific assertions are recorded below.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm exec tsx --test 'scripts/ops/execution-state.test.ts'` | PASS | 13 tests passed; 0 failed |
| `pnpm type-check` | PASS | TypeScript project-reference checks completed with exit code 0 |
| `pnpm lint` | PASS | ESLint completed with exit code 0 |
| `pnpm test` | PASS | Root aggregate completed within `pnpm verify:static` with exit code 0 |
| `pnpm verify:static` | PASS | DB boundary, sync/alignment, env, lint, type-check, build, root tests, Smart Form verification, and command checks completed before the full gate advanced to live-DB verification |
| `pnpm verify` | EXPECTED DEFERRED | Static verification passed; writable DB verification was refused because the configured target was not the required staging identity |
| `pnpm ops:execution-state -- --json` | PASS | Live read-only canonical discovery reported 10 visible lanes, 7 total-counting lanes, Claude 2/4, Codex 1/6, and three parked visible/uncounted lanes |

### Issue-specific assertions

- The report builder requires an `ActiveLaneDiscovery`, preventing callers from substituting a local-only manifest array.
- A local manifest and an open-PR-head manifest both appear in the report with `manifest_source` set to `local_worktree` and `open_pr_head`, respectively.
- A parked runtime lane remains in `active_lanes` with `classification=visible_uncounted`, while total, executor, type, and singleton capacity exclude it.
- All `dispatch_slots`, `active_by_executor`, and `active_by_lane_type` metrics carry `source_population=canonical_active_lane_union`, the report timestamp, and the applied classification rule.
- Injecting a throwing `listOpenPullRequests` produces `ActiveLaneDiscoveryError(code=active_lane_discovery_failed)` and no report.

### Live read-only board proof

Observed at `2026-08-11T21:31:30.703Z`:

```text
canonical visible lanes: 10
total capacity:          used=7 max=10 available=3
claude capacity:         used=2 max=4  available=2
codex capacity:          used=1 max=6  available=5
parked visible lanes:    UTV2-1570, UTV2-1577, UTV2-1578
parked classification:   visible_uncounted (executor=false total=false laneType=false)
```

The historical issue measurement was a point-in-time snapshot from 2026-08-07. The current live board has since changed; this run proves that the reporter now agrees with the canonical resolver rather than returning the former local-only zero.

### Database verification

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

This T2 lane changes read-only repository governance tooling and performs no database writes.

### R-level compliance

`npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` passed against the committed proof bundle:

```text
Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff
```

The changed implementation paths under `scripts/ops/**` do not match a rule in `docs/05_operations/r1-r5-rules.json`.
