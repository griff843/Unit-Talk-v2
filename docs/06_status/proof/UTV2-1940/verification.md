# PROOF: UTV2-1940

MERGE_SHA: 6547e2e6f9aaa68e80e49a16eaac76bdf097ec88

Generated at: 2026-09-19T00:41:00.000Z
Issue: UTV2-1940
Tier: T2
Lane type: delivery-ui
Branch: claude/utv2-1940-command-center-settlement-state-truth
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1613
Head SHA: 6547e2e6f9aaa68e80e49a16eaac76bdf097ec88
result: pass

## ASSERTIONS:

- [x] The pick detail page derives settlement state from settlement evidence, not from a
      literal. `isAlreadySettled={false}` is gone.
- [x] `/settlement` and `/picks/[id]` cannot disagree: both call the single predicate
      `isPickAlreadySettled()`, and neither re-derives it inline.
- [x] A pick whose lifecycle status is `validated` but which carries a settlement record is
      reported as settled — the Track Only case, which is 5 of the 6 settled governed picks
      in production.
- [x] The predicate fails closed on an unreadable settlement count: it reports "not settled"
      rather than inventing a settlement.
- [x] No change to delivery authority, containment, the kill switch, grading, settlement
      semantics, or `getAllowedActions`' lifecycle mapping. The diff touches four files, all
      under `apps/command-center/`.
- [x] Mutation drill A: reverting the predicate to status-only fails exactly the three
      evidence-based assertions and leaves the status-only assertions green.
- [x] Mutation drill B: restoring `isAlreadySettled={false}` fails exactly the drift guard.

## EVIDENCE:

Measured on `6547e2e6f9aaa68e80e49a16eaac76bdf097ec88` in the lane worktree.

```
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
exit=0

$ pnpm lint
> eslint . --cache --cache-location .cache/eslint/
exit=0

$ pnpm test
tests=6572 pass=6572 fail=0   (aggregated over 104 test files)
exit=0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 7
Rules matched: operator-ui
exit=0

$ pnpm verify
Runs env:check + lint + type-check + build + test. Its ci:assert-staging step
cannot exit 0 from this containment-isolated checkout (local.env pins
SUPABASE_URL=http://127.0.0.1:1). Its four constituent gates are measured
individually above; `verify` itself is executed by CI on this PR.
```

Mutation drill A — revert `isPickAlreadySettled` to lifecycle status only
(`return false` in place of the settlement-count branch), then restore:

```
$ pnpm exec tsx --test apps/command-center/src/lib/settlement-state.test.ts   # MUTATED
not ok 2 - a validated pick carrying a settlement record is settled — the Track Only case
not ok 5 - settlement evidence outweighs an unrecognised lifecycle status
not ok 7 - a missing lifecycle status is not itself evidence either way
# pass 4
# fail 3

$ pnpm exec tsx --test apps/command-center/src/lib/settlement-state.test.ts   # RESTORED
# pass 7
# fail 0
```

The four assertions that stayed green under drill A are exactly the ones a status-only
predicate already satisfied. That is the point of recording it this way: the new tests are
sensitive to the change, and the behaviour the change preserves is demonstrably not what is
carrying them.

Mutation drill B — restore the original defect on the page itself:

```
$ sed -i 's/isAlreadySettled={alreadySettled}/isAlreadySettled={false}/' apps/command-center/src/app/picks/\[id\]/page.tsx
$ pnpm exec tsx --test apps/command-center/src/lib/settlement-state.test.ts   # MUTATED
not ok 8 - no operator surface decides settlement state for itself
# pass 7
# fail 1

$ pnpm exec tsx --test apps/command-center/src/lib/settlement-state.test.ts   # RESTORED
# pass 8
# fail 0
```

Drill B is what makes the guard non-vacuous: it fails on the exact literal this lane removed,
and on nothing else.

### Production measurement — the defect, measured rather than argued

Read-only against production `zfzdnfwdarxucxtaojxm` at 2026-09-19T00:20Z. Zero rows written,
updated or deleted; no containment setting, kill switch, delivery target or deploy touched.

```sql
select p.status, count(*) from picks p
where p.metadata ? 'distributionMode'
  and exists (select 1 from settlement_records s
              where s.pick_id = p.id and s.corrects_id is null)
group by p.status;
```

| `picks.status` | picks carrying a settlement row |
|---|---|
| **validated** | **5** |
| settled | 1 |

The 5 are the Track Only picks. Each carries a populated `picks_current_state.settlement_result`
(3 win, 2 loss) and a real settlement record, and each rendered "Settle Pick" with the
correction warning suppressed before this change.

The cause is structural rather than a settlement bug, and the fix therefore belongs in the UI
predicate rather than in the data: `settlement-service.ts:155` gates the lifecycle transition
on `pick.status === 'posted' || 'settled'`, and a Track Only pick is never posted. Advancing
`picks.status` for those picks is deliberately **not** in scope — the settlement plane is
already the authority, and changing the lifecycle contract is a separate decision.

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm lint`: exit 0
- [x] `pnpm test`: exit 0 — 6572 tests, 6572 pass, 0 fail
- [ ] `pnpm verify`: not executable from this containment-isolated checkout; executed by CI on PR #1613 (see EVIDENCE)
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: exit 0, Verdict PASS

## Runtime Verification

This lane is T2 and changes only operator-facing rendering in `apps/command-center`. It adds no
write path, no query against a new table, and no runtime behaviour that a live database could
exhibit — the predicate is pure and the two call sites pass it data they already fetch.

The runtime fact the lane depends on is therefore recorded as a **production measurement**
above rather than as a live-DB test: the 5-vs-1 split is read from production and is what
establishes that the defect was real and general rather than hypothetical. No live-DB proof is
claimed, and `result: pass` refers to the static gates and the two mutation drills, all of
which were executed rather than asserted.

## Merge SHA Binding

Merge SHA: 6547e2e6f9aaa68e80e49a16eaac76bdf097ec88
PR: https://github.com/griff843/Unit-Talk-v2/pull/1613
Approved PR head: 6547e2e6f9aaa68e80e49a16eaac76bdf097ec88
Execution SHA: 6547e2e6f9aaa68e80e49a16eaac76bdf097ec88
