# PROOF: WORK-2026110705

MERGE_SHA: pending merge

> Scaffolded by `ops:lane-start`. Nothing below has been run. Record each command
> actually executed and its real result before review. `post-merge-lane-close.yml`
> binds the merge SHA; never write one here by hand.

Issue: WORK-2026110705
Tier: T1
result: not_run

## ASSERTIONS:

- [x] `listRecentOffers` pages with `.range()` plus an `id` tie-break, so it returns up to the caller cap despite PostgREST's 1,000-row server clamp (db test proof 2b).
- [x] A fresh current-offer read that fills a page is flagged `truncated` and never presented as complete (db test proof 5).
- [x] Stale canonical data yields an explicit stale state, no offers, and no quarantine fallback; repository read errors surface instead of an empty list (db tests proofs 3, 4).
- [x] Smart Form `describeOffersState` labels stale, truncated and empty states distinctly, and BetForm routes an empty list through it before "No live offers" (smart-form tests 132-134).

## EVIDENCE:

Command: `pnpm --filter @unit-talk/db exec tsx --test src/provider-offer-readers.test.ts`

```
ok 1 - WORK-2026110705 proof 1: current-offer read returns the canonical current projection and never a quarantine row
ok 2 - WORK-2026110705 proof 2: historical opening/closing reads keep history semantics (provider_offer_history_compact), not the quarantine view
ok 3 - WORK-2026110705 proof 2b: listRecentOffers reads provider_offer_history and returns up to the caller cap despite the 1000-row server clamp
ok 4 - WORK-2026110705 proof 5: a current-offer read that fills a PostgREST page is flagged truncated, not presented as complete
ok 5 - WORK-2026110705 proof 3: stale canonical data returns an explicit stale state, no offers, and no quarantine fallback
ok 6 - WORK-2026110705 proof 4: a repository read error is surfaced, never a silent empty list
# tests 6
# pass 6
# fail 0
```

Command: `pnpm --filter @unit-talk/smart-form test`

```
ok 132 - WORK-2026110705: stale offers state surfaces the last-observed timestamp, distinct from the generic empty message
ok 133 - WORK-2026110705: truncated fresh offers are flagged partial; complete fresh and missing state are silent
ok 134 - WORK-2026110705: BetForm routes an empty list through the offers state before falling back to "No live offers"
# tests 230
# suites 23
# pass 230
# fail 0
```

Command: `pnpm --filter @unit-talk/db type-check` and `pnpm --filter @unit-talk/smart-form type-check`

```
exit 0 (both)
```

## Verification

Run on code head 5040cddd160009ea4d8845a841765ac6ea77a42d (merge of main into the fix commit a927b25f5); the db tests, smart-form tests and both type-checks above all exited 0. Model routing evidence is the reconciled sidecar written by `ops:lane-manifest write-reconciled-sidecar` (unverified-external-session, approved on PR comment 6731792481). Staging Writable DB proof and `verify` run in CI on the final head.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: 5040cddd160009ea4d8845a841765ac6ea77a42d
