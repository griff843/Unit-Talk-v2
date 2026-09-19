# PROOF: UTV2-1939

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder value; the Execution SHA row
> below carries the verified implementation identity. `post-merge-lane-close.yml` rebinds
> merge authority only after GitHub supplies the merged-PR attestation.

Issue: UTV2-1939
Tier: T2
Lane type: delivery-ui
Branch: claude/utv2-1939-command-center-human-capper-lifecycle
PR URL: PR_URL_ROW
Head SHA: 6c33db296c3c6fdbf199866eb1f2956024a9a0fe

## ASSERTIONS:

- [x] A settled human-capper pick whose recap was **suppressed** is never rendered as
      unqualified success. `describeRecapOutcome` returns `suppressed`, and
      `SettlementForm` renders it in a separate amber panel naming the reason.
- [x] An **absent** `humanCapperRecap` is reported as `not-applicable`, not as a posted
      recap and not as a suppressed one. A Track Only settlement makes no recap claim.
- [x] `settlePick` carries `humanCapperRecap` from `body.data` to the caller. Before this
      change it read only `settlementRecordId` and discarded the recap outcome.
- [x] An **unreadable** kill switch predicts `unknown`, never `will-post`.
      `predictRecapDelivery` fails closed on `officialPicksKilled === null`, and
      `settlement/page.tsx` wraps the read in try/catch so a read failure degrades to
      `null` rather than to optimism.
- [x] The `deliveredAwaitingSettlement` worklist identifies picks **positively** — by the
      server-authored `metadata.deliveryAuthorization.decision = 'authorized'` record and
      `status = 'posted'` — never by the absence of something, and never from a
      client-supplied field.
- [x] Nothing in this diff writes a kill switch, enables a delivery target, changes a
      containment setting, or can cause a Discord post. The kill switch is read only.
- [x] Mutation drill: reverting `describeRecapOutcome`'s `posted` branch to the pre-fix
      behaviour fails exactly the suppression-sensitive tests and leaves the rest green.

## EVIDENCE:

Measured in the lane worktree at the Execution SHA below.

```
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
exit=0

$ pnpm lint
> eslint . --cache --cache-location .cache/eslint/
exit=0

$ pnpm test
tests=6564 pass=6564 fail=0   (aggregated over 104 test files)
exit=0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none) - no R-level artifacts required for this diff
exit=0

$ pnpm verify
Runs env:check + lint + type-check + build + test. Its ci:assert-staging step cannot
exit 0 from this containment-isolated checkout (local.env pins
SUPABASE_URL=http://127.0.0.1:1). Its constituent gates are measured individually
above; `verify` itself is executed by CI on this PR.
```

### Mutation drill — the control is sensitive to the defect it names

Run by replacing `if (recap.posted)` in `describeRecapOutcome` with `if (true)`, which is
the pre-UTV2-1939 behaviour: every settlement reported as success regardless of whether
members were told. Restored immediately afterwards.

```
$ pnpm exec tsx --test src/lib/human-capper-recap.test.ts      # MUTATED
not ok 3 - a kill-switch-suppressed recap is NOT reported as success
not ok 4 - an unrecognised refusal reason is passed through verbatim, not flattened
not ok 5 - a refusal with no reason still reports suppression rather than success
# pass 4
# fail 3

$ pnpm exec tsx --test src/lib/human-capper-recap.test.ts      # RESTORED
# pass 7
# fail 0
```

Tests 1, 2, 6 and 7 stayed green under the mutation. That is the point of recording the
drill this way: the three suppression-sensitive tests fail on exactly the defect, and the
four that cover other behaviour are demonstrably not what is carrying them.

### Production measurement — the worklist predicate, measured rather than argued

Read-only against production `zfzdnfwdarxucxtaojxm` on 2026-09-18. Zero rows written,
updated or deleted; no kill switch, delivery target, containment setting or deploy touched.

The predicate now shipped in `results-ops.ts` —

```sql
select id from picks_current_state
where status = 'posted'
  and settlement_recorded_at is null
  and metadata->'deliveryAuthorization'->>'decision' = 'authorized'
```

— returns **exactly one row**: `ed0ed43c-c3f3-446b-8114-9ced1ea2d82f`, the pick delivered
to Discord earlier the same day (`distribution_outbox` `sent`, receipt
`71fccaa7-2953-4496-b820-cd8ef57f1dc2`, message `1550652082896375962`). Nothing else
matches — not the 6 settled governed picks, not the ~93% of `picks` that are CI fixtures.

That single row is the defect this lane closes. Before this change that pick was reachable
from Command Center only by hand-constructing `/settlement?pickId=<uuid>` from a database
read, because the existing "Stuck in Posted" list applies a 24h age threshold and would not
have surfaced it until the following day — after the game had finished and the settlement
was due.

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm lint`: exit 0
- [x] `pnpm test`: exit 0 — 6564 tests, 6564 pass, 0 fail (104 files)
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: exit 0, Verdict PASS
- [ ] `pnpm verify`: not executable from this containment-isolated checkout; executed by CI on the PR (see EVIDENCE)

## Merge SHA Binding

Merge SHA: pending merge
PR: PR_URL_ROW
Approved PR head: pending merge
Execution SHA: 6c33db296c3c6fdbf199866eb1f2956024a9a0fe
