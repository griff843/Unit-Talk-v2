# PROOF: UTV2-1694

MERGE_SHA: ee9a8845148b2f885a3b5f9fb33e564a63ec8b0a

Verified implementation SHA: `ee9a8845148b2f885a3b5f9fb33e564a63ec8b0a`

> Pre-merge, `MERGE_SHA` carries the verified implementation SHA. The required
> `Executor Result Validation` check enforces `^[0-9a-f]{7,40}$` on this field, so
> no placeholder can satisfy it and the merge SHA does not yet exist.
> `post-merge-lane-close.yml` rebinds this anchor to the authoritative merge SHA.

## ASSERTIONS:

- [x] A PR whose required checks are all `SUCCESS` (upper-case) produces an empty check-derived blocker list.
- [x] Mixed-case conclusions (`success` and `SUCCESS`) are treated identically.
- [x] A PR that is `BEHIND` its base reports that as a blocker with actionable wording.
- [x] A genuinely failing required check is still reported as a blocker.
- [x] No success/neutral/skipped conclusion can ever appear in `blockers`.

## EVIDENCE:

The measured commands and independent review result are recorded below.

## Verification

Completed successfully:

- `pnpm exec tsx --test 'scripts/ops/pr-block-diagnostic.test.ts'` — 8 passing tests.
- `pnpm type-check` — passed.
- `pnpm test` — passed as part of `pnpm verify:static`.
- `pnpm verify:static` — passed. The existing non-failing `WIRING_GLOB_SHADOWED` advisory was reported by automation coverage.
- `pnpm verify` — passed.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — `Verdict: PASS`; no R-level rules matched.

Issue-specific coverage proves that `success`/`SUCCESS`, `neutral`/`NEUTRAL`, and `skipped`/`SKIPPED` never create check-derived blockers; a failing required check still does. It also proves actionable blockers for `mergeStateStatus: BEHIND` and `DIRTY`.

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires `xskgrzbteyqdufktjrjx`. Run it through the staging-ci GitHub environment with `CI_SUPABASE_*` credentials.

Execution checkpoint persistence was unavailable: `pnpm ops:exec-checkpoint heartbeat --issue UTV2-1694` returned `execution_checkpoint_missing`. No checkpoint state was modified because the checkpoint initializer is outside this lane's allowed scope.

## Independent review

Reviewed by the `codex-return-reviewer` subagent (advisory; CI, Merge Gate and PM
policy remain the blocking authority). Verdict: **APPROVE**, no blocking findings.

The reviewer independently mutation-tested the control: reverting
`isPassingConclusion` to the original case-sensitive comparison fails 3 of the
new/modified tests, proving the regressions are load-bearing rather than
decorative. It also independently re-ran the focused tests (8/8), `pnpm
type-check` (clean) and `r-level-check` (PASS), matching the claims above.

Advisory findings recorded, neither blocking:
1. No standalone unit test with an explicit `conclusion: null` object; that path
   is covered incidentally via the "required check is missing" test.
2. This bundle discloses deferred live-DB proof and a missing execution
   checkpoint rather than omitting them.

## Proof-gate remediation

This bundle originally lacked a `MERGE_SHA` anchor and the `# PROOF:` /
`ASSERTIONS:` / `EVIDENCE:` sections, which failed `Runtime Verifier Gate`
(`runtime-verifier-gate.ts:132-134` requires a 40-hex SHA) and produced
`CEP-E3`/`CEP-E5` findings in `Close eligibility preflight`. Both were added
here. Diagnosed by the `ci-triage` subagent.
