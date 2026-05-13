# Proof Bundle — UTV2-949

**Issue:** UTV2-949 — P0 Protocol Failure Observability  
**Tier:** T2  
**Branch:** griffadavi/utv2-949-utv2-949-p0-protocol-failure-observability  
**Head SHA (at proof generation):** 720a80928ec95c28e70c9355b03f1beb42958657  
**Verified at:** 2026-05-13T00:00:00Z

---

## Static Verification

| Check | Result | Detail |
|---|---|---|
| type-check | PASS | `pnpm type-check` clean — no errors |
| lint | PASS | `pnpm lint` clean — no errors |
| build | PASS | `pnpm build` clean |
| test | PASS | 148/148 tests pass (includes 4 new formatP0Failures tests) |

---

## Files Changed

1. `.github/workflows/p0-protocol.yml` — structured JSON failure event + artifact upload step
2. `scripts/ops/truth-check-lib.ts` — `formatP0Failures()` exported function
3. `scripts/ops/truth-check-lib.test.ts` — 4 new tests for `formatP0Failures()`
4. `scripts/ops/p0-events.ts` — new aggregator script (7-day histogram + mis-config check)
5. `scripts/ops/daily-digest.ts` — P0 section: failure count + mis-config warning
6. `package.json` — `"ops:p0-events"` script entry

---

## Acceptance Criteria

- [x] p0-protocol.yml gate emits structured JSON failure event on block
- [x] JSON artifact uploaded to GitHub Actions with 90-day retention
- [x] `formatP0Failures()` formats H-check failures as log lines
- [x] Tests cover: empty result, passing H-checks, dual failures, non-H ignored
- [x] `pnpm ops:p0-events` aggregates last 7 days by block_reason histogram
- [x] Mis-config check verifies `P0 Protocol` in required status checks
- [x] `daily-digest.ts` includes P0 failure count + mis-config alert in output

---

## Scope Confirmation

No changes outside declared `file_scope_lock`. No auth bypasses. No scope expansion.
