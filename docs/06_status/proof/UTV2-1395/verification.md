# UTV2-1395 — smart-form conviction=10 confidence capping fix

## Verification

This file is the T2 verification record for UTV2-1395.

## Metadata

| Field | Value |
|---|---|
| Issue ID | UTV2-1395 |
| Tier | T2 |
| Owner | claude/utv2-1395 |
| Date | 2026-07-01 |
| Verifier Identity | claude/utv2-1395-smart-form-conviction-cap |
| Commit SHA(s) | `7f51ac41c87d2fe7340697cf75468a88b302e595` (branch head; merge SHA bound post-merge) |
| Related PRs | (filled on open) |

## Scope

**Claims:**
- `buildSubmissionPayload()` maps `capperConviction=10` to `confidence=0.99`, not `1.0`
- `capperConviction` metadata value is unchanged (still 10) — display/audit unaffected
- `metadata.confidenceSource: 'capper-conviction'` recorded for explicit provenance
- `apps/smart-form/CLAUDE.md` corrected: the form's `capperConviction` field has mapped to submission `confidence` since UTV2-255 (March 2026); it does not lack a confidence signal

**Does NOT claim:**
- Any change to the conviction input UI, its range (1-10), or its display
- Any change to the `apps/api` fallback taxonomy or promotion-time recovery work (separate PR)

## Assertions

| # | Assertion | Evidence Type | Result |
|---|---|---|---|
| 1 | conviction=10 → confidence=0.99, strictly < 1.0 | test | PASS |
| 2 | capperConviction metadata remains 10 for max-conviction picks | test | PASS |
| 3 | confidenceSource='capper-conviction' recorded | test | PASS |
| 4 | Existing conviction=4/8/9 mappings unaffected (no regression) | test | PASS |
| 5 | pnpm verify green | repo-truth | PASS |

## Evidence Blocks

### E1-E4 smart-form unit tests

Command: `npx tsx --test apps/smart-form/test/form-utils.test.ts`
```
1..29
# tests 29
# suites 0
# pass 29
# fail 0
# cancelled 0
# skipped 0
# todo 0
```
All 29 tests pass, including the new conviction=10 test and the pre-existing conviction=4/8/9 regression tests.

### E5 pnpm verify

Full pipeline green: env:check, lint, type-check, build, `pnpm test`.

### E6 pnpm test:db

This lane makes no runtime code change (smart-form is a client-side payload builder; the API's write path is untouched), but `pnpm test:db` is included per the mechanical proof-auditor-gate requirement.

Command: `pnpm test:db` (live Supabase `zfzdnfwdarxucxtaojxm`)
```
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 105602.765618
```

## No UI/visual change — screenshots not applicable

This is a pure internal computation fix inside `buildSubmissionPayload()`. No component, layout, or visible form behavior changed — the conviction input, its range, and its on-screen display are all identical before and after this change. There is nothing new to visually verify via screenshot.

## Stop Conditions Encountered

None.

## Sign-off

**Verifier:** claude/utv2-1395-smart-form-conviction-cap — 2026-07-01
**PM acceptance:** pending

## Merge SHA Binding

(Filled post-merge by post-merge-lane-close.yml)
