# PROOF: UTV2-1460
MERGE_SHA: a081e88adef5d88bcc7af3f6f7ecadfed7fdd52f

Post-merge proof, rebound to the actual PR #1229 merge commit SHA above via
the governed lane-close proof repair path, per `EXECUTION_TRUTH_MODEL.md`.
(Pre-merge PR head SHA was `a8afd8850ab2087fb35dbd1775491440776f0847`.)

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
Head SHA: a8afd8850ab2087fb35dbd1775491440776f0847
Merge SHA: a081e88adef5d88bcc7af3f6f7ecadfed7fdd52f (PR #1229)
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
Head SHA: a8afd8850ab2087fb35dbd1775491440776f0847
Merge SHA: a081e88adef5d88bcc7af3f6f7ecadfed7fdd52f (PR #1229)
Rebind note: re-bound after a main-sync rebase performed on 2026-07-17; no
code or proof content changed, only the branch's position relative to main.
