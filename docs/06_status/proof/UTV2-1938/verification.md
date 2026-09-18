# PROOF: UTV2-1938

MERGE_SHA: 4eb4d9a3fd14d1c57abb509ad0188543979eff44

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-18T19:41:29.234Z
Issue: UTV2-1938
Tier: T1
Lane type: runtime
Branch: claude/utv2-1938-human-capper-event-gate-waiver
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1611
Head SHA: af490ecd4bb1354e7e337e8faca8bef64205572d
result: not_run

## ASSERTIONS:

- [x] An allow-listed human capper's `structured-team-fallback` or `manual-coverage-gap`
      submission naming no canonical event waives the armed event-existence gate and
      persists exactly one pick.
- [x] A `delivery-eligible` submission carrying **no** server authorization record still
      receives 422 `EVENT_NOT_FOUND` and persists nothing — the UTV2-1842 protection is
      unchanged.
- [x] An unauthorized capper is unaffected: pinned `track-only`, waiver already applied,
      behaviour byte-identical to before this change.
- [x] `canonical-event`, `not-smart-form`, and an absent outcome never waive.
- [x] The authorization fact is read only from `isHumanCapperDeliveryAuthorized(metadata)`
      — a record `handlers/submit-pick.ts` deletes off the client payload unconditionally
      before re-authoring it from the env allow-list and the authenticated identity.
- [x] Mutation drill: restoring the UTV2-1842 predicate fails exactly the new
      UTV2-1938-sensitive tests and leaves every UTV2-1842 refusal test green.

## EVIDENCE:

Measured on `af490ecd4bb1354e7e337e8faca8bef64205572d` in the lane worktree.

```
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
exit=0

$ pnpm lint
> eslint . --cache --cache-location .cache/eslint/
exit=0

$ pnpm test
tests=6557 pass=6557 fail=0   (aggregated over 104 test files)
exit=0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 6
Rules matched: (none) - no R-level artifacts required for this diff
exit=0

$ pnpm verify
Runs env:check + lint + type-check + build + test. Its ci:assert-staging step
cannot exit 0 from this containment-isolated checkout (local.env pins
SUPABASE_URL=http://127.0.0.1:1). Its four constituent gates are measured
individually above; `verify` itself is executed by CI on this PR, which is also
where the live-DB proof below runs.
```

Mutation drill, run by reverting `waivesEventExistenceGate` to its UTV2-1842 body
(`return outcome.distributionMode === 'track-only'`) and restoring it afterwards:

```
$ pnpm exec tsx --test apps/api/src/submission-service.test.ts      # MUTATED
not ok 96 - UTV2-1938: a server-authorized delivery-eligible manual-coverage-gap outcome waives the event existence gate
not ok 97 - UTV2-1938: a server-authorized delivery-eligible structured-team-fallback outcome waives the event existence gate
not ok 98 - UTV2-1842: waivesEventExistenceGate is the whole predicate, and it is fail-closed
# pass 95
# fail 3

$ pnpm exec tsx --test apps/api/src/submission-service.test.ts      # RESTORED
# pass 98
# fail 0
```

Every UTV2-1842 refusal test stayed green under the mutation. That is the point of
recording the drill this way: the new tests are sensitive to the change, and the
protections the change preserves are demonstrably not what is carrying them.

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: exit 0 — 6557 tests, 6557 pass, 0 fail
- [ ] `pnpm verify`: not executable from this containment-isolated checkout; executed by CI on PR #1611 (see EVIDENCE)
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: exit 0, Verdict PASS

## Runtime Verification

The runtime proof for this lane is the live-DB test added to
`apps/api/src/t1-proof-utv2-1842-fallback-event-gate.test.ts`:

> `UTV2-1938 live DB: a SERVER-AUTHORIZED delivery-eligible fallback passes the armed
> event gate and persists`

It calls `armTheGate('server-authorized')` before submitting, so the event-existence
gate is genuinely firing against a real database at the moment of the assertion. This
is the assertion the unit suite structurally cannot make: the in-memory bundle's
`events` table starts empty, and the gate is **dormant** on an empty table, so no
in-memory test can observe the refusal this repair removes.

It is recorded as `not_run` here rather than claimed, because this checkout is
containment-isolated (`SUPABASE_URL=http://127.0.0.1:1`, `SUPABASE_PROJECT_REF=containmentlocal0000`)
and the file skips itself with `SUPABASE_SERVICE_ROLE_KEY not configured`. The test
executes against staging inside CI's `verify` job on PR #1611, and
`post-merge-lane-close.yml` harvests that receipt into this bundle at closeout.

The test asserts what the waiver does and refuses to overclaim: the pick is admitted to
**persistence**, with `eventId: null` and `resolution: manual` / `reason: canonical-coverage-gap`
read back over PostgREST rather than trusted from the controller's return value. Delivery
is asserted on its own terms in both directions — `delivery-refused` must write zero outbox
rows, `delivered` must write exactly one on `discord:official-picks` — because the registry
target gate and the database kill switch decide that, and this lane touches neither.

### Production measurement — the defect, measured rather than argued

Read-only against production `zfzdnfwdarxucxtaojxm` at 2026-09-18T19:50Z. Zero rows
written, updated or deleted; no containment setting, kill switch, delivery target or
deploy touched. Full queries and counts are in `evidence.json` → `runtime_proof`.

| Measurement | Value |
|---|---|
| `events` rows inside the band `listUpcoming(undefined, 90)` actually reads | **178** — so the gate is ARMED |
| `events` with `event_date >= current_date` | **0** — nothing is selectable, and the gate still fires |
| Picks naming an event with **zero** matching `events` rows, `track-only` | **5** |
| Picks naming an event with **zero** matching `events` rows, `delivery-eligible` | **0** |
| Governed picks created in the last 24h (newest 01:36:52Z) | 3, then none |
| Governed delivery targets `killed = true` | 4 of 4 |

The **0 vs 5** is the defect. The UTV2-1842 waiver demonstrably works — five Track Only
picks naming no catalogued event are persisted in production right now. Not one
`delivery-eligible` pick is, because the waiver excluded that caller, and UTV2-1923 pins
an allow-listed capper to exactly that mode.

The alternative explanation — that `delivery-eligible` submissions are fine — is ruled
out by the join: the one `delivery-eligible` pick that persisted (`816a84c7`,
"Lions @ Bills") had **1** matching `events` row, so it satisfied the gate outright and
never reached the waiver. The two picks that needed the waiver were both Track Only.

This establishes the defect. It does not establish the fix: the repair is on this branch
and is not deployed. The red/green for the repair is the mutation drill above and the
armed-gate live-DB test.

## Merge SHA Binding

Merge SHA: 4eb4d9a3fd14d1c57abb509ad0188543979eff44
PR: https://github.com/griff843/Unit-Talk-v2/pull/1611
Approved PR head: pending merge
Execution SHA: af490ecd4bb1354e7e337e8faca8bef64205572d
