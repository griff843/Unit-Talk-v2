# PROOF: UTV2-1906

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-15T03:53:53.000Z
Issue: UTV2-1906
Tier: T1
Lane type: modeling
Branch: claude/utv2-1906-parlay-ticket-contract
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1582
Head SHA: 7eee19fc8067333825be65fd68af672adc1ac491
result: pass

## ASSERTIONS:

- [x] A parlay is priced by multiplying **decimal** prices and converting back to
      American **once, at the end** — never by rounding each leg first.
- [x] A ticket whose legs are not all resolved has outcome `null`. Nothing infers a
      settled ticket from partial leg data.
- [x] A pushed leg is removed from the ticket price rather than voiding the ticket;
      the surviving legs are what `priceSettledParlay` prices.
- [x] Ticket identity is independent of leg order, and is separated by stake, by each
      leg's price, and by each leg's line.
- [x] Statistics contribute **one record per ticket**, never one per leg; a pending
      ticket contributes zero records rather than a 0-0.
- [x] Duplicate market identity across legs is a validation refusal, not a silent dedupe.
- [x] This lane claims the **contract only**. It does not claim UI, API wiring,
      persistence, or that the pipeline can currently settle a parlay.

## EVIDENCE:

Measured in the lane worktree at `7eee19fc8067333825be65fd68af672adc1ac491`.

```
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
(exit 0, no diagnostics)

$ pnpm exec tsx --test packages/contracts/src/ticket.test.ts
# tests 37
# pass 37
# fail 0
# duration_ms 364.526211

$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff

$ pnpm lint
(exit 0, no findings)

$ pnpm verify
Runs to its terminal ci:assert-staging refusal on a workstation:
  [assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
  [assert-staging] REFUSED: ... Run it through the staging-ci GitHub environment.
Every stage before it — db-client-boundary, sync-check, system-alignment,
automation-coverage, executable-wiring, env:check, lint, type-check, build,
test — passed. The authoritative receipts are the CI jobs below.
```

The test file is wired into a required root: `[executable-wiring] verdict=PASS
required_roots=verify`, `unwired=119 (baselined=119 new=0)` — this lane added no
unwired test, so `packages/contracts/src/ticket.test.ts` really does execute under
`pnpm verify` rather than being baselined away.

CI receipts, both on head `7eee19fc8067333825be65fd68af672adc1ac491`:

| Job | Run | Result |
|---|---|---|
| `verify` | `34926661153` / job `104248619989` | success |
| `Writable DB proof (staging only)` | `34926661153` / job `104246122824` | success |

### Mutation battery — six mutations, all caught

Each mutation was applied alone, the suite run, and the file restored. The baseline
is 37 pass / 0 fail, re-confirmed after the last revert. The battery was run with no
concurrent suite, because a mutation in `packages/contracts` is visible to every
other suite that imports it.

| # | Mutation | Result |
|---|---|---|
| 1 | `deriveParlayTicketIdentity` loses its `.sort()`, so leg order becomes significant | **36 pass / 1 fail** |
| 2 | `deriveParlayTicketIdentity` drops the stake, so two different stakes collide | **36 pass / 1 fail** |
| 3 | `deriveParlayTicketIdentity` drops each leg's price, so a re-priced leg collides | **36 pass / 1 fail** |
| 4 | `parlayStatContribution` reports `records: legCount` instead of 1 | **35 pass / 2 fail** |
| 5 | A pending ticket reports `records: 1` instead of contributing nothing | **36 pass / 1 fail** |
| 6 | A win prices the full ticket (`priceParlay`) rather than the survivors (`priceSettledParlay`) | **36 pass / 1 fail** |

Mutations 4 and 6 are the two that matter for statistics truth. 4 is how a parlay
silently inflates a capper's record by its own leg count; 6 is how a parlay that
pushed a leg is paid at a price the operator never had.

One earlier control had to be rewritten to stay honest rather than to pass. The
pricing test originally asserted the literal `3.6446280991735537`, which
`no-loss-of-precision` correctly refuses because a TypeScript number literal cannot
carry that many digits. The assertion is now computed — `const exact = (1 + 100 / 110) ** 2`
— and compared within `1e-12`, plus the exact American conversion `+264`. `+264`
rather than `+263` is the whole point: rounding each leg to `1.91` first produces
`+263`, so the assertion fails if the implementation ever rounds per leg.

## Verification
- [x] `pnpm type-check`: exit 0, no diagnostics
- [x] `pnpm test`: the lane's suite, `packages/contracts/src/ticket.test.ts`, 37 pass / 0 fail
- [x] `pnpm lint`: exit 0, no findings
- [x] `pnpm verify`: green in CI on this head (run `34926661153`, job `104248619989`); not reproducible locally, see EVIDENCE
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS, no rules matched

## Runtime Verification

`Writable DB proof (staging only)` succeeded against `xskgrzbteyqdufktjrjx` on this
exact head — run `34926661153`, job `104246122824`. The live-DB precondition for this lane is
`deferred_to_ci`, so `G6` requires both `verify` and that job green on the merge SHA at
closeout; both are green on the branch head now, and `post-merge-lane-close.yml` rebinds
them to the merge SHA.

**The runtime coverage gap is stated rather than papered over.** This lane adds pure
functions to `@unit-talk/contracts`, a package with no I/O, no DB and no HTTP. There is
no runtime path to exercise, because nothing yet calls these functions: the API
validation, the persistence layer and the Smart Form UI that would call them are each a
separate lane this lane's `file_scope_lock` (four files in `packages/contracts` plus
`package.json`) physically cannot carry. The staging job above proves the branch does not
break the existing database path; it does **not** prove a parlay can be submitted,
persisted, graded or settled, and this bundle makes no such claim.

## Scope and containment

- Production writes: **0**. Nothing in this diff performs I/O.
- SGO: off and untouched. The provider key was not read, tested or replaced.
- Track Only containment: unchanged and enabled. Member delivery: unchanged and disabled.
- Teasers and round robins are **not** in this lane. They are tracked as UTV2-1908 and
  UTV2-1909 with their own acceptance criteria.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1582
Approved PR head: pending merge
Execution SHA: 7eee19fc8067333825be65fd68af672adc1ac491
