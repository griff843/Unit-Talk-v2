# PROOF: UTV2-1907

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-15T02:21:31.129Z
Issue: UTV2-1907
Tier: T1
Lane type: runtime
Branch: claude/utv2-1907-capper-id-attribution
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1581
Head SHA: 84c356190224d9aa83e82583e4b93b39b2774e5b
result: pass

## ASSERTIONS:

- [x] Capper identity is read from the `picks.capper_id` column and is never
      invented from `pick.source` or from `metadata.capper`.
- [x] A pick with no resolved capper yields the `unattributed` sentinel, and the
      sentinel is refused rather than aggregated — it is not a synthetic capper.
- [x] Two cappers submitting through one intake channel keep separate CLV
      populations; neither inherits the other's history.
- [x] An intake channel (`source`) cannot acquire a CLV history of its own.
- [x] `computeClvTrustAdjustment` fails closed on an unattributed caller: it
      returns before reading any settlement, not after aggregating them.
- [x] Promotion reads the CLV history of the pick's capper, not of its channel,
      and a pick whose capper FK did not resolve receives no CLV adjustment.

## EVIDENCE:

Measured in the lane worktree at `84c356190224d9aa83e82583e4b93b39b2774e5b`.

```
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
(exit 0, no diagnostics)

$ pnpm exec tsx --test apps/api/src/promotion-edge-integration.test.ts
# tests 89
# pass 89
# fail 0
# duration_ms 727.470428

$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 7
Rules matched: promotion-scoring

$ pnpm verify
Green in CI on this exact head rather than locally: `pnpm verify` cannot exit 0
on a workstation, because `ci:assert-staging` refuses a target it cannot resolve
to xskgrzbteyqdufktjrjx. The authoritative receipts are the CI jobs below.
```

CI receipts, both on head `84c356190224d9aa83e82583e4b93b39b2774e5b`:

| Job | Run | Result |
|---|---|---|
| `verify` | `34920346722` / job `104227625074` | success, 3m45s |
| `Writable DB proof (staging only)` | `34920346722` / job `104226935949` | success, 3m19s |

### Mutation battery — four mutations, all caught

Each mutation was applied alone, the suite run, and the file restored. The
baseline is 89 pass / 0 fail, re-confirmed after the last revert.

| # | Mutation | Result |
|---|---|---|
| 1 | Restore `metadata.capper ?? pick.source` as the CLV match key | **86 pass / 3 fail** |
| 2 | Delete the unattributed-caller early return in `computeClvTrustAdjustment` | **88 pass / 1 fail** |
| 3 | Make `resolveCapperIdentity` fall back to `record.source` | **88 pass / 1 fail** |
| 4 | Restore `metadata.capper \|\| source` at both promotion call sites | **88 pass / 1 fail** |

Two of these controls were initially vacuous and were rewritten until they were
not, which is the part worth recording:

- Mutation 2 was invisible at first, because the per-pick sentinel skip inside
  the loop also produces `null`. The test now asserts `listRecent` was called
  **zero** times, with a real-capper control proving the counter can move.
- Mutation 4 was invisible at first, because the submission path writes *both*
  `metadata.capper` and `metadata.submittedBy`, so the old expression produced
  the identical string. The test now uses a `Proxy` over the pick repository
  that nulls `capper_id` on read — simulating the database's FK existence check
  failing while `metadata.capper` still names a capper — and the mutation goes
  red.

## Verification
- [x] `pnpm type-check`: exit 0, no diagnostics
- [x] `pnpm test`: the lane's suite, `apps/api/src/promotion-edge-integration.test.ts`, 89 pass / 0 fail
- [x] `pnpm verify`: green in CI on this head (run `34920346722`, job `104227625074`); not reproducible locally, see EVIDENCE
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS, rule `promotion-scoring`

## Runtime Verification

`Writable DB proof (staging only)` succeeded against `xskgrzbteyqdufktjrjx` on
this exact head — run `34920346722`, job `104226935949`, 3m19s. The live-DB
precondition for this lane is `deferred_to_ci`, so `G6` requires both `verify`
and that job green on the merge SHA at closeout; both are green on the branch
head now, and `post-merge-lane-close.yml` rebinds them to the merge SHA.

One coverage gap is recorded honestly rather than papered over. The
non-required check `Require live-DB proof for runtime changes` is **red**, and
it cannot be satisfied inside this lane: it demands a changed file matching
`apps/[^/]+/src/t1-proof-.*\.test\.ts$` (or a scripts path), wiring such a file
requires editing `package.json`, and this lane's `file_scope_lock` is pinned to
four `apps/api/src` files with no `package.json` among them. Shadow Parity
additionally refuses a triggered PR that edits `package.json`. The
`skip-proof-coverage` label would assert this change is "genuinely
infrastructure-only", which is false, so it is **not** applied. The coverage is
owed to a separate follow-up lane owning
`apps/api/src/t1-proof-utv2-1907-capper-attribution.test.ts` plus the
`package.json` wiring — a lane that touches no `*promotion*` file and therefore
does not trigger Shadow Parity.

`Shadow Parity Check` is also red, for an unrelated environmental reason: it
fails closed with *"No mechanically read-only production credential is
provisioned."* before performing any comparison. Provisioning that credential
is a reserved secrets decision and is not requested here.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1581
Approved PR head: pending merge
Execution SHA: 84c356190224d9aa83e82583e4b93b39b2774e5b
