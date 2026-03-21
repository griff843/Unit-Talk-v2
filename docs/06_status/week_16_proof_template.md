# Week 16 Proof Template

Use this template to record independent verification for Week 16.

Week 16 is not closed until this proof is completed and the result is reflected in:
- `docs/06_status/status_source_of_truth.md`
- `docs/06_status/current_phase.md`
- `docs/06_status/system_snapshot.md`
- Notion Week 16 checkpoint
- the active Linear Week 16 issue

## Metadata

| Field | Value |
|---|---|
| Week | 16 |
| Slice | Settlement downstream truth + accepted salvage foundation |
| Verification date | 2026-03-21 |
| Verifier | Claude (independent verification session) |
| Result | **PASS** |

## Scope Verified

Check all that apply:

- [x] runtime settlement downstream truth reaches real runtime consumers
- [x] operator-web picks pipeline uses effective corrected settlement truth
- [x] accepted Batch 1 foundation exists in repo
- [x] accepted Batch 2 foundation exists in repo
- [x] accepted Batch 3 foundation exists in repo
- [x] accepted Batch 4 foundation exists in repo
- [x] accepted Batch 5 foundation exists in repo
- [x] current gate state is verified

## Runtime Verification

| Check | Method | Expected | Result |
|---|---|---|---|
| Settlement API returns downstream bundle | `settle-pick-controller.ts` returns `downstream: { effectiveRecordId, effectiveStatus, effectiveResult, correctionDepth, isFinal, totalRecords, pendingReviewCount, correctionCount, hitRatePct, flatBetRoiPct, lossAttributionClassification, unresolvedReason }` on canonical settlement path | downstream truth present | **PASS** |
| Confirmed losses compute loss attribution when inputs exist | `settlement-service.ts:319` calls `computeLossAttributionForPick(pick, resolved.settlement)` and returns `lossAttribution` + `lossAttributionSummary` in result bundle | loss attribution present | **PASS** |
| Operator-web picks pipeline resolves effective corrected settlement | `server.test.ts:98` — `createSnapshotFromRows uses effective corrected settlement result in picks pipeline` test present and passing | corrected settlement used | **PASS** |

## Foundation Verification

| Batch | Expected destination | Verified |
|---|---|---|
| Batch 1 | `packages/domain/src/market`, `features`, `models`, `signals` | **PASS** — `market/` (4 files + test), `features/` (5 files + 4 tests + index), `models/` (6 files + 5 tests + index), `signals/` (3 files + 3 tests + index) |
| Batch 2 | `packages/domain/src/bands`, `calibration`, `scoring` | **PASS** — `bands/` (5 files + test + index), `calibration/` (5 files + test + index), `scoring/` (6 files + test + index) |
| Batch 3 | `packages/domain/src/outcomes`, `evaluation`, `edge-validation`, `market/market-reaction.ts` | **PASS** — `outcomes/` (8 files + 3 tests + index), `evaluation/` (5 files + test + index), `edge-validation/` (4 files + test + index), `market/market-reaction.ts` present |
| Batch 4 | `packages/domain/src/rollups`, `system-health`, `outcomes/baseline-roi.ts` | **PASS** — `rollups/` (3 files + test + index), `system-health/` (4 files + test + index), `outcomes/baseline-roi.ts` present |
| Batch 5 | `packages/domain/src/risk`, `strategy` | **PASS** — `risk/` (2 files + test + index), `strategy/` (6 files + test + index) |

## Gate Verification

| Gate | Expected | Result |
|---|---|---|
| `pnpm type-check` | clean | **PASS** — clean, no errors |
| `pnpm lint` | clean | **PASS** — clean, no warnings |
| `pnpm build` | clean | **PASS** — clean, no errors |
| `pnpm test` | `491/491` passing | **PASS** — `# tests 491 # pass 491 # fail 0` |

## Boundary Verification

| Rule | Expected | Result |
|---|---|---|
| Accepted salvage remains pure computation | no I/O / DB side effects in domain modules | **PASS** — grep for `supabase`, `createClient`, `fetch(`, `fs.`, `writeFile`, `readFile` in `packages/domain/src/` returned 0 matches. All `new Date()` usages have optional timestamp injection parameters. |
| Legacy repo remained reference-only | no legacy runtime imports | **PASS** — grep for `unit-talk-production` imports in `packages/domain/src/` returned 0 matches |
| Week 16 still not overstated | foundation acceptance not confused with closeout | **PASS** — `status_source_of_truth.md` and `current_phase.md` both state "pending independent verification and closeout" and list batches as "accepted foundation" only |

## Final Verdict

- [x] PASS - Week 16 closeout may proceed
- [ ] FAIL - see `docs/06_status/week_16_failure_note_template.md`

## Notes

- All `new Date()` usages in domain modules use the `timestamp ?? new Date().toISOString()` pattern — the optional parameter preserves function purity for testing while allowing convenient defaults at call sites.
- `strategy/` is intentionally not re-exported from `packages/domain/src/index.ts` due to `americanToDecimal` name collision with `risk/kelly-sizer.ts`. Consumers import directly: `import { ... } from '@unit-talk/domain/strategy'`.
- `calibration/` and `evaluation/` are intentionally not re-exported from the top-level domain index to avoid naming collisions with existing `probability/calibration.ts` score helpers.
- Domain source: 76 files, 10,379 lines. Domain tests: 29 files, 4,761 lines. 15 modules total.
