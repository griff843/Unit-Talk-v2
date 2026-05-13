# Claude Critique — UTV2-949

**Issue:** P0 Protocol Failure Observability  
**Tier:** T2  
**Reviewer:** Claude (orchestrator)  
**Date:** 2026-05-13

---

## Summary

UTV2-949 adds structured observability to the P0 protocol gate: JSON failure events emitted at gate-block time, uploaded as GitHub Actions artifacts, and aggregated by `ops:p0-events` with a histogram and branch-protection mis-config check.

**Verdict: APPROVE**

---

## Invariant Correctness

**Pass.** The implementation is read-only observability — no state is mutated. The `formatP0Failures()` function only reads `TruthCheckResult` and returns a string; it does not call any sink or perform I/O. The `p0-events.ts` aggregator exits 0 always (non-fatal contract). The `daily-digest.ts` changes are additive — they call a subprocess and add a field to the report, without touching merge logic or gate enforcement.

The P0 gate itself (the `p0-protocol.yml` enforcement logic) is unchanged: the block condition, error count logic, and `exit 1` path are unmodified. The new JSON event and artifact upload run **after** the gate fires, in the existing code path that already calls `tee "$GITHUB_STEP_SUMMARY"`.

## Regression Risk

**Low.** Changes are confined to:
1. The `failure()` step in the CI workflow — only runs when P0 already blocks, so it cannot introduce a new block
2. An exported function in `truth-check-lib.ts` — no side effects, no callers in production paths
3. A new standalone script (`p0-events.ts`) — not imported by any app or package
4. An additive field in `DigestReport` — daily-digest exits 0 always; the P0 subprocess also exits 0 always

The `runSubprocess` call in `fetchP0EventsSummary` uses the existing pattern from `fetchCiFailures`, including the same `ok: result.status === 0 || result.status === 3` check. If `ops:p0-events` fails or produces no JSON, `fetchP0EventsSummary` returns a `skipped: true` summary and pushes to `infra_errors` — not a fatal path.

## Scope Drift

**None.** The 6 files changed match the `file_scope_lock` in the lane manifest exactly. No files outside the declared scope were touched.

## Hidden Coupling

**One noted, acceptable.** The `p0-events.ts` ZIP parser uses a hand-rolled PKZIP local-file-header walker. This is acceptable because:
- GitHub Actions artifacts are single-file ZIPs with no compression (stored)
- The target file name `p0-failure-event.json` is fixed
- The code handles missing files gracefully (returns `null`)
- No production path depends on this — it's a diagnostic tool

If GitHub ever changes artifact ZIP structure, `p0-events` will return 0 events (graceful degradation), not a crash.

## TypeScript Safety

`TruthCheckResult` is imported from `./shared.js` in the test file, matching the actual type definition. The `formatP0Failures` function parameter type is correct. No `any` casts introduced.

## Test Coverage

4 tests added:
1. Empty checks → empty string (no false positives)
2. H-check passes → empty string (passing H-checks not reported)
3. Two failing H-checks → two JSON lines, fields verified
4. Non-H failures → empty string (correct filter)

All 148 tests pass.

---

## Items That Require Runtime Verification

1. Push branch and open PR — confirm `p0-protocol.yml` workflow runs clean (no parse errors in new steps)
2. Confirm `ops:p0-events` CLI runs without error when GITHUB_TOKEN is present (even if returns 0 events)
3. Confirm `ops:daily-digest` CLI runs without error and includes `p0_events` field in output
