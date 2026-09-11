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
- [x] Three of the assertions above are proven **against a live database**, not only in unit tests: `t1-proof-utv2-1251-evidence-settlement.test.ts` now executes 4/4 against staging with `skipped: 0`, asserting that a validated Track Only pick settles with `picks.status` still `validated`, no `pick_lifecycle` transition to `settled` and zero `distribution_outbox` rows; and that the same pick with `distributionMode` removed is refused and writes no settlement record. The suite also had to be wired into `test:t1-proof:live` to run at all — before this lane it skipped in every CI run. See Runtime Verification.

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

This section was rewritten after the lane obtained a **lane-specific** live
assertion. Its previous text described the generic staging smoke and recorded,
honestly, that zero UTV2-1861-specific live assertions had run. That is no
longer the state and the earlier text is superseded rather than amended.

**What ran.** Job `staging-db-proof` in CI run `34551219661`, attempt 1, on this
PR head `39b68f573ab3e0c0f7ac29acd7b85c775a77871a`, against staging
`xskgrzbteyqdufktjrjx`. `assert-staging-target.ts` confirmed
`host=xskgrzbteyqdufktjrjx.supabase.co` against canonical production ref
`zfzdnfwdarxucxtaojxm` before any test ran. Two steps matter:

| Step | Command | Result |
|---|---|---|
| 10 | `pnpm test:db` | TAP 7/7 pass, 0 fail, **0 skipped**, `exit_code 0` — receipted |
| 11 | `pnpm test:t1-proof:live` | 18 suites, all pass. The last is `t1-proof-utv2-1251-evidence-settlement.test.ts`: **4/4 pass, 0 fail, 0 skipped** |

The four cases, verbatim from the job log:

```
ok 1 - UTV2-1251: settlement record written for awaiting_approval pick — picks.status unchanged
ok 2 - UTV2-1251: recordEvidenceSettlement rejects non-awaiting_approval pick
ok 3 - UTV2-1861: evidence settlement for a validated Track Only pick — status stays validated, zero delivery
ok 4 - UTV2-1861: recordEvidenceSettlement still rejects a validated pick WITHOUT the Track Only marker
```

Cases 3 and 4 are new in this lane. Cases 1 and 2 are pre-existing and **had
never executed live before this lane**: the suite was wired only through
`apps/api/package.json`'s `test` script, which runs in the credential-free
`verify` job and skips. This lane added the file to root `package.json`'s
`test:t1-proof:live`, which is the script the credentialled `staging-db-proof`
job runs. `skipped: 0` is therefore load-bearing twice over — it is what
distinguishes this run from every prior CI run of the same file.

**What the receipt does and does not cover.** The `ci-db-proof-receipt/v2`
artifact (`receipt_sha256`
`c36f77450ecbad1a45ed7abe2217cce6138a9c2b4b4c22cdd0a5145633df12fe`,
`output_sha256`
`b4ff6cb955a1bcf698f9a1eb9bed779cba5469a5925ab5c803af577279b3f419`,
`repo_migration_head` `20260901150000_utv2_1811_rate_limit_buckets.sql`) wraps
**step 10 only** — the receipt generator wraps `pnpm test:db` and nothing else.
Step 11 emits no receipt. The UTV2-1861 evidence above is therefore the step-11
TAP stream read from the job log, in the same job, same run, same attempt, on
the same staging credentials the receipt attests. That distinction is stated
rather than elided: the receipt's digests must not be read as covering the
UTV2-1861 assertions.

**How the block was produced.** By hand, from the downloaded artifact and the
job log. The UTV2-1641 harvester cannot produce it pre-merge, and this is a
defect worth recording rather than working around silently:
`locateCiDbProofRun` step 1 calls `findWorkflowJobForHeadSha(mergeSha)` and, on
a hit, labels the result `identity_source: 'merge_sha_run'`, which then demands
`receipt.github_sha === mergeSha` exactly. On a `pull_request` run `GITHUB_SHA`
is the merge-ref commit (`refs/pull/1561/merge`, here
`7e5e1b49c5b1ba55d78b79f5b5adec5ca5ed2d92`), not the PR head, so it fails closed
with `receipt_invalid`. The module's own correct `pr_head_run` branch is
reachable only through the step-2 fallback and is shadowed by step 1.

**The first staging attempt refused both new cases, and that is recorded here
rather than discarded.** Run `34548717135` returned `not ok 3` and `not ok 4`.
Both refusals were defects in the fixtures, not in the guard:

- **Case 3** failed `SMART_FORM_RELATIONSHIP_INVALID`. `validateSmartFormRelationships`
  runs inside `submitPickController` (`:46`), not only at the HTTP boundary, and
  `carriesSmartFormFields` triggers the full Smart Form contract on any
  `smart-form` payload carrying a `distributionMode`. Satisfying it needs a typed
  `participantResolution` whose canonical branch requires a real event and whose
  manual branch verifies its claimed coverage gap against the reference-data
  catalog — both of which would make this proof depend on staging reference data
  that containment deliberately leaves unpopulated, i.e. testing the catalog
  rather than the guard. `isEvidencePlanePick` reads exactly two fields, `status`
  and `metadata`, and reads neither `source` nor any Smart Form field, so the
  fixture now submits with source `api`, a non-governance-brake source that lands
  at `validated` with the controller's Track Only branch returning before any
  enqueue.
- **Case 4** failed on `queued != validated`. A `smart-form` submission that
  merely omits `distributionMode` is enqueued and lands at `queued`. The control
  was therefore discriminating on **lifecycle state**, not on the Track Only
  marker — which would have left case 3 satisfied by a guard that admitted the
  entire pre-delivery backlog, the exact failure the control exists to prevent.
  It is now built from the *same* fixture as case 3 and stripped of exactly one
  field, so the two picks differ only in the marker.

Both were assumptions predicted from reading the submission path instead of
running it, and the live run is what caught them. That is the whole argument for
this section existing.

**Scope — what this does NOT prove.** It does not prove that the deployed Smart
Form produces a validated Track Only pick. That is Milestone 1's evidence
(production pick `dfcd9486-cba2-4bb5-b684-beec36e52c0b`), not this file's.

**Binding.** `pr_head_run`. The receipt's `github_sha`
`7e5e1b49c5b1ba55d78b79f5b5adec5ca5ed2d92` is the merge-ref commit for
`refs/pull/1561/merge`, whose second parent is the PR head
`39b68f573ab3e0c0f7ac29acd7b85c775a77871a`. It is not the branch head and must
not be read as one.

Job: https://github.com/griff843/Unit-Talk-v2/actions/runs/34551219661/job/103114350408

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
Execution SHA: 24412c77979c8280ffbce7c124ba83dd5ebbe25b
