# PROOF: UTV2-1907

MERGE_SHA: f61b57734a6f270ccb8a0281d8eeb47c33871499

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-15T02:21:31.129Z
Issue: UTV2-1907
Tier: T1
Lane type: runtime
Branch: claude/utv2-1907-capper-id-attribution
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1581
Head SHA: a2b70987642533486136ec3e8966b61374932bc5
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

CI receipts on the head this bundle is bound to,
`a2b70987642533486136ec3e8966b61374932bc5`:

| Job | Run | Result |
|---|---|---|
| `verify` | `34987107993` / job `104443814902` | success |
| `Writable DB proof (staging only)` | `34987107993` / job `104441931921` | success |

The same two contexts were green earlier at `84c356190224d9aa83e82583e4b93b39b2774e5b`
(run `34920346722`, jobs `104227625074` and `104226935949`), which is the head the
static measurements above were taken on. Two commits have landed since, and neither
changes the implementation this bundle asserts about:

| Commit | Files | What it is |
|---|---|---|
| `66cc39a99` | `apps/api/src/t1-proof-utv2-1907-capper-attribution.test.ts`, `package.json` | the behaviour-level staging proof required by the PM verdict on this PR, plus the only wiring point that executes it |
| `a2b709876` | `docs/05_operations/db-writer-classification.json` | the registration `scripts/ci/db-writer-inventory.ts` requires for any test importing the service-role DB bundle |

Both paths are covered by the `scope-override/v1` APPROVED comment on this PR
(2026-09-15T13:47:20Z), except `docs/05_operations/db-writer-classification.json`,
which postdates it. See "Authorization state" below.

### Behaviour-level staging proof — executed, not merely green

The PM verdict on this PR required proof that capper attribution behaves correctly
against live repositories, and forbade `skip-proof-coverage`. A green job is
consistent with a skipped suite, because the proof carries a `hasSupabaseEnv()`
gate, so the counts were read from the job log rather than from the check
conclusion. From run `34987107993`, job `104441931921`:

```
ok 1 - UTV2-1907 behaviour 1: a persisted pick with a recognized capper resolves through picks.capper_id
ok 2 - UTV2-1907 behaviour 2: an unresolved capper_id remains explicitly unattributed
ok 3 - UTV2-1907 behaviour 3: metadata.capper and pick.source cannot resurrect attribution
ok 4 - UTV2-1907 behaviours 4 and 5: CLV reads key on the persisted capper, and a second capper cannot contaminate the cohort
1..4
# tests 4
# pass 4
# fail 0
# skipped 0
# duration_ms 82680.955264
```

`# skipped 0` is the load-bearing number — the environment gate did not fire — and
`duration_ms 82680` is corroborating: a suite that skipped its four subtests could
not spend 82 seconds doing it. The four subtests are the five behaviours the PM
verdict enumerated, with 4 and 5 asserted in one test because contamination is only
observable against a second capper's cohort.

### Authorization state of the out-of-scope paths

`File scope lock` is red, and it is red on three paths rather than the two the
override names:

| Path | Covered by the override? |
|---|---|
| `apps/api/src/t1-proof-utv2-1907-capper-attribution.test.ts` | yes |
| `package.json` | yes |
| `docs/05_operations/db-writer-classification.json` | **no — added after the override was issued** |

The override is also head-pinned to `933b45d572e23544ebae1a5090cfa34824cf14a4`,
and the head has since moved to `a2b70987642533486136ec3e8966b61374932bc5`. So it
needs reissuing at the current head and widening by one path. That is a CODEOWNERS
action and is recorded here rather than worked around.

`Shadow Parity Check` is red and cannot go green on this PR by any action available
to the executor. Its first step pins root `package.json` against the base
(`assert-unmodified-vs-base`), and the workflow triggers on
`apps/api/src/**/*promotion*`, which this lane necessarily changes. Wiring a T1
live-DB proof requires root `package.json`, because `ci.yml:143` runs the root
`test:t1-proof:live` script and that script is a fixed `&&` chain of explicitly
named files. The PM verdict required the proof; the guard refuses the wiring. Both
are correct as written and they are mutually exclusive on one PR — the check is
non-required, and the conflict is recorded rather than evaded. No
`skip-proof-coverage` label is applied.

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

Merge SHA: f61b57734a6f270ccb8a0281d8eeb47c33871499
PR: https://github.com/griff843/Unit-Talk-v2/pull/1581
Approved PR head: pending merge
Execution SHA: 84c356190224d9aa83e82583e4b93b39b2774e5b
