# PROOF: WORK-2026112101

MERGE_SHA: pending merge

Issue: WORK-2026112101
Tier: T1
Verified source SHA: 61db9ff7bfc47722e3753c023e5a0814e2de107d
PR: https://github.com/griff843/Unit-Talk-v2/pull/1850

result: review candidate. Static, regression, mutation and staging DB proof complete on the verified source SHA; lane binding, Griff `t1-approved` and exact-head `pm-verdict/v1` pending.

## Verification

Scope: `packages/domain/src/discord-presentation.ts`, `packages/domain/src/discord-presentation.test.ts`
and the work order `.ops/work/WORK-2026112101.md`. Pure domain string formatting only.

ASSERTIONS:
- [x] The `pick-posted` title no longer renders the line as odds (` @ +27.5`). The odds marker ` @ ` is removed from the title.
- [x] When the selection text already states the line (including trailing zeros such as `27.50`), the title adds nothing.
- [x] When the selection omits the line, the title appends it: spreads and handicaps (including `run_line`, `run-line`, `puck_line` keys) carry a sign, `+` for positive; totals and props show the magnitude.
- [x] Moneyline picks with no line are unchanged.
- [x] The new title tests fail on unmodified `main` (18 pass, 2 fail) and pass at head (20/20).
- [x] Existing consumers of `buildPickPresentation` pass unchanged: official-picks-embed 11/11, delivery-adapters 29/29, discord-design-system 15/15.
- [x] Four mutations (stated line ignored, spread sign dropped, ` @ ` restored, underscore run-line key) each fail a test; code restored after each.
- [x] Exact-head CI on the verified source SHA: `verify` success and `Writable DB proof (staging only)` success.
- [x] No change to targets, kill switches, outbox, receipts, audience, entitlement, delivery timing or Track Only gating; no schema change; no production write.

## EVIDENCE:

Regression (`regression/`):

```
main  packages/domain/src/discord-presentation.test.ts   # pass 18  # fail 2
head  packages/domain/src/discord-presentation.test.ts   # pass 20  # fail 0
head  official-picks-embed.test.ts                       # pass 11  # fail 0
head  apps/worker/src/delivery-adapters.test.ts          # pass 29  # fail 0
head  apps/discord-bot/src/discord-design-system.test.ts # pass 15  # fail 0
```

Mutations (`mutations/`):

```
a-ignore-stated-line   discord-presentation.test.ts # fail 1
b-drop-spread-sign     discord-presentation.test.ts # fail 1
c-restore-at-marker    discord-presentation.test.ts # fail 1
d-underscore-run-line  discord-presentation.test.ts # fail 1
```

Rendered titles (`rendered-titles/`):

```
before (main)                                   after (head)
Pick Posted · LeBron James Over 27.5 @ +27.5    Pick Posted · LeBron James Over 27.5
Pick Posted · Over @ +27.5                      Pick Posted · Over 27.5
Pick Posted · Lakers -3.5 @ -3.5                Pick Posted · Lakers -3.5
Pick Posted · Celtics @ +3.5                    Pick Posted · Celtics +3.5
Pick Posted · Yankees @ -1.5                    Pick Posted · Yankees -1.5
Pick Posted · Under @ +8.5                      Pick Posted · Under 8.5
Pick Posted · Lakers ML                         Pick Posted · Lakers ML
```

Exact-head CI on 61db9ff7bfc47722e3753c023e5a0814e2de107d:

```
verify                                 success
Writable DB proof (staging only)       success
  run https://github.com/griff843/Unit-Talk-v2/actions/runs/44951807571
  job https://github.com/griff843/Unit-Talk-v2/actions/runs/44951807571/job/136991279214
  staging suites: 9/9, 11/11, 20/20, 5/5, 8/8, 2/2 pass
  seed: distribution_outbox reset 1 row deleted; sports 9, cappers 1, market_families 6,
        selection_types 3, market_types 133 rows upserted (staging only)
```

This change is pure domain formatting; it writes no rows. The staging job proves the branch runs
the full writable staging suite green, not a new write path.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1850

Bound after merge by `post-merge-lane-close.yml`.
