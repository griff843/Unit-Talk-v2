# PROOF: UTV2-1815

MERGE_SHA: pending merge

Lane: claude / `claude/utv2-1815-null-stake-computation-truth`
Tier: T1 (modeling lane — settlement, grading and attribution computation)
Proof Artifact: docs/06_status/proof/UTV2-1815/verification.md

## Verification

ASSERTIONS:

- [x] **AC1 — no path emits a profit/loss or attribution figure computed from an assumed stake.**
      All three call sites route through one contract; each refuses rather than substituting a
      number. Proven by mutations M1–M5.
- [x] **AC2 — an unknown stake is distinguishable from an observed one.** `resolveStakeUnits`
      returns `canonical` / `assumed_flat` / `historical_unknown`, and every consumer records which
      one it saw. A record carrying an assumed flat stake can no longer be mistaken for one carrying
      a real stake.
- [x] **AC3 — a NaN stake is caught, not just a NULL one.** The shipped `?? 1` idiom fires only on
      null/undefined, so NaN reached the arithmetic untouched. Both fixtures now land on the same
      refusal, in all three paths.
- [x] **AC4 — every control is proven by making it fail on the condition it names.** Five mutations,
      each reverting exactly one control, each caught by tests naming that condition and only those.
      Full receipts under "Mutation proof".
- [x] **AC5 — scope is exactly the three authorized source files plus their co-located tests.** No
      backfill, no schema or constraint change, no production mutation, no Discord rendering change,
      no unpark.

## Root cause

`stakeUnits ?? 1` in three places. Two distinct defects live inside that one idiom:

1. **It fabricates.** A pick with no recorded stake produced a concrete profit/loss number. Nothing
   downstream carried a marker saying the stake was assumed, so the figure was byte-identical to one
   computed against a real 1-unit stake. This is the failure the lane is named for: a value a reader
   cannot distinguish from an observed one.
2. **It under-guards.** `??` fires only on `null` and `undefined`. A `NaN` stake — the realistic
   shape of a corrupted numeric column — passed straight through and poisoned the arithmetic. In
   attribution the record still claimed `high` confidence while every component was `NaN`.

`apps/api/src/settlement-service.ts` had already been fixed for the first defect and refused
correctly, but with its own private copy of the rule. Three definitions of "unusable stake" in three
files is how the other two paths drifted apart from it in the first place.

## Fix

One contract, in `@unit-talk/domain`, consumed by all three:

```ts
export type StakeUnitsStatus = 'canonical' | 'assumed_flat' | 'historical_unknown';

export function resolveStakeUnits(value: number | null | undefined): StakeUnitsResolution {
  if (value === undefined) {
    return { status: 'assumed_flat', stake_units: ASSUMED_FLAT_STAKE_UNITS };
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return { status: 'historical_unknown', stake_units: null };
  }
  return { status: 'canonical', stake_units: value };
}
```

`assumed_flat` is deliberately a distinct third state rather than being folded into either
neighbour. `AttributionInput.stake_units` is a genuinely optional field documented as defaulting to
1, so omitting it is a legitimate flat-bet API — but the resulting record must still say that its
stake was assumed. Callers that read a stake from a database column, where the column always exists,
fold `undefined` to `null` on the way in, so a missing value there is an unknown stake and never a
flat-bet default.

Per path:

- **attribution** — `validateAttributionInput` now rejects an unusable stake with
  `ATTRIBUTION_INVALID_STAKE_UNITS`; `attributePick` validates first, so an unusable stake yields a
  refusal, never a record. Produced records carry `stake_units_status`.
- **grading** — `computeProfitLossUnits` returns `number | null`, and
  `postSettlementRecapIfPossible` refuses to publish when the stake is not canonical.
- **settlement** — behaviour unchanged; the two local helpers now call `resolveStakeUnits` instead
  of duplicating the rule.

### Why grading refuses to publish rather than rendering "unknown"

`RecapEmbedInput.profitLossUnits` is declared `profitLossUnits: number` — non-nullable — in
`packages/domain/src/recap-embed.ts`, which is **outside this lane's authorized scope**. There is no
in-scope way to render an unknown stake honestly. The options were: publish a fabricated number,
widen scope into the renderer, or skip the post and log why. Skipping is the only one that is both
honest and inside scope. The recap is a convenience surface; the settlement row it describes is
still written, still tagged `historical_unknown`, and still omits `profitLossUnits`. Rendering an
unknown stake is a rendering change and belongs to the renderer's own lane.

### Why `stake_units_status` is optional on `AttributionRecord`

Declaring it required breaks a pre-existing record literal in
`packages/domain/src/edge-decay/edge-decay-detector.test.ts`, a file outside this lane's authorized
scope. It is therefore declared optional, and reads are fail-closed by construction:
`status === 'canonical'` is the only assertion that a real stake was observed, and it is `false` for
`undefined`. `attributePick` always populates the field, so in practice it is absent only on
literals written before it existed. This is recorded as a limitation below rather than presented as
a design preference.

## Note on the anchor

The anchor is the automated `chore(lanes)` commit that bound the lane manifest to PR #1479, which
landed on the branch after the implementation commit. It changes
`docs/06_status/lanes/UTV2-1815.json` only — no source file — so the tree under test is byte-identical
to the implementation commit's in every file that this bundle makes a claim about. Every receipt
below was **re-executed against this anchor** after that commit landed, rather than carried over from
the earlier run.

## Receipt — full workstation verification at the anchor

```text
$ pnpm verify
# tests 5549
# pass 5549
# fail 0
# skipped 0
exit=1
```

Zero `not ok` lines across the entire run (`grep -c '^not ok'` = 0). 5538 pre-existing + 11 new.
`env:check`, `lint`, `pnpm type-check`, `build`, the whole `pnpm test` tree, `verify:static` and
`verify:commands` are all exit 0 within this run. **The command still exited 1 and is recorded as a
refusal, not a pass.** The non-zero exit comes from the final `test:live-db` step and nothing else:

```text
> tsx scripts/ci/assert-staging-target.ts
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub
environment with CI_SUPABASE_* credentials.
```

A workstation cannot produce the writable-staging receipt by design. The authoritative T1
verification is the hosted run bound below.

## Receipt — the three lane suites at the anchor

```text
$ pnpm exec tsx --test packages/domain/src/attribution/attribution-engine.test.ts \
                       apps/api/src/grading-service.test.ts \
                       apps/api/src/settlement-service.test.ts
# tests 120
# pass 120
# fail 0
```

109 pre-existing, unchanged + 11 new (6 attribution, 3 grading, 2 settlement) = 120.

## Mutation proof

Each mutation was applied to the working tree at the anchor, the three lane suites run, and the file
restored from a byte-exact backup; the 120/120 baseline was reconfirmed after every one.

### M1 — `resolveStakeUnits` silently assumes a flat 1 instead of refusing

This is the shipped defect, expressed once in the shared contract.

```text
not ok 59 - UTV2-1815 grading refuses to publish a recap for a NULL stake
not ok 60 - UTV2-1815 grading refuses to publish a recap for a NaN stake
not ok 64 - recordPickSettlement classifies historical unknown stake rows and omits fake profit/loss
not ok 87 - UTV2-1815 recordPickSettlement refuses a NaN stake the same way it refuses NULL
not ok 112 - UTV2-1815 resolveStakeUnits separates observed, assumed and unknown stakes
not ok 113 - UTV2-1815 validateAttributionInput rejects a NULL stake
not ok 114 - UTV2-1815 validateAttributionInput rejects a NaN stake
not ok 115 - UTV2-1815 attributePick refuses a NULL stake instead of assuming 1
not ok 116 - UTV2-1815 attributePick refuses a NaN stake and never emits NaN components
# tests 120
# pass 111
# fail 9
```

Nine failures across all three paths. This is the point of centralizing the rule: one mutation to
one function is visible everywhere it is relied on.

### M2 — delete the grading recap refusal (publish with an assumed stake)

```text
not ok 59 - UTV2-1815 grading refuses to publish a recap for a NULL stake
not ok 60 - UTV2-1815 grading refuses to publish a recap for a NaN stake
# tests 120
# pass 118
# fail 2
```

Isolated to grading. The negative control — "grading still publishes a recap for a real stake" —
passes under this mutation, which is correct: the mutation makes the path publish *more*, not less,
so only the refusals can catch it.

### M3 — settlement's stake-integrity payload always reports `canonical`

```text
not ok 64 - recordPickSettlement classifies historical unknown stake rows and omits fake profit/loss
not ok 87 - UTV2-1815 recordPickSettlement refuses a NaN stake the same way it refuses NULL
# tests 120
# pass 118
# fail 2
```

Isolated to settlement.

### M4 — drop the attribution stake validation, keep the resolver

```text
not ok 113 - UTV2-1815 validateAttributionInput rejects a NULL stake
not ok 114 - UTV2-1815 validateAttributionInput rejects a NaN stake
not ok 115 - UTV2-1815 attributePick refuses a NULL stake instead of assuming 1
not ok 116 - UTV2-1815 attributePick refuses a NaN stake and never emits NaN components
# tests 120
# pass 116
# fail 4
```

Isolated to attribution. Note that `resolveStakeUnits` is untouched by this mutation and its own
spec (112) correctly still passes — having the contract is not the same as enforcing it, and the two
are tested separately.

### M5 — settlement's `computeProfitLossUnits` falls back to a stake of 1

```text
not ok 64 - recordPickSettlement classifies historical unknown stake rows and omits fake profit/loss
not ok 87 - UTV2-1815 recordPickSettlement refuses a NaN stake the same way it refuses NULL
# tests 120
# pass 118
# fail 2
```

M3 and M5 mutate different halves of the settlement path — the status tag and the arithmetic — and
both are caught. The failing assertions differ: M3 trips `stakeUnitsStatus`, M5 trips
`'profitLossUnits' in payload`.

### Baseline after every restore

```text
# tests 120
# pass 120
# fail 0
```

`git status --porcelain` reported a file modified only while its mutation was applied, and clean
against the committed anchor afterwards.

## EVIDENCE:

### `pnpm type-check`

```text
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
```

Exit 0, no diagnostics.

### `pnpm test`

Runs inside `pnpm verify` above: 5549 tests, 5549 pass, 0 fail, 0 skipped, 0 `not ok`.

### `scripts/ci/r-level-check.ts`

```text
$ pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1815
Verdict: PASS
Changed files: 9
Rules matched: settlement-grading
Advisory (PM-gated) artifacts missing:
  - r4-fault-report [PM-gated]
```

### `pnpm ops:sync-check`

```text
[sync-check] OK (per-issue): branch "claude/utv2-1815-null-stake-computation-truth" <-> .ops/sync/UTV2-1815.yml
```

### Hosted verification at this exact anchor

Anchor: `7b9dcde2a19c23345a1a334590d07fb15be27d7a`. Bound by run and job id in `evidence.json`
under `hosted_verification`. The staging job is where the live-DB proof this lane cannot run locally
actually executes, against `xskgrzbteyqdufktjrjx`.

### The staging receipt, and why it is bound to a head that is not the tip

Run `33966879903`, job `101308512813` ("Writable DB proof (staging only)"), completed success at
head `32bb89db896990827b3e583faf13f3ce6f352ea5`. That is a proof-only commit in this branch's
proof-only range: `git diff --name-only 7b9dcde2a..HEAD` lists nothing outside
`docs/06_status/proof/UTV2-1815/`, so the tree that run executed is the anchor tree for every file
that can affect behaviour. The receipt is reported against the run head and attributed to the anchor
on the strength of that diff — not on an assumption that they are interchangeable.

The suite's own numbers, quoted from that run's "Run the T1 live proof suites against staging" step:

```text
1..3
# tests 3
# pass 3
# fail 0
# skipped 0
```

`# skipped 0` is the load-bearing figure, and it is the number a reader should check first. This
suite skips itself when staging credentials are absent, and a skipped test still reports `ok`.
Measured on this workstation at this head, with no service-role key present:

```text
$ UNIT_TALK_APP_ENV=local pnpm exec tsx --test apps/api/src/t1-proof-utv2-1815-stake-units.test.ts
ok 3 - UTV2-1815 live DB: a real stake still persists a real profit/loss (negative control) # SKIP SUPABASE_SERVICE_ROLE_KEY not configured — skipping live DB proof
1..3
# tests 3
# pass 0
# fail 0
# skipped 3
exit 0
```

Three `ok` lines and a zero exit code, having touched no database at all. `exit 0` is therefore
satisfied by both runs and distinguishes nothing, which is why the CI receipt is quoted with its
counts rather than with a pass/fail verdict. On this runner `# pass 0 / # skipped 3`; in CI
`# pass 3 / # skipped 0`. Either half of that pair separates the two, and the bundle quotes both so
a reader does not have to take the distinction on trust.

## Three non-required checks are red on this PR, each for a different reason

None of the three is a required check (branch protection requires exactly `verify`,
`Executor Result Validation`, `Merge Gate`, `P0 Protocol`), and `Merge Gate` does not cite any of
them — it reports only the two T1 approval artifacts. They are recorded here with their measured
causes rather than left for a reviewer to rediscover or to read as unexplained noise.

**1. `Require live-DB proof for runtime changes` — the guard's substance is met; its detection
cannot see it.** The guard fires because the diff touches `apps/api/src/settlement-service.ts`, a
sensitive runtime path, and contains no file matching its proof patterns. That is accurate about the
diff and misleading about the state of the work. The live-DB proof for exactly this change —
`apps/api/src/t1-proof-utv2-1815-stake-units.test.ts` — exists, is wired into
`test:t1-proof:live`, and executed against staging at this branch's anchor in the run quoted above,
3 passed / 0 skipped. It is not in this diff because PM directed that the prerequisite be landed
independently first, and it merged in #1504 (`775f4ac6`). The guard compares
`base...head`, so a proof that landed one PR earlier is invisible to it. This is a mechanism
narrower than the rule it encodes, and the rule itself is satisfied.

The guard has an escape hatch, `skip-proof-coverage`, and it is deliberately **not** requested: its
own documentation reserves it for "pure infrastructure PRs that do not touch runtime semantics", and
this PR does touch runtime semantics. Claiming otherwise to clear a red would be false. The
alternative that would satisfy the guard mechanically is to change the proof test file in this PR,
which is outside this lane's `file_scope_lock` and would need a `scope-override/v1`.

**2. `Check issue references` — one commit message cites the contract it is obeying.** The check
requires every issue reference in the PR to equal the branch issue, and reports
`found UTV2-1783, UTV2-1815`. The single reference is in commit `32bb89db8`'s message, which names
UTV2-1783 as the ratification under which `MERGE_SHA` must read `pending merge` before a merge
exists. It is a citation of the governing contract, not a cross-issue code dependency. It is left
uncorrected on purpose: rewriting that message changes its SHA, and `32bb89db` is the head the
staging receipt above is bound to. Trading a verifiable receipt for a green non-required check would
make the bundle weaker, not stronger.

**3. `Shadow Parity Check` — no credential exists for it to use.** It reports
`No mechanically read-only production credential is provisioned`, and refuses service-role
credentials by design. Provisioning one is a reserved action (secrets). This is an infrastructure
absence, not a parity finding: the check did not compare anything and reached no conclusion about
this change.

## Scope boundary

`git diff --stat` against the lane's own base commit, confined to the three authorized source files
and their co-located tests:

```text
 apps/api/src/grading-service.test.ts                    | 106 +++++++++++++-
 apps/api/src/grading-service.ts                         |  61 ++++++---
 apps/api/src/settlement-service.test.ts                 |  57 +++++++++
 apps/api/src/settlement-service.ts                      |  16 ++-
 packages/domain/src/attribution/attribution-engine.test.ts |  76 ++++++++++++
 packages/domain/src/attribution/attribution-engine.ts      |  93 +++++++++++++-
 6 files changed, 389 insertions(+), 20 deletions(-)
```

No backfill. No schema or constraint change. No production mutation. No Discord rendering change.
No unpark.

## Known limitations

- **The recap now silently does not appear for an unknown-stake pick.** That is a deliberate
  refusal, and it is logged, but a reader of the Discord channel sees an absence rather than an
  explanation. Rendering "stake unknown" requires changing `RecapEmbedInput.profitLossUnits` to be
  nullable, which is outside this lane's scope. This is a known, bounded regression in surface
  coverage, chosen over publishing a fabricated number.
- **`stake_units_status` is optional on `AttributionRecord`**, for the out-of-scope-file reason given
  above. Reads are fail-closed (`undefined` is not `canonical`), but the type system does not force
  a constructor of a record literal to supply it.
- **Nothing here repairs existing rows.** Settlement rows already written against a NULL stake keep
  whatever they were written with; this lane changes only what is computed from now on. Backfill was
  explicitly excluded from scope.
- **The grading tests stub `globalThis.fetch` and hand-roll the repository bundle.** They prove the
  refusal decision and that no HTTP post is issued; they do not exercise the real Discord transport
  or the real repositories, and no test in this bundle does.
- **`resolveStakeUnits` rejects a stake of exactly 0 as `historical_unknown`.** A deliberate
  zero-unit "paper" pick, if such a thing is ever introduced, would be refused rather than computed
  at zero. No such concept exists in the codebase today.
