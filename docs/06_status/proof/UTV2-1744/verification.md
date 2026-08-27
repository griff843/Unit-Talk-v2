# PROOF: UTV2-1744

MERGE_SHA: df4cf115c6de564bf129847f1296325c0ba976ce

Read-only triage of the production `distribution_outbox`. This lane ships a
classifier, a target verifier, a stuck-claim analyser, and a replay verdict
function. It performs no remediation: no replay, requeue, release, delete,
regrade, or backfill, and the only database verb it issues is `SELECT`.

**Lane verdict: no dead-letter class is approved for replay.**

## Verification

ASSERTIONS:

- [x] `replayVerdict` has no reachable approving branch. Every one of the six
      classes returns `approved: false` with a named reason, and a class value
      that does not exist yet also returns `approved: false` rather than an
      undefined verdict.
- [x] `TriageReport.anyClassApprovedForReplay` is typed as the literal `false`,
      so a future edit that tries to set it true fails type-check rather than
      silently changing the verdict.
- [x] Target classification fails closed: `isMemberFacingTarget` returns true
      for any target that is not a reviewed canary prefix, so an unreviewed
      channel is treated as member-facing, never as safe.
- [x] The triage read names the terminal status production actually uses.
      Production has no `delivered` status; the terminal status is `sent`.
- [x] A terminal (`sent`) row is neither live nor a dead letter — verified by
      the decisive case, a `sent` row on `discord:best-bets`, which would flip
      the safety verdict to unsafe if terminal rows were treated as live.
- [x] Stale-claim detection fires on the threshold it names and not before:
      `DEFAULT_STALE_CLAIM_MS - 1` and the exact threshold both yield zero
      claims; `DEFAULT_STALE_CLAIM_MS + 1` yields one.
- [x] An unclaimed `processing` row is not counted as a stuck claim.
- [x] A stale claim on a target no worker is configured for is reported as
      permanently orphaned, because `reapStaleClaims(target, ...)` is per-target
      and iterates only the worker's own configured targets.
- [x] Every live production dead-letter reason string classifies to its named
      class, a null or blank reason is classified rather than dropped, and an
      unseen reason does not borrow a reviewed class.
- [x] `pnpm exec tsx --test scripts/ops/outbox-triage.test.ts` — 12 pass, 0 fail.

### Mutation evidence

Each control was proven by making it fail on the condition it names, not by a
green run alone:

| Control | Induced condition | Observed |
|---|---|---|
| `verifyTargets` safety | promote one dead letter on `discord:best-bets` to `pending` | `safe` flips `true` → `false`, `memberFacingTargets` becomes `['discord:best-bets']` |
| Terminal-status filter | classify a `sent` row | not counted as a dead letter, does not flip the safety verdict |
| Reason classification | a reason resembling a reviewed one (`'source is live'`) | `unrecognised`, does not borrow `proof_pick_blocked` |
| Replay refusal | a fabricated class `'brand_new_class'` | `approved: false`, reason matches `/fail closed/` |
| Stale threshold | offsets of −1 ms, exactly 0 ms, +1 ms | 0, 0, 1 claims |

The fixture mirrors the real `distribution_outbox` Row type field for field.
Inventing a field would make every filter vacuously true — see the note at the
top of `scripts/ops/outbox-triage.test.ts`.

## Runtime Verification

The read-only triage was executed against the live production population. The
local CLI path is unavailable under production containment: `local.env` carries
`SUPABASE_URL=http://127.0.0.1:1`, so `pnpm exec tsx scripts/ops/outbox-triage.ts`
fails closed with a transport error rather than reaching production. Live reads
were therefore issued through the Supabase MCP read path against project
`zfzdnfwdarxucxtaojxm` on 2026-08-26. Every statement below is a `SELECT`.

EVIDENCE:

```text
SELECT status, count(*) AS rows, count(DISTINCT target) AS targets,
       max(attempt_count) AS max_attempts
FROM public.distribution_outbox GROUP BY status ORDER BY 1;

status       | rows | targets | max_attempts
-------------+------+---------+-------------
dead_letter  | 1954 |       2 |            1
pending      |    3 |       1 |            0
processing   |   32 |       4 |            0
sent         | 3758 |      12 |            1
```

```text
SELECT status, target, coalesce(last_error,'<NULL>') AS reason, count(*) AS rows
FROM public.distribution_outbox WHERE status <> 'sent'
GROUP BY 1,2,3 ORDER BY 1,4 DESC;

dead_letter | discord:canary    | proof-pick-blocked: source 't1-proof' is not a live source            | 1614
dead_letter | discord:best-bets | stale_pending_operator_review                                        |  199
dead_letter | discord:best-bets | operator-disposition-2026-06-10: Mode 1 public delivery hold — ...    |   97
dead_letter | discord:best-bets | governance_public_delivery_suppressed_mode1_predeploy                |   40
dead_letter | discord:best-bets | <NULL>                                                              |    4
pending     | discord:canary    | <NULL>                                                              |    3
processing  | utv2-1497-canary-c0aae7fd | <NULL>                                                      |    8
processing  | utv2-1497-canary-3a2ca3ff | <NULL>                                                      |    8
processing  | utv2-1497-canary-adb6af4f | <NULL>                                                      |    8
processing  | utv2-1497-canary-2d4eb56e | <NULL>                                                      |    8
```

```text
SELECT count(*) AS claimed_rows, count(DISTINCT claimed_by) AS distinct_workers,
       count(DISTINCT target) AS distinct_targets,
       min(claimed_at) AS oldest_claim, max(claimed_at) AS newest_claim,
       round(extract(epoch FROM (now() - min(claimed_at))) * 1000)::bigint AS max_held_ms,
       round(extract(epoch FROM (now() - min(claimed_at))) * 1000 / 300000.0)::int
         AS max_threshold_multiple
FROM public.distribution_outbox
WHERE status = 'processing' AND claimed_at IS NOT NULL AND claimed_by IS NOT NULL;

claimed_rows | distinct_workers | distinct_targets | oldest_claim                  | max_held_ms | max_threshold_multiple
-------------+------------------+------------------+-------------------------------+-------------+-----------------------
          32 |               32 |                4 | 2026-07-30 17:55:09.760282+00 |  2361129093 |                   7870
```

The full-report test fixture reproduces this exact population — 1,954 dead
letters across the five reason classes, 3 pending on `discord:canary`, and 32
`processing` rows held by 32 distinct workers across 4 targets — and the code
returns `anyClassApprovedForReplay: false` on it.

### Unit test output

```text
$ pnpm exec tsx --test scripts/ops/outbox-triage.test.ts
1..12
# tests 12
# suites 0
# pass 12
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### Static verification

```text
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
(no diagnostics; exit 0)

$ pnpm verify:static
ci:db-client-boundary, ops:sync-check, ops:system-alignment-check,
ops:automation-coverage-check, env:check, lint, type-check, build,
pnpm test, smart-form verify, verify:commands
[executable-wiring] verdict=PASS required_roots=verify
EXIT=0

$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 17
Rules matched: (none) — no R-level artifacts required for this diff
```

`pnpm verify` is `verify:static && test:live-db`. `verify:static` is green, shown
above. `test:live-db` cannot run in this worktree: production containment sets
`SUPABASE_URL=http://127.0.0.1:1`, and `assert-staging-target` refuses any target
that is not `xskgrzbteyqdufktjrjx`:

```text
$ pnpm test:db
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL
```

That is a correct safety refusal, not lane debt. The live-DB receipt for this lane
is produced by CI's `staging-ci` environment inside the required `verify` job.

This lane's own tests are wired into `test:ops` under a PM-authorized scope
extension covering `package.json`, so they execute under required `verify` rather
than only when invoked by hand. No entry was added to
`executable-wiring-baseline.json`: the signal was fixed, not suppressed.

## Findings

1. **All 32 `processing` rows are permanently orphaned, not merely stale.**
   They are held on `utv2-1497-canary-*` targets that no configured worker
   reaps. `reapStaleClaims(target, staleBefore, reason)` is per-target and
   iterates `options.targets`, so a claim on a target outside that set is never
   visited. At 7,870× the 300,000 ms stale threshold, no amount of waiting
   clears them.

2. **Every claim is held by a distinct worker identity.** 32 rows, 32 distinct
   `claimed_by` values. This is not one crashed worker holding a batch; it is a
   fixture population that was claimed and abandoned wholesale.

3. **No dead-letter class is approved for replay.** Each of the four live reason
   classes is a deliberate suppression or a fixture block, not a transport
   failure: replaying any of them would re-run blocked fixtures, deliver content
   no operator released, resurrect content an operator voided, or bypass the
   governance brake that suppressed it. The 4 null-reason rows cannot be shown
   safe and are refused on that basis.

4. **The live queue is target-safe.** No `pending` or `processing` row targets a
   member-facing channel; the 3 pending rows are on `discord:canary` and the 32
   processing rows are on canary fixtures. The 336 member-facing dead letters
   are inert unless something replays them, and nothing in this lane does.

## Scope

Read-only. No production write, replay, requeue, release, delete, regrade, or
backfill was performed or is enabled by this lane. Cleanup of the 32 orphaned
`processing` rows and the 3 pending canary rows is deliberately out of scope and
belongs to a separate bounded successor requiring exact IDs, a before/after
snapshot, a dry run, an immutable audit receipt, and fail-closed target
validation. The 1,954 dead letters are never to be replayed or modified.
