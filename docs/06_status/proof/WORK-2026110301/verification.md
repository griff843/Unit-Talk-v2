# PROOF: WORK-2026110301

MERGE_SHA: bb1947e317679d573e00f3b1d2fcd350873b4345

Execution SHA: ca37fd5281e3e7df42db34a66e7aa4eb2222c2a2
Status: pre-merge; staging proof and governed review pending. No merge, approval or exact-head green CI claim.

## Verification

ASSERTIONS:

- [x] Regression first: the unchanged service failed the two new tests (28 pass / 2 fail). Saved output is `regression-before.txt`. At that measurement both original scoped files matched origin/main e4c5138eebce01b3df19c0edae7005630c951a35; lane HEAD was 539a9dc1da7f11b74ca4313f139c694562fd3b34.
- [x] The unique provider match builds `https://assets.nhle.com/mugs/nhl/latest/<playerId>.png`, with no team or season segment. Focused suite: 30 pass / 0 fail (`regression-after.txt`). Baseline suite had 28 tests; no test was removed.
- [x] Old-host mutation restores only the builder URL and fails four tests, including both new regressions: 26 pass / 4 fail (`mutation-old-host.txt`). The live builder is restored afterward and contains no dead host.
- [x] All identity assertions remain unchanged. The two existing URL expectation updates are explicitly authorized by Production Claude's ruling in the packet and saved handoff. Each preserves the selected provider ID; no identity assertion was loosened or removed.
- [x] Runtime provider proof: 187/187 selected NHL snapshot rows returned HTTP 200, image/png, positive bytes. Nonexistent ID 9999999 returned 302, empty content type and zero bytes. Redirects were not followed. Per-row measurements and input digest: `nhl-asset-host-check.json`.
- [x] `updateMetadata` is unchanged. No new live DB test is added and no live DB enrichment proof is claimed. No stored data was changed and production was not connected to.
- [x] Source scope is limited to the two allowed files; host allowlists, canonical submission, distribution, outbox, worker, domain and Discord paths are unchanged. No new any cast.
- [x] `pnpm verify:static` passed within the initial `pnpm verify` run: lint, type-check, build, aggregate tests (120 TAP groups; zero failing assertions), post-migration tests, Smart Form verification, command manifest and migration checks. Smart Form browser e2e was not run because its opt-in flag was unset. Expired wiring baseline entries were warnings.
- [ ] Full `pnpm verify` green at exact final head: pending; local writable DB identity guard refuses this workspace. Final measured local command outcomes and head are recorded in `.out/ops/ready-for-pr/WORK-2026110301.md`.
- [ ] Exact-head CI `Writable DB proof (staging only)`: Production Claude must open the PR when the staging slot is free; no PR opened by this executor.
- [ ] Outer-wrapper executor-result/v1, independent Claude review, Griff t1-approved label and pm-verdict/v1 APPROVED at exact head.
- [ ] Governed merge and post-merge evidence binding to the attested merge SHA. Evidence bundle v1 uses the current schema-v2 binding envelope; merge_sha remains null until merge.

EVIDENCE:

```text
pnpm exec tsx --test apps/api/src/player-enrichment-service.test.ts
Before: 28 pass / 2 fail (unchanged main implementation)
After: 30 pass / 0 fail
Old-builder mutation: exit 1, 26 pass / 4 fail
pnpm verify
All static gates PASS; exit 1 at staging identity prerequisite before writable DB suites.
pnpm test:db
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
No writable DB suite ran. Requires staging-ci GitHub environment with CI_SUPABASE_* credentials.
pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS; no matching rules at implementation commit. Exact-final-head outcome in handoff.
```

## Expected-URL update only

Production Claude's 2026-11-03 ruling authorizes these URL expectation changes. Assertion operators and all other existing assertions are preserved. Final test lines 249 and 329:

```ts
// expected-URL update only, line 249 — before:
  assert.match((await resolveHeadshotUrl('Jake Evans', 'NHL', null, { teamAbbrev: 'MTL' }))!, /\/1.jpg$/);
// after:
  assert.match((await resolveHeadshotUrl('Jake Evans', 'NHL', null, { teamAbbrev: 'MTL' }))!, /^https:\/\/assets\.nhle\.com\/mugs\/nhl\/latest\/1\.png$/);
// expected-URL update only, line 329 — before:
  assert.match(evans.url!, /\/8474100.jpg$/);
// after:
  assert.match(evans.url!, /^https:\/\/assets\.nhle\.com\/mugs\/nhl\/latest\/8474100\.png$/);
```

## Limits and pending handoff

Writable live-DB proof is blocked/deferred. The packet reported host=unparseable; the current measured guard reports host=127.0.0.1. Writable verification requires xskgrzbteyqdufktjrjx via staging CI. No credential transport or production access is attempted.

HTTP availability does not establish visual identity or indefinite latest-path stability. The saved measurements show no latest-path availability failure in the selected set. No alternative URL format is guessed.

Observed current attempt model and effort: gpt-6.1-sol, medium, read directly from Codex session_meta/turn_context; see `model-routing.json`. The outer wrapper owns final execution provenance and executor-result publication. No child READY_FOR_REVIEW attestation is published.

The previous full ops:brief failed configured pipeline/product-truth reads with fetch failures; no successful DB observation is claimed. Current static brief succeeded. Merge, lane finalization and orchestration reconcile remain for the authorized post-executor path.

## Merge SHA Binding

Merge SHA: bb1947e317679d573e00f3b1d2fcd350873b4345
PR: pending
Approved PR head: pending merge
Execution SHA: ca37fd5281e3e7df42db34a66e7aa4eb2222c2a2
