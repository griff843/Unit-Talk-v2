# PROOF: UTV2-1886

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-11T12:22:15.372Z
Issue: UTV2-1886
Tier: T1
Lane type: runtime
Branch: claude/utv2-1886-grading-settlement-prefetch
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1565
Head SHA: 86e46745a7368855f053814c33076b55634311aa
result: pass

## ASSERTIONS:

- [x] `runGradingPass` performs exactly one settlement read for the whole pick population, not one per pick.
- [x] The batched read is complete: every chunk is paginated to exhaustion, so no pick is silently omitted.
- [x] An omitted pick is the fail-open direction (it reads as "no settlement exists"), so a failed prefetch rejects the pass rather than degrading to an empty map.
- [x] `findLatestForPicks` and `findLatestForPick` agree on which settlement is current, including on a `created_at` tie, because both reduce through `compareSettlementRecordsDescending`.
- [x] The chunk size is a BYTE bound, not a row bound: it is derived from a measured URL budget rather than chosen, and three tests build the real PostgREST query and measure the URL it emits.
- [x] The three live-PostgREST assumptions the batched read depends on — `.in()` completeness, `.range()` page completeness under the two-key ordering, and `.order()` agreeing with the comparator — are proven against the real `DatabaseSettlementRepository`, not against an in-memory stand-in.
- [x] The URL measurement is taken through `createPrivilegedClient`, the sole exemption `scripts/ci/privileged-db-client-guard.ts` rule 3 allows, so measuring the query introduces no path from a `pnpm test` entrypoint to a raw driver constructor.
- [x] Each of the four claims above is mutation-tested, and each mutation is caught by a distinct named assertion.

## EVIDENCE:

```
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
(exit 0, no diagnostics)

$ pnpm lint
> eslint . --cache --cache-location .cache/eslint/
(exit 0, no findings)

$ pnpm test
# pass 6181
# fail 0
(exit 0, aggregated across every TAP stream in the run)

$ pnpm exec tsx --test packages/db/src/settlement-invariants.test.ts
# tests 21
# pass 21
# fail 0

$ pnpm exec tsx --test apps/api/src/grading-service.test.ts
# tests 71
# pass 71
# fail 0

$ pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1886 --base origin/main --head 86e46745a
Verdict: PASS
Changed files: 13
Rules matched: (none) — no R-level artifacts required for this diff
```

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm lint`: exit 0
- [x] `pnpm test`: exit 0, 6181 pass / 0 fail
- [ ] `pnpm verify`: NOT RUN on the workstation. `verify` ends at `test:live-db`, where `ci:assert-staging` refuses a workstation target by design (it requires staging `xskgrzbteyqdufktjrjx`). The CI `verify` job is the authoritative run; see the Runtime Verification section.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS

## Mutation battery

Baseline: `pnpm exec tsx --test packages/db/src/settlement-invariants.test.ts` 21/21, and
`pnpm exec tsx --test apps/api/src/grading-service.test.ts` 71/71.

| # | Mutation | Result |
|---|---|---|
| a | Drop the `.range` pagination loop — read only the first page of each chunk | `not ok 13 - collectLatestSettlementsByPick reads every page of a chunk, not just the first` (1 fail) |
| b | Reduce with `record.created_at > current.created_at` instead of `compareSettlementRecordsDescending` | `not ok 17 - collectLatestSettlementsByPick breaks a created_at tie on id, in either page order` (1 fail) |
| c | `.catch(() => new Map())` on the prefetch instead of rejecting | `not ok 38 - UTV2-1886: a failed settlement prefetch rejects the pass instead of reading as an empty map` (1 fail) |
| d | Revert the loop body to `await repositories.settlements.findLatestForPick(pick.id)` | `not ok 39 - UTV2-1886: the settlement lookup is one batched read, not one read per pick` (1 fail) |

**Mutation (b) survived the first attempt and that is recorded rather than smoothed over.**
The correction-chain test used distinct `created_at` values, so it never exercised the
comparator's tiebreak and `>` passed. The gap was in the test, not the implementation: a
tie-ordering test was added — asserting *both* page orders, because a one-order test passes
by luck half the time — and the mutation is caught. A mutation that survives is evidence the
assertion is weak, never evidence the condition is unprovable.

## Production measurement

Read-only, governed, against production `zfzdnfwdarxucxtaojxm` on 2026-09-11. This is why the
change exists and why pagination is mandatory rather than precautionary.

| Measurement | Value |
|---|---|
| `grading.run` rows, 7 days to 2026-09-11 | 108 |
| Median gap between consecutive runs | 91.1 min (min 88.1, max 152.5) |
| `pollIntervalMs` default | 5 min |
| Grading population (`posted` + `awaiting_approval` + Track Only `validated`) | 7,306 + 14,984 + 1 = 22,291 |
| `settlement_records` rows / distinct picks | 37,496 / 25,430 |

## The chunk size is a byte bound, and it was wrong

The chunk size was a magic `500`, which is the second defect this lane was returned for. It is
not a row count — PostgREST carries `pick_id=in.(...)` in the request **line**, and Supabase
fronts PostgREST with a proxy whose request line must fit a single 8 KiB header buffer. Measured
by building the real `@supabase/supabase-js` query and reading `builder.url`:

| ids | URL bytes |
|---|---|
| 50 | 2,080 |
| 100 | 4,030 |
| 200 | 7,930 |
| 250 | 9,880 |
| **500** | **19,630** |

The per-id cost is exactly 39 bytes over a ~130-byte base. A 500-id chunk is therefore a 414
before PostgREST is ever reached. `SETTLEMENT_BATCH_CHUNK_SIZE` is now derived —
`floor((4096 - 256) / 39) = 98`, a budget of half the 8 KiB limit for headroom — and three tests
in `settlement-invariants.test.ts` measure the real URL rather than asserting a number. They are
non-vacuous in both directions: the budget is asserted `<= 8192/2` **and** the old 500-id chunk
is asserted to exceed 8192, so a test that stopped constraining anything would fail.

**The page cap and the chunk cap are different kinds of limit and the earlier draft of this
bundle conflated them.** It said "a 500-pick chunk can hold far more than PostgREST's default
1000-row page" as reassurance. The page cap is a ROW cap whose failure is a silent short read —
fail-open, which is why the page loop exists. The chunk cap is a BYTE cap whose failure is a
loud 414. At the derived chunk of 98, production's 37,496 settlement rows over 25,430 picks
average ~145 rows per chunk — but **the average is not the bound**: settlements are append-only
and a correction chain has no length limit, so the page loop stays unconditional.

### Measuring the query is itself a guarded operation

The first commit of this lane built the query with `createClient` from `@supabase/supabase-js`,
which is the obvious way to read a URL the driver emits. It made two tests in the **required**
`verify` job red — `privileged-db-client-guard.test.ts` reported
`unclassified: packages/db/src/settlement-invariants.test.ts` and
`reachable-from-test: packages/db/src/settlement-invariants.test.ts`. Nothing but a full
`pnpm test` surfaced it: the mutation battery, `type-check`, `lint` and both targeted test files
were green at that head.

The guard is right and was not routed around. Its rule 3 walks the static import graph from the
`test` npm script and refuses **any** path to a raw driver constructor *regardless of inventory
classification*, so registering the file in `privileged-db-client-inventory.json` could not have
worked. Three weaker alternatives were rejected explicitly: classifying the file (impossible —
rule 3 is unconditional), moving the assertions into the live t1-proof suite (this removes them
from `verify`, which is where a byte bound belongs), and hand-computing the URL (vacuous — it
would assert this bundle's own arithmetic instead of what the driver emits).

The fix routes the measurement through `packages/db/src/privileged-client-boundary.ts`, rule 3's
single exemption, and measures the **approved staging** ref rather than the production one. That
substitution is asserted rather than assumed: `PROJECT_REF_PATTERN` fixes every project ref at
exactly 20 characters, and the test asserts both that the staging ref matches that pattern and
that it is the same length as `CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF`, so if either ever
stops being true the measurement stops claiming transferability. No request is issued — nothing
is awaited; `builder.url` is read before the driver sends anything.

## Runtime Verification

Harvested from CI run `34598633546` (attempt 1) at PR head
`c4244f041bd6abacfbdc6313c34812a5c89a4739`. Both credentialed jobs concluded SUCCESS in that run:
`Writable DB proof (staging only)` (job `103260375614`) and `verify` (job `103262329594`).

| Fact | Value |
|---|---|
| Target | approved staging project; `[assert-staging] OK: target is the approved staging project` ran first in both steps. Production never contacted. |
| Window | 2026-09-11T12:23:36.863Z -> 2026-09-11T12:30:30.762Z |
| Steps | `pnpm test:db` (database-smoke) and `pnpm test:t1-proof:live` (18 suites wired at that head; this lane wires a 19th, the live suite for this lane) |
| TAP | 123 pass, 0 fail, 0 skipped across 19 test files |
| Receipt | `.out/ci-db-proof-receipt.json`, sha256 `6348d39d8285f7a3603605331c9f4aba441dd5f299b558409a08a4b540ceb5ff`, artifact `utv2-1630-db-proof-receipt-34598633546-1`. It covers `pnpm test:db` only; the t1-proof step emits no receipt of its own. |

**The receipt above is from the head that preceded this one, and at that head the runtime proof
did not exercise the code this lane changed.** That was stated plainly rather than left to be
inferred, and it was the first of the two defects this lane was returned for. No suite in either
credentialed step called `findLatestForPicks` or `collectLatestSettlementsByPick`; the two suites
that touch `settlement_records` at all — UTV2-1136 immutability (4/4) and UTV2-1137 correction
chain (4/4) — reach the table directly and call neither function.

Three assumptions about real PostgREST were therefore unproven, and the direction of the risk is
what made it worth fixing rather than noting:

1. `.in('pick_id', chunk)` returns rows for every id in the list.
2. `.range(offset, offset + limit - 1)` under the two-key ordering yields disjoint, consecutive pages.
3. `.order('created_at', desc).order('id', desc)` agrees with `compareSettlementRecordsDescending`.

An under-read is the fail-**OPEN** direction: an omitted pick reads as "no settlement exists" and
the caller re-settles it. This is the exact class UTV2-519 and UTV2-521 record as having broken
against live Postgres while passing in memory.

### The remedy is now committed, and what it proves

`apps/api/src/t1-proof-utv2-1886-settlement-batch.test.ts` drives the real
`DatabaseSettlementRepository` against the approved staging project. It is wired into
`test:t1-proof:live`, which `ci.yml` runs inside the `Writable DB proof (staging only)` job, so it
executes in CI rather than only on demand. Three tests, one per assumption:

| Test | Assumption | Shape |
|---|---|---|
| `findLatestForPicks` agrees with `findLatestForPick`, and omits unsettled picks | 1 and 3 | three picks carrying 1, 2 and 3 chained settlements (`corrects_id`), plus a deliberately **unsettled** control. Asserts per-pick agreement on the winning row id, `batch.has(unsettled) === false`, and `batch.size === settled.length` — so a map that padded absent picks with empty entries fails. |
| A page-size-1 live read returns the same map as a single-page read | 2 | six rows over two picks, read at `pageSize: 1000`, `pageSize: 1` and `pageSize: 2`, all asserted identical and cross-checked against `findLatestForPick`. **At `pageSize: 1` every row after the first is on a later page**, so a loop that read only the first page returns the oldest row rather than the newest. |
| A chunk smaller than the id list still returns every settled pick | — | three picks at `chunkSize: 1`, asserting all three survive: chunks union rather than replace. |

Fixtures are written through the repository bundle (`saveSubmission` + `savePick`), matching the
sibling UTV2-1137 proof, rather than through `submitPickController`. The property under test is the
settlement read; routing fixtures through promotion and distribution would put rows in
delivery-bearing tables this proof has no business touching. Rows are not deleted, and the suite
skips cleanly when `SUPABASE_SERVICE_ROLE_KEY` is absent — which is why it cannot run on a
contained workstation, exactly as every sibling `t1-proof` file behaves there.

`Require live-DB proof for runtime changes` was RED and **correct** at the previous head. The new
path matches that guard's accepted pattern `apps/[^/]+/src/t1-proof-.*\.test\.ts$`, and it is now
**SUCCESS** — satisfied by evidence rather than by an exemption.

#### The suite has run against staging, and that is measured rather than predicted

The claim this lane owes is that the batched read works against a real database, not a fake one.
Measured on PR #1565 at `485cc944b`:

| Receipt | Value |
|---|---|
| Workflow run | `34635996613` |
| Job | `Writable DB proof (staging only)`, id `103383898788` |
| Job conclusion | **success** |
| Step 10 | `Run writable DB proof against staging` — success |
| **Step 11** | **`Run the T1 live proof suites against staging` — success** |
| Step 12 | `Scrub credentials` — success |

Step 11 is the step that executes `test:t1-proof:live`, the script this lane appended the new suite
to. The job asserts its own target before running anything: step 6 `Assert staging credentials
present` and step 7 `Materialize staging-only environment` precede it, and
`scripts/ci/assert-staging-target.ts` pins the project ref to the staging value, so a green step 11
is a statement about staging and cannot be a statement about production.

### Three files sit outside the pinned `file_scope_lock`, and one of them is not optional

`file_scope_lock` is settable only at `ops:lane-manifest create` and an agent cannot widen it. This
lane's lock is the five implementation files; landing the proof needed three more:

| Path | Why | Consequence |
|---|---|---|
| `apps/api/src/t1-proof-utv2-1886-settlement-batch.test.ts` | the proof itself | `File scope lock` red |
| `package.json` | the `test:t1-proof:live` wiring `ci.yml` executes — without it the proof exists and never runs | same |
| `docs/05_operations/db-writer-classification.json` | **not optional.** `scripts/ci/db-writer-inventory.ts` runs inside `verify`, a REQUIRED check. Before the entry was added it reported two errors — `unclassified credentialed DB test` and `package script test:t1-proof:live reaches unclassified DB test` — so omitting it would have turned a required check red | same |

**Measured on #1565 at `485cc944b`, the two scope checks disagree, and the disagreement is correct
rather than a defect: `File scope lock` is RED and `Lane authority` is GREEN.** They read different
sources. `Lane authority` evaluates the *lane type's* contract, and `.lane/lanes/runtime.yml` admits
all three paths — `apps/api/**` (:5), `docs/05_operations/db-writer-classification.json` (:42) and
`package.json` (:48). The second and third were registered there by UTV2-1842 for precisely this
case, and the file's own comment at `:33-41` says so: *"a live-DB proof under apps/api/src has TWO
mandatory registration points"*. `File scope lock` evaluates this lane's *manifest* lock, which was
pinned at `ops:lane-manifest create` to the five implementation files and cannot be widened by an
agent. So the repository has already decided a `runtime` lane may touch these paths; what it has not
got is a manifest that was created knowing the proof would need them.

An earlier draft of this bundle predicted both checks RED. That prediction was wrong about
`Lane authority` and is corrected here from the measurement rather than left standing.
`Return review packet` is RED for the same reason as `File scope lock` — it builds its allowed
scope from the manifest lock, not the lane contract. All three are **non-required** and block no
merge. A `scope-override/v1` is a CODEOWNERS artifact and is **not** self-authored; the red is
reported honestly rather than cleared.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1565
Approved PR head: pending merge
Execution SHA: 86e46745a7368855f053814c33076b55634311aa
