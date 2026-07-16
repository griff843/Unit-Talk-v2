# PROOF: UTV2-1460
MERGE_SHA: 78578d5899edf3f31d7030c2b336b8631636941b

ASSERTIONS:
- [x] ops:proof-generate (pre-merge, no --merge-sha) writes verification.md in rebind-compatible format
- [x] Confirmed the underlying bug already fixed on origin/main by a prior lane
- [x] pnpm test:db passed against live Supabase (7/7)
- [x] pnpm type-check/test/verify all passed
- [x] Focused proof-generate tests: 21/21 passed
- [x] r-level-check PASS

EVIDENCE:
```text
$ npx tsx --test scripts/ops/proof-generate.test.ts
1..21
# pass 21
# fail 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS

$ pnpm test:db
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 17672.936174
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 22952.742968
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
# duration_ms 113643.651091
```

# UTV2-1460 Runtime Verification

Generated at: 2026-07-15T19:34:10.652Z
Issue: UTV2-1460
Tier: T2
Lane type: hygiene
Branch: codex/utv2-1460-proof-generate-verification-md
PR URL: N/A
Head SHA: 71f39c6d5e4099bde9ec32467055fab7a65b1bc3
Merge SHA: N/A
result: pass

## Verification
- [x] `pnpm type-check`: passed
- [x] `pnpm test`: passed
- [x] `pnpm verify`: passed
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: passed

## Runtime Verification
- `npx tsx --test scripts/ops/proof-generate.test.ts`: 21 passed, 0 failed.
- `pnpm ops:proof-generate -- --issue UTV2-1460 --current --json`: generated the required Markdown artifacts.
- `pnpm test:db`: 7 passed, 0 failed against live Supabase (executed output embedded above).
- The requested behavior was already present on `origin/main` (landed via a prior lane); this lane confirms it and records the required proof bundle.

## SHA Binding
Head SHA: 71f39c6d5e4099bde9ec32467055fab7a65b1bc3
Merge SHA: N/A
