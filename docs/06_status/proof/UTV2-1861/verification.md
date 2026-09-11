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
head, against staging `xskgrzbteyqdufktjrjx`. The block in `evidence.json` is
derived mechanically from that job's receipt and log by the UTV2-1641 harvester's
own exported functions — not written by hand.

**What this runtime proof does and does not cover, stated plainly.** It attests
that the live database contract is intact at this head. It is **not** a
UTV2-1861-specific live assertion, and one was deliberately not added: a new
`t1-proof-*.test.ts` is only reachable through the `test:t1-proof:live` script in
root `package.json`, and `package.json` is outside this lane's
`file_scope_lock`, which is pinned at lane-start and cannot be widened by an
agent. The behavioural evidence for this change is therefore the five new unit
tests and the four-way mutation battery above.

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
