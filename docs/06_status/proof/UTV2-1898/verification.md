# PROOF: UTV2-1898

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Issue: UTV2-1898
Tier: T1
Lane type: runtime
Branch: claude/utv2-1898-edge-provenance-scope
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1576
Head SHA: 5dd5de31d1af1e77559dcab281d7b5df2cef510b
result: pass

## ASSERTIONS:

- [x] A provider offer may back a pick only on an exact match of sport, event, market and participant.
      `findLatestByMarketKey(key, provider?, participant?)` is gone; `findLatestScopedOffer(criteria)`
      requires all four, and `providerParticipantId` distinguishes `null` (*must be NULL*) from
      `undefined` (*inadmissible*). The repository can no longer express "unfiltered".
- [x] An offer older than `PROVIDER_OFFER_MAX_AGE_MS` (6 hours) is refused before it is priced,
      not after.
- [x] Participant scope is derived once, from `classifyMarketFamilyForGrading`, in both the
      submission and edge paths. An unrecognised market key fails closed.
- [x] When no valid offer exists the submitted pick is preserved exactly as given and edge is
      recorded unavailable with the reason naming the missing dimension — `no-sport-scope`,
      `no-event-scope`, `no-fresh-offer`, `offer-participant-unattributed`, `no-provider-offer`.
      No value is manufactured, and an unavailable edge is never positive.
- [x] The specific production defect cannot recur: the literal 75-day MLB reproduction asserts
      `marketProbability !== 0.478261`.
- [x] The controls are not vacuous: a six-mutation battery, run alone, turns a named test red for
      every one of them, and the regression suite carries a passing control so it cannot pass by
      matching nothing.
- [x] The DB implementation, which no unit test reaches, is asserted against a real database by
      `apps/api/src/t1-proof-utv2-1898-edge-scope.test.ts` under
      `Writable DB proof (staging only)`.
- [x] No production data is written by this change, and no containment setting is altered.

## EVIDENCE:

All commands run in the lane worktree at `5dd5de31d1af1e77559dcab281d7b5df2cef510b`.

```
$ pnpm type-check
exit 0

$ pnpm lint
exit 0

$ pnpm test
# tests 6250
# pass 6250
# fail 0
# skipped 0
# todo 0
exit 0

$ pnpm exec tsx --test apps/api/src/real-edge-scope-regression.test.ts
# tests 22 # pass 22 # fail 0 # skipped 0

$ pnpm exec tsx --test apps/api/src/promotion-edge-integration.test.ts
# tests 81 # pass 81 # fail 0 # skipped 0

$ pnpm exec tsx --test apps/api/src/submission-service.test.ts
# tests 96 # pass 96 # fail 0 # skipped 0

$ pnpm exec tsx --test apps/api/src/golden-regression.test.ts
# tests 5 # pass 5 # fail 0 # skipped 0

$ pnpm exec tsx --test apps/api/src/market-universe-materializer.test.ts
# tests 21 # pass 21 # fail 0 # skipped 0

$ pnpm verify
NOT RUN on the workstation, by design: `verify` ends at `test:live-db`, which
`ci:assert-staging` refuses without staging credentials. Its components — env:check,
lint, type-check, build, test — are run individually above, and `verify` itself is
executed by the CI job of the same name on this head.

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 17
Rules matched: lifecycle-fsm, promotion-scoring, ingestor-provider
Advisory (PM-gated) artifacts missing:
  - r4-fault-report [PM-gated]

$ python3 mutation-battery-1898.py            # run alone
RED (control holds)  scope-1   sport predicate dropped from the scoped lookup            -> 2 failing
RED (control holds)  scope-2   event predicate dropped from the scoped lookup            -> 2 failing
RED (control holds)  scope-3   an unresolved participant reads as "no filter" again      -> 1 failing
RED (control holds)  fresh-1   freshness window removed                                  -> 1 failing
RED (control holds)  family-1  participant scope narrowed back to moneyline only         -> 3 failing
RED (control holds)  family-2  submission re-derives participant scope from a heuristic  -> 1 failing
BATTERY PASSED — 6/6 mutations turned a test red
```

The assertion each mutation kills, so that "red" is not merely a count:

| mutation | named assertion that fails |
|---|---|
| scope-1 | `sport is compared, not merely carried: an NFL scope does not match an MLB row even at the same event id` |
| scope-2 | `an offer from a different event in the same sport cannot back the pick` |
| scope-3 | `an unresolved participant refuses the lookup rather than matching any participant` |
| fresh-1 | `an in-scope offer outside the freshness window is refused as stale, not used` |
| family-1 | `a spread offer that names no participant is refused, not attributed to the pick` (+ team_total_ou, passing-yards-all-game-ou) |
| family-2 | `nfl-suppressed-void stays golden` |

**The battery's stated limit.** Both repository mutations target the **in-memory**
`findLatestScopedOffer`, because that is what these tests call. The Supabase implementation had
no unit-test boundary at all — which is exactly why the Proof Coverage Guard was substantively
right on this lane rather than incidentally red, and why the live-DB proof below exists.

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: exit 0 — 6250 tests, 6250 pass, 0 fail, 0 skipped
- [ ] `pnpm verify`: NOT RUN on the workstation by design (see EVIDENCE); executed by the CI
      `verify` job on this head, which is one of the two contexts `G6` requires green on the merge SHA
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS
- [x] `pnpm lint`: exit 0
- [x] mutation battery, run alone: 6/6 red

## Runtime Verification

Route B: this lane's manifest carries `t1_live_db_precondition: deferred_to_ci`, so the live-DB
evidence is obtained in CI rather than on the workstation. `G6` refuses closeout unless **both**
`verify` and `Writable DB proof (staging only)` are green on the merge SHA.

`apps/api/src/t1-proof-utv2-1898-edge-scope.test.ts` is the live-DB proof, wired into
`pnpm test:t1-proof:live` and classified in `docs/05_operations/db-writer-classification.json` as
an api-owned credentialed test. It runs against staging `xskgrzbteyqdufktjrjx`;
`scripts/ci/assert-staging-target.ts` refuses any other target. It asserts five things no unit
test can:

1. every near-miss row is refused before any matching row exists — four rows, each differing in
   exactly one of sport / event / market / participant;
2. each of those four rows is findable by its own scope — the control that stops (1) being
   satisfied by the rows never having been written;
3. an exact-scope offer is found and its `snapshot_at` is `Date.parse`-able, which is what
   `resolveMatchingOffer` calls before comparing to `PROVIDER_OFFER_MAX_AGE_MS`;
4. participant NULL and participant-attributed are disjoint in SQL, both directions — the
   in-memory `== null` proves neither;
5. the newest snapshot in a batch wins, because the older winning would make a fresh offer read
   stale.

Verified read-only against staging before the proof was written: `provider_offer_current` is a
**real table** (`relkind = 'r'`) populated by a second `identity_key`-keyed upsert inside
`upsertBatch`, not a view over history — the in-memory-vs-DB drift this gate exists to catch.

**Result at this head: PASS.** `Writable DB proof (staging only)`, run `34795218113`, job
`103826857790`, conclusion `success`. The receipt is recorded in `evidence.json` under
`runtime_proof`.

Both of the contexts `G6` requires are green on that same run and that same head: the required
`verify` job (`103828986897`, `success`) and the staging proof above. `verify` is also the
reason the two moved together — it ends at `test:live-db`, so the empty staging `sportsbooks`
table failed both jobs at the previous head for one shared cause, and one fix turned both green.

### The first run failed, and the cause was not the one it looked like

At the previous head `d32092e5860515d87d4a14254307034e0ff6beb2` (run `34794344026`) all five tests
failed with a single error:

```
insert or update on table "provider_offer_history_p20260914" violates foreign key constraint
"provider_offer_history_provider_key_fkey"
```

The obvious reading — that `PROVIDER = 'sgo'` is not a sportsbook — is **wrong**, and recording it
matters because acting on it would have changed a correct constant. Measured read-only: production
carries `sgo` as a real `sportsbooks` row (`display_name` "SGO", `active: false`) and **all 497,365**
production `provider_offer_current` rows use it.

The actual cause is that **staging's reference seed is partial**: `sportsbooks` held **0 rows**
while `sports` (9), `market_types` (133) and `participants` (136) were populated. Because every
`provider_offer_history` partition FKs `provider_key` to `sportsbooks(id)`, *no* provider offer
could be written to staging by any value — which is why no staging suite in this repository had
ever exercised the offer write path.

The proof now seeds that one row itself in `before()`, so a fresh staging project runs it green
with no out-of-band SQL step. The row mirrors production exactly, **including `active: false`** —
`DatabaseReferenceDataRepository.getCatalog` filters `.eq('active', true)`, so it stays invisible to
the Smart Form catalog and `apps/api/src/server.test.ts`'s assertion that `sgo` is absent from that
catalog still holds. Nothing here activates SGO or reads any provider key. The client comes from
`createPrivilegedClient`, the sole exemption in `scripts/ci/privileged-db-client-guard.ts` rule 3,
which asserts target identity and therefore refuses production.

### A finding the proof surfaced: `sport_key` is not in the current-table identity key

`buildProviderOfferCurrentIdentityKey` (`packages/db/src/runtime-repositories.ts:10003-10017`)
joins `providerKey`, `providerEventId`, `providerMarketKey`, `providerParticipantId` and
`bookmakerKey`. **`sport_key` is absent**, and `provider_offer_current` is upserted
`onConflict: 'identity_key'`. So two offers differing only in sport collapse to one row and the
later write wins.

This is visible in the seeded data rather than only in the code: the NFL wrong-sport near-miss is
in `provider_offer_history` and **not** in `provider_offer_current` — it shares an identity key
with the NBA exact-scope row written after it. That is the whole of why history holds 9 rows and
current holds 7.

What this does and does not change:

- **Still proven.** Test 1 seeds only the near-misses and runs *before* any exact-scope row
  exists, so at that moment the NFL row *is* the live current row and the NBA-scoped lookup
  refuses it. The sport predicate does discriminate in SQL.
- **Not proven.** That a `sport_key` stored on a `provider_offer_current` row is durable.
- **Risk direction is fail-closed.** An overwritten `sport_key` can only make a scoped lookup
  *refuse* an offer it should have matched — which this lane already handles by recording edge
  unavailable rather than manufacturing a value. It cannot manufacture a match unless the provider
  emits one event id under two sports, which would itself be a provider data defect.
- **Recorded, not repaired here.** Adding `sport_key` to the identity key changes collision
  semantics for every offer write in production, and is outside this lane's file scope and its
  stated purpose.

### The pass was confirmed from the rows, not only from the exit code

Read-only against staging after the job concluded, so that a skipped suite could not present as a
pass:

| Measure | Before | After |
|---|---|---|
| `sportsbooks` rows | 0 | 1 |
| `provider_offer_history` rows for `utv2-1898-evt-%` | 0 | 9 |
| `provider_offer_current` rows for `utv2-1898-evt-%` | 0 | 7 |
| distinct namespaced events | 0 | 4 |

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1576
Approved PR head: pending merge
Execution SHA: 5dd5de31d1af1e77559dcab281d7b5df2cef510b
