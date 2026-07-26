# UTV2-1585 verification

## Summary

The Merge Gate workflow now owns one canonical custom check per PR and exact
head SHA. The native Actions job uses the distinct `Merge Gate Evaluator`
identity, and repeated policy events update the canonical check in place.

## Evidence

- Substantive implementation commit: `0e020c36c742fa4a584f55ab789f5b3e3d41789d`
- Pull request: #1305
- Focused workflow-hardening result: 44 tests, 44 pass, 0 fail, 0 skipped (includes an independent-review-driven correction: see below)
- Live database smoke result: 7 tests, 7 pass, 0 fail
- R-level result: PASS, no matching rules
- File-scope result: PASS

## Verification

The following commands were executed on the substantive branch head:

- `npx tsx --test scripts/ops/workflow-hardening.test.ts`
- `pnpm type-check`
- `pnpm lint`
- `pnpm test`
- `pnpm test:db`
- `pnpm verify`
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`
- `npx tsx scripts/ci/file-scope-guard.ts --base origin/main --head HEAD --branch codex/utv2-1585-merge-gate-canonical-check-identity`

```text
Focused workflow hardening
1..44
# tests 44
# pass 44
# fail 0
# skipped 0

Live database smoke
1..7
# tests 7
# pass 7
# fail 0
# skipped 0
# duration_ms 109909.776482

pnpm verify
exit 0

R-level
Verdict: PASS
Changed files: 8
Rules matched: none
```

The T1 live-proof battery also completed with zero failures. One bounded
provider-history assertion skipped because the latest provider snapshot was
older than its lookback window; the test explicitly classifies that condition
as stale provider data, not a code regression.

## Independent review finding and correction

An independent Claude adversarial review (fresh context, no prior involvement
in this implementation) returned APPROVE_WITH_NOTES with one real, verified
finding: the original canonical-check match filter required an exact
`external_id` match, which never matches check-runs created by the *former*
create-on-every-event behavior (those never had an `external_id` set). On an
already-polluted head, the fix as originally written would create a new,
additional check rather than adopting and neutralizing the existing ones.

This was independently confirmed against PR #1304's actual live head SHA
(`d3fbd7b642a0b2f2cb9ecebe3c871648bf4f3f18`) via
`gh api repos/griff843/Unit-Talk-v2/commits/<sha>/check-runs`: six existing
`Merge Gate` check-runs, four `failure`, none carrying the
`merge-gate:<pr>:<sha>` external_id format the original filter required.

Corrected in commit `0e020c36c742fa4a584f55ab789f5b3e3d41789d`: the match
filter now matches on `name` + exact `head_sha` + `app.slug` only, preferring
an already-canonical `external_id` when present and otherwise falling back to
the most recently created same-head check, then explicitly re-binding the
adopted check's `external_id` on update so subsequent runs pick it
deterministically. A new focused test (`scripts/ops/workflow-hardening.test.ts`)
mirrors PR #1304's exact six-check polluted state and asserts all five
non-canonical checks go `neutral` and none remain `failure`.
