# PROOF: UTV2-1861

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Issue: UTV2-1861
Tier: T1
Lane type: modeling
Branch: claude/utv2-1861-admit-track-only-to-grading
PR: https://github.com/griff843/Unit-Talk-v2/pull/PENDING
Head SHA: 2b4342515dbd86cd4ed32ac495308053eb5daebf
result: pass

## ASSERTIONS:

- [x] `runGradingPass` admits a `validated` pick carrying `distributionMode: "track-only"` to the grading population, which it previously never read.
- [x] The admission is narrow: a `validated` pick **without** the Track Only marker is not admitted. Measured read-only against production `zfzdnfwdarxucxtaojxm` on 2026-09-10 — 21,364 picks sit at `validated` and exactly **1** carries the marker.
- [x] A Track Only pick is settled through the evidence plane: `recordEvidenceSettlement`, no lifecycle transition. `validated -> settled` is not a legal edge in `pickLifecycleTransitions`, so this is the only honest outcome, and the pick's `status` is asserted to remain `validated` after grading.
- [x] Grading a Track Only pick creates **no delivery**: zero `distribution_outbox` rows, and no Discord request even when a `sent` outbox row already exists and `DISCORD_BOT_TOKEN` is set.
- [x] `recordEvidenceSettlement` fails closed on a `validated` pick that is not Track Only.
- [x] The rule has exactly one definition — `isEvidencePlanePick` in `settlement-service.ts` — consumed by the population filter, the settlement branch and the recap skip, so the copies cannot disagree.
- [x] Four mutations each turn the suite red; none is vacuous.

## EVIDENCE:

```
$ pnpm type-check
(exit 0)

$ pnpm exec tsx --test apps/api/src/grading-service.test.ts apps/api/src/settlement-service.test.ts
# tests 96
# pass 96
# fail 0
# skipped 0

$ pnpm test
(exit 0) aggregated across the repository: # pass 6137, # fail 0, 0 "not ok" lines

$ pnpm lint
(exit 0)

$ pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1861
Verdict: PASS
Changed files: 6
Rules matched: settlement-grading
Advisory (PM-gated) artifacts missing:
  - r4-fault-report [PM-gated]

$ pnpm verify
NOT RUN on the workstation. `verify` ends at `test:live-db`, where
`ci:assert-staging` refuses a workstation target by design. The authoritative
run is the hosted `verify` check on this PR head.
```

### Mutation battery — each row was applied, measured, and reverted

Command for every row: `pnpm exec tsx --test apps/api/src/grading-service.test.ts`
(69 tests at the unmutated head).

| # | Mutation | Result |
|---|---|---|
| M1 | `const trackOnlyPicks = validatedPicks;` — drop the Track Only filter | **1 failing** — "does NOT admit a validated pick without the Track Only marker" |
| M2 | revert the `recordEvidenceSettlement` state guard to `pick.status !== 'awaiting_approval'` | **3 failing** |
| M3 | revert the recap skip to the `pick.status !== 'awaiting_approval'` literal | **1 failing** — "never posts a settlement recap for a Track Only pick" |
| M4 | drop `...trackOnlyPicks` from the population | **3 failing** |
| — | unmutated | 69 pass, 0 fail |

M3 is the row worth reading. It **did not** fail on the first attempt, because
`postSettlementRecapIfPossible` returns early without `DISCORD_BOT_TOKEN` and
`resolveRecapChannel` needs a `sent` outbox row that a Track Only pick can never
have — so the control had no failing condition at all. Building one surfaced an
eighth Track Only chokepoint that was not in the recorded list of seven:
`InMemoryOutboxRepository.enqueue` itself refuses
(`packages/db/src/runtime-repositories.ts:800-806`, `TrackOnlyDeliveryForbiddenError`,
UTV2-1672). The fixture therefore creates the delivery row first and stamps the
Track Only marker afterwards, which is the real ordering that shape models.

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: exit 0, 6137 pass / 0 fail
- [x] `pnpm lint`: exit 0
- [ ] `pnpm verify`: refused at `test:live-db` on the workstation by design — hosted `verify` on this PR head is authoritative
- [x] `npx tsx scripts/ci/r-level-check.ts --issue UTV2-1861`: PASS

## Runtime Verification

Runtime evidence is the hosted `Writable DB proof (staging only)` job on this PR
head, against staging `xskgrzbteyqdufktjrjx`: run `34547046223`, job
`staging-db-proof`, attempt 1, `exit_code 0`, TAP 7/7 pass, 0 fail, **0 skipped**.
`assert-staging-target.ts` confirmed `host=xskgrzbteyqdufktjrjx.supabase.co`
against canonical production ref `zfzdnfwdarxucxtaojxm` before any test ran.

**How the block was produced, stated exactly.** The UTV2-1641 harvester
(`harvestCiDbProofForMergeSha`) was run first and **refused**, so the block in
`evidence.json` was assembled by hand from the run's own
`ci-db-proof-receipt/v2` artifact (`receipt_sha256`
`f6890151a5bbf707a876d7c8ec9b987d795e8b72df0560b57bdc58350c059f37`,
`output_sha256` `586f1ca5009cf874bffed70e9dadf9583338d9111cdb9b3377c0011e8801ddaa`),
downloaded from that run. Every value in the block is copied from that artifact;
none is recalled or inferred.

The refusal is a real tooling defect and is recorded rather than worked around
silently. `locateCiDbProofRun` step 1 calls `findWorkflowJobForHeadSha(mergeSha)`
and, when it hits, labels the result `identity_source: 'merge_sha_run'` — which
then demands `receipt.github_sha === mergeSha` exactly. On a `pull_request` run
`GITHUB_SHA` is the merge-ref commit (`71ef808ba…`, `refs/pull/1561/merge`), not
the PR head (`2848f0cb3…`), so the harvester fails closed with
`receipt_invalid`. The module already contains the correct rule for this case —
the `pr_head_run` branch, which accepts a receipt whose merge-ref second parent
is the PR head — but step 1 shadows it, so that branch is only reachable through
the step-2 fallback. Consequence: **pre-merge harvest of a PR-head receipt is
structurally unavailable**, and every populated `runtime_proof` in this
repository was therefore written either post-merge or by hand. The binding facts
are recorded explicitly in `runtime_proof.binding` so a reader is not left to
infer which SHA the receipt is bound to.

A second, smaller finding from the same run: the first CI run on this branch
(`34547012191`) was **cancelled** by the concurrency group when `lane-pr-binding`
auto-committed `pr_url` and moved the head 30 seconds later. Its artifact upload
failed with *"No files were found with the provided path:
.out/ci-db-proof-receipt.json"*, and because `verify` is a summarising job that
fails closed on a non-success staging result, `verify` went red for a reason that
had nothing to do with the code. The green receipt above is from the second run,
on the real head.

**What this runtime proof does and does not cover, stated plainly.** It attests
that the live database contract is intact at this head — the repository bundle's
submission and settlement write path, three UTV2-920 atomic-rollback invariants,
the UTV2-883 participant uniqueness invariant, and the two UTV2-996 settlement
correction invariants, all against real staging. `0 skipped` is the load-bearing
number: the suite elides itself when staging credentials are absent, so a
non-zero skip count would mean nothing reached a database.

It is **not** a UTV2-1861-specific live assertion, and the same statement is
carried inside `runtime_proof.note` so it cannot be separated from the evidence
it qualifies. No query in the block exercises the Track Only grading admission.
The staging job's receipted command is `pnpm test:db`, which runs
`apps/api/src/database-smoke.test.ts` and nothing else.

One was not added, and the reason is mechanical rather than a preference. A
lane-specific live suite must be a new `apps/api/src/t1-proof-utv2-1861-*.test.ts`
wired into `test:t1-proof:live`, and that script is an **explicit enumerated list
of 17 files, not a glob** — so it needs both root `package.json` and a new
`apps/api/src` file. Both are outside this lane's `file_scope_lock`, which is
pinned at lane-start and cannot be widened by an agent. `--files` additionally
refuses a path that does not exist yet, and only a trailing `/**` glob is legal
in a scope declaration, so the only route that would have admitted the new file
is locking `apps/api/src/**` for a four-file change. This lane declined that as a
worse trade than the honest gap.

The behavioural evidence for this change is therefore `static_proof`: 96/96 lane
tests, 6137 pass / 0 fail across the full suite, and the four-way mutation
battery above in which M1–M4 each turn the suite red. `Proof Coverage Guard` is
red on this PR for exactly the reason stated here; it is not one of the four
required checks, and #1479 merged with the identical red for the identical
reason.

## Measured effect on Milestone 1's pick

Production pick `dfcd9486-cba2-4bb5-b684-beec36e52c0b` — MLB moneyline,
`selection: Dodgers`, `line: null`, `-110`, 3.00 units, `source: smart-form`,
`status: validated`, `metadata.distributionMode: track-only` — is the one row
this admission adds. Replayed locally against an in-memory bundle at this head:

```
status at rest: validated  line: null
attempted: 1  graded: 0
details: [{"outcome":"skipped","reason":"unsupported_market_family",
           "marketFamily":"unsupported","participantRequirement":"forbidden"}]
```

`attempted` moves from **0 to 1** — the pick is now *seen* by grading, where it
previously was not. It still does not settle, and this lane does not claim it
does: it is a moneyline, and `classifyMarketFamilyForGrading` returns
`unsupported` for that family. That is layer 2, tracked separately. Layer 1 —
"grading never reads the state a Track Only pick rests in" — is what closes here.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Approved PR head: pending merge
Execution SHA: 2b4342515dbd86cd4ed32ac495308053eb5daebf
