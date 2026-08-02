# PROOF: UTV2-1660

MERGE_SHA: 003880750b7a7eafe4ba8954e624c1402f215631

Bound to the code-only commit carrying the full implementation (through
round 20's remediation) on top of the lane-start commit in this branch's
history. Code and proof are deliberately separate commits so the proof can
name a SHA that actually contains the code it describes.

## Branch history note (round 20 governance remediation)

PM review of exact-head `4b2fae0157b2c3f09b7d35c9ca584bd56ade140e` found
Branch Discipline red: three commit messages in the prior 39-commit history
(from the original round-1 implementation and round-9 remediation)
referenced UTV2-1640, UTV2-1647, and UTV2-1662 informationally in prose
(precedent citations and a filed-follow-up-issue note), in addition to this
branch's own UTV2-1660. Per PM instruction, the branch history was squashed
to a clean, UTV2-1660-only set of commits: `chore(lanes): UTV2-1660 start
lane` (lane apparatus) and `feat(readiness): UTV2-1660 distinguish
parked_verified from active service death` (the full implementation,
including every round's remediation through round 20), followed by this
proof-doc commit. The pre-squash history (all 39 original commits,
including every individual round's own commit and the exact-head SHAs
Codex reviewed at each round) is preserved on the local
`backup/utv2-1660-round19-pre-squash` branch for reference; those SHAs are
cited by number throughout the "Round N remediation" sections below for
narrative/audit continuity, but no longer resolve on the pushed branch
itself -- the CURRENT code state is what round 20's fresh review will
verify, and is fully described by each round's prose narrative regardless
of which commit SHA originally carried it.

## Summary

The governed parked deployment of current main completed successfully on
2026-08-01: exact deployed SHA verified, `SYNDICATE_MACHINE_ENABLED=false`,
ingestor/worker autorun and scheduling all `false`, enabled targets `none`,
public kill switches engaged, no queue replay or public delivery. Despite
this, the refreshed readiness ledger still reported `ingestor_health` and
`worker_outbox_health` as `fail`, because those two dimensions evaluated
every deployment -- parked or active -- against the same fixed
staleness/heartbeat thresholds. A correctly-parked deployment and an
unexpectedly-dead active deployment produced the identical `fail` reading.

This lane adds a six-state runtime model
(`active_healthy | active_degraded | active_failed | parked_verified |
parked_drift | unreadable`) so the ledger can tell those two conditions
apart, without ever calling a parked service "healthy" and without ever
weakening what an active-mode failure means.

## Design

### Evidence source: a deploy-time receipt artifact, not scraped logs

`deploy.yml`'s production confirm step already emits a JSON receipt proving
the full parked contract (mode, requested vs. runtime values, ingestor/worker
autorun+scheduling, enabled targets, kill-switch engagement, release tag).
Before this lane that receipt only existed as a printed log line. Reading it
back from raw job-log text would be fragile: GitHub Actions redacts ANY log
content that matches ANY registered secret's value, repo/org-wide -- an
innocuous receipt field value like `"none"` or `"true"` could be silently
blanked to `***` if it happens to collide with an unrelated secret. The
confirm step now also writes the receipt to `.out/parked-contract-receipt.json`
and uploads it as a same-run artifact (`parked-contract-receipt-<run_id>-<attempt>`),
the same pattern already established for `ci-db-proof-receipt.json` in
`ci.yml`. Artifact contents are not subject to log redaction.

`GithubReader` gains `latestArtifactJson(runId, namePrefix)`; the real
implementation uses `gh api .../artifacts` to find the matching artifact and
`gh run download` to fetch and parse it.

### Resolution and trust boundary

`resolveParkedContractReceipt(ctx)` finds the latest successful `deploy.yml`
run on `main`, fetches its receipt artifact, and **refuses to trust it** if
the receipt's own `releaseTag` doesn't match that run's `head_sha` -- a
receipt that doesn't provably belong to the run it was fetched from is
treated as unavailable, falling back to the unchanged active-mode path.

### Per-dimension logic

Both `probeIngestorHealth` and `probeWorkerOutboxHealth` keep their exact
pre-existing threshold computation (`failures: string[]`, same thresholds,
same evidence strings) completely unchanged -- this is what runs when parked
evidence is unavailable, or when the resolved mode is `active`. This is the
"never weaken active-mode checks" guarantee: the code path taken in those
cases is byte-for-byte the pre-UTV2-1660 logic.

Only when parked evidence resolves AND `receipt.mode === 'parked'` does a
second branch apply:

- **Ingestor**: drift if the receipt's own `ingestorAutorun`/`ingestorScheduling`
  aren't `"false"`, or if an ingestor cycle/merged-provider-cycle timestamp is
  AFTER the receipt's `observedAt` (i.e. the ingestor actually ran despite
  being told to park).
- **Worker**: drift if the receipt's `workerAutorun` isn't `"false"` or
  `enabledTargets` isn't `"none"`, if the receipt didn't itself confirm kill
  switches engaged, if a **fresh, independent** re-check of
  `delivery_kill_switch` right now shows either target not engaged (never
  just trusting the deploy-time receipt's claim), if the worker heartbeat ran
  after `observedAt`, or if any outbox row shows mid-processing/attempted
  activity despite parked mode.

Any drift -> `status: 'fail'`, `runtime_state: 'parked_drift'` -- a **hard**
failure, worse than an ordinary active failure, since it means the
containment itself did not hold. No drift -> `status: 'pass'`,
`runtime_state: 'parked_verified'`, with evidence text that explicitly says
this is "NOT ordinary active health."

`active_degraded` is a new, purely informational sub-state of `pass` (cycle
age or heartbeat age past half the SLA window but not yet over it) -- it
never changes `status` and only applies on the unchanged active-mode branch.

`unreadable` is recorded in `measured.runtime_state` even inside the existing
generic `unreadable()` catch path (previously `measured` was always `null`
there), so a DB-read failure is now distinguishable from `active_failed` /
`parked_drift` at the field level, not just via the coarser `status: unknown`.

## P1 remediation (post-Codex-review, exact-head 0d6048437f3d4a7c5b33547d608a3740523931a4)

Codex reviewed the original implementation (commit `3bf4174008`) and flagged
three P1s, all fixed here:

1. **Missing `actions: read` permission.** `.github/workflows/readiness-refresh.yml`
   granted only `contents: write` and `issues: write`. Listing and downloading
   a workflow-run artifact (`gh api .../artifacts`, `gh run download`) needs
   Actions read permission; without it the scheduled job's `GITHUB_TOKEN` gets
   denied, `resolveParkedContractReceipt()` catches the error, and evaluation
   silently falls back to active-mode -- meaning the scheduled production
   refresh could never actually produce `parked_verified`, defeating the
   entire point of this lane. Fixed by adding `actions: read` to the
   workflow's `permissions` block. Covered by a new test that parses the YAML
   and asserts the permission is present.
2. **Kill-switch recheck not fail-closed on unreadable evidence.**
   `verifyKillSwitchesEngagedNow()` returns `null` when either live query
   throws (transient error, permission error, unreachable DB). The drift
   check only tested `killSwitchNow === false`, so a `null` fell through
   silently -- the probe would proceed to `status: 'pass'`,
   `kill_switch_reverified_engaged: null`, and evidence text claiming kill
   switches were "re-verified engaged now," turning unavailable containment
   evidence into `parked_verified`. Fixed: any non-`true` result (`false` OR
   `null`) is now drift, with distinct evidence text for each case. Covered
   by a new test that makes the kill-switch query throw and asserts the
   result is `parked_drift`, never `parked_verified`.
3. **Incomplete post-parking worker-activity detection.** The existing
   checks (`staleUnknown`, `stuckRetryable`) only catch outbox rows stuck
   past 5m/30m windows. A row claimed, attempted, and delivered to a
   terminal status quickly after parking would never appear in either
   bucket, and the worker heartbeat is not a reliable fallback
   (`apps/worker/src/runner.ts:141-164` treats heartbeat writes as
   best-effort and continues after failure) -- so a resumed worker could
   process real work while every existing counter reads zero. Fixed by
   adding a broader check: any `distribution_outbox` row with
   `updated_at > receipt.observedAt`, regardless of current status. Covered
   by a new test with zero stuck rows in either existing bucket but one row
   updated after `observedAt`, asserting `parked_drift`.

A related P2 (parked-contract receipt artifacts expire after GitHub's
30-day retention window, recreating the false-RED condition if production
stays parked with no new deploy for that long) was also flagged by the same
review. Not fixed in this PR -- tracked as a separate, lower-severity
follow-up, not silently dropped.

## Round 2 remediation (post-second-review, exact-head b43898ad20f241807e0c35b4dd89f3ddb6c71cd0)

Requesting a fresh Codex review at the round-1 exact head (`0d604843`)
surfaced one more real P1, fixed here:

4. **Trusted an older successful deploy while a newer run existed.**
   `resolveParkedContractReceipt()` queried `deploy.yml` runs with a
   server-side `status=success` filter — blind to whether a *newer* run
   exists that's still in progress, or that failed after already mutating
   production. It would happily find and trust an older successful run's
   receipt as if it described current state. Fixed: fetch the newest
   `deploy.yml` run on `main` regardless of status, and refuse to trust any
   receipt unless that newest run is itself `status: 'completed'` /
   `conclusion: 'success'`. Covered by a new test where the newest run is
   `in_progress` and asserts the receipt is never trusted (falls back to
   active-mode).

A related P2 (receipts from explicit `image_tag` dispatch inputs get
rejected by the `releaseTag === head_sha` equality check, since a tagged
dispatch records the tag, not the commit SHA, in the receipt) was also
flagged. Not fixed here — it fails toward the safe direction (active-mode
fallback, not a false `parked_verified`), tracked as a deferred follow-up.

## Round 3 remediation (post-third-review, exact-head 2841729872dce5fe912f1946682163858bf8892c)

Requesting a fresh Codex review at the round-2 exact head (`ff0791dc`)
surfaced one more real P1 in round 1's own fix #3 (the broad post-parking
activity check), fixed here:

5. **Counted a legitimate non-worker producer as worker activity.**
   `apps/api/src/recap-service.ts` is a "parked-enabled" scheduler (per
   `apps/api/src/scheduler-policy.ts`'s `SCHEDULER_CLASSIFICATIONS` — recap,
   trial-expiry, participant-enrichment, etc. are explicitly allowed to keep
   running while the syndicate machine is parked). It enqueues and marks its
   own `distribution_outbox` rows sent directly (`enqueue()` /
   `markSent()`), entirely independent of the worker's claim mechanism — it
   never sets `claimed_at`/`claimed_by`. The round-1 fix's `updated_at >
   receipt.observedAt` check counted this legitimate write as drift,
   misreporting every expected parked-mode recap as `PARKED_DRIFT`. Fixed by
   filtering on `claimed_at` instead: that column is set exclusively by the
   worker's claim step (`apps/worker/src/runner.ts`,
   `distribution-worker.ts`) and cleared only on `markFailed`, never on
   success — so it isolates worker-originated activity specifically while
   still catching a row claimed and delivered quickly (the original gap
   fix #3 exists to close). One existing test updated for the column
   rename; one new test added asserting a recap-scheduler-style write
   (`updated_at` moves, `claimed_at` does not) never triggers drift.

`pnpm type-check`, `pnpm lint` clean; `pnpm test:ops` 1906/1906 passing
(36/36 top-level in `readiness-refresh.test.ts`; 25/25 in
`deploy-parked-mode.test.ts`, unchanged).

## Round 4 remediation (post-fourth-review, exact-head 335447949fa9a9569eb443ccf5f9ff3dfacd0940)

Requesting a fresh Codex review at the round-3 exact head (`414cf0d5`)
surfaced one more real P1 in round 3's own `claimed_at` fix, fixed here:

6. **`claimed_at` is not durable across a failed attempt.**
   `DatabaseOutboxRepository.markFailed()`
   (`packages/db/src/runtime-repositories.ts`) explicitly clears
   `claimed_at`/`claimed_by` on a failed delivery attempt, in the same
   `UPDATE` that increments `attempt_count` (never reset) and bumps
   `updated_at`. A worker that resumes after parking, claims a row, and
   fails to deliver it leaves `claimed_at` null again -- round 3's
   `claimed_at`-only check would miss this entirely until the row aged past
   the 30-minute stuck-retryable window. Fixed by splitting into two
   independent, durable checks: `claimed_at > observedAt` (catches success
   or a still-outstanding claim) OR (`attempt_count > 0` AND `updated_at >
   observedAt`) (catches a claim that failed and cleared `claimed_at`,
   using the field `markFailed` never resets). `recap-service.ts` still
   cannot trigger the second check either, since it never touches
   `attempt_count`. Measured field renamed
   `post_parking_claimed_count`/`post_parking_failed_attempt_count` (from
   the single `post_parking_activity_count`) to name each signal
   distinctly. One existing test updated for the rename; one new test added
   asserting the failed-claim scenario (`claimed_at` absent, `attempt_count
   > 0` + `updated_at` present) still triggers `parked_drift`.

`pnpm type-check`, `pnpm lint` clean; `npx tsx --test
scripts/ops/readiness-refresh.test.ts` 37/37 passing. Full `pnpm test:ops`
deferred to CI on this commit: local environment is under severe memory
pressure from an unrelated VS Code file-watcher process (8.7GB RSS,
unrelated to this change) -- an earlier commit of this same function
already confirmed 1906/1906.

## Round 5 remediation (post-fifth-review, exact-head f2561b9bb8951ce2aced5db906e47b1d0ae8fc2f)

Requesting a fresh Codex review at the round-4 exact head (`7cfbf654`)
surfaced a finding that disproved round 4's own premise, fixed here:

7. **`attempt_count` is not worker-exclusive either.**
   `apps/api/src/recap-service.ts`'s `recordRecapDeliveryFailure()` calls
   `outbox.markFailed()` on a transient Discord delivery failure -- the
   exact same `OutboxRepository` method the worker calls
   (`packages/db/src/runtime-repositories.ts`), which increments
   `attempt_count` and bumps `updated_at` identically regardless of caller.
   Round 4's assumption that "recap-service never touches `attempt_count`"
   was simply wrong. An exhaustive grep across `apps/*/src` confirms
   `distribution-worker.ts` and `recap-service.ts` are the **only two**
   callers of any `OutboxRepository` write method in the entire codebase --
   there is no column on `distribution_outbox` itself (`status`,
   `attempt_count`, `claimed_at`, `claimed_by`, `updated_at`,
   `next_attempt_at`) that can distinguish which of the two called it,
   because both paths funnel through the identical repository methods.
   Three straight rounds (1, 4, and this one) chased a distinction that
   does not exist at that layer.

   Fixed by abandoning the outbox-column approach entirely and using the
   one signal that genuinely is worker-exclusive:
   `apps/worker/src/distribution-worker.ts:164` creates a `system_runs` row
   with `run_type='distribution.process'` at the moment of claim --
   *before* success or failure is even known -- via
   `repositories.runs.startRun()`. `recap-service.ts` never calls
   `repositories.runs.startRun` anywhere; it has no run-tracking
   integration at all. Querying `system_runs` where `run_type =
   'distribution.process'` and `started_at > receipt.observedAt` catches a
   post-parking claim regardless of whether it later succeeds or fails,
   with a single check instead of two. `measured` field renamed
   `post_parking_claimed_count`/`post_parking_failed_attempt_count` (round
   4's two-signal design) to the single `post_parking_worker_run_count`.

   Tests collapsed from 3 to 2: one asserts a post-parking
   `distribution.process` run triggers `parked_drift` even with zero stuck
   outbox rows; one asserts recap-service's outbox writes (zero
   `distribution.process` rows) never trigger it, regardless of how much
   outbox activity they produce.

`pnpm type-check`, `pnpm lint` clean; `npx tsx --test
scripts/ops/readiness-refresh.test.ts` 36/36 passing (net count unchanged;
3 tests collapsed into 2). Full `pnpm test:ops` again deferred to CI --
same local memory constraint, unrelated to this change.

## Round 6 remediation (post-sixth-review, exact-head 6a597e8d6d308c8356b010218ab5452d534080e4)

Requesting a fresh Codex review at the round-5 exact head (`4cf51766`)
surfaced one more real gap, fixed here -- and one false start that was
caught and reverted before landing:

8. **`system_runs.run_type='distribution.process'` alone misses stale-claim
   reaping.** `apps/worker/src/runner.ts`'s `runWorkerCycles` reaps stale
   claims via a SEPARATE step (`reapStaleClaims`, called before
   `processNextDistributionWork` in the same cycle) that resets a stale row
   to fresh `pending` -- clearing any stuck-ness AND `claimed_at` -- and
   creates no `system_runs` row at all. Round 5's check would silently miss
   this.

   **First attempt (reverted): filter `audit_log` on `actor !=
   'recap-service'`.** Every worker action that resolves (success, failure,
   skip, reap) calls `repositories.audit.record` with a real worker-instance
   actor, so this seemed like the general safety net needed. Reverted after
   querying real production `audit_log` data live (read-only, zero risk):
   the `distribution_outbox` actor space is large and unstable --
   `recap-service`, plus the submission/promotion pipeline (`submission`,
   `requeue`), plus a long tail of one-off T1/T2 live-DB-proof-lane actor
   names (`command-center-proof-*`, `utv2-###-*`,
   `codex-incident-validation`, etc.) that appear for every new proof run.
   An actor denylist chases an ever-growing list; an allowlist of the
   observed worker actors (`worker-dev`/`worker-prod`) is just as fragile
   against a future `workerId` naming change.

   **Actual fix: a second code-path-exclusive signal, not an actor
   check.** `audit_log.action = 'distribution.reaped_stale_claim'` is the
   literal action string only `runner.ts`'s `reapStaleClaims` ever passes to
   `audit.record` (confirmed the only call site of this exact string in the
   codebase by grep) -- structurally impossible for any other caller to
   produce regardless of what it names itself as an actor. Combined with
   round 5's `system_runs` check, these two signals now cover every worker
   code path with no actor-taxonomy dependency. `measured` fields renamed
   `post_parking_claimed_count`/`post_parking_worker_audit_count` ->
   `post_parking_worker_run_count`/`post_parking_stale_claim_reap_count`.
   One new test added for the reap scenario; the recap-scheduler
   negative-case test updated to assert both fields are zero.

`pnpm type-check`, `pnpm lint` clean; `npx tsx --test
scripts/ops/readiness-refresh.test.ts` 37/37 passing. Full `pnpm test:ops`
deferred to CI again -- local memory pressure has since maxed out swap
entirely (8.0/8.0GB), independent of and unrelated to this narrowly-scoped
change.

## Round 7 remediation (post-seventh-review, exact-head 19bfe4ca06e97f6c406d3a9c37190c919982d269)

Requesting a fresh Codex review at the round-6 exact head (`84b84a09`)
surfaced one more real gap, fixed here:

9. **The round-6 `audit_log` write is not atomic with the reap it
   records.** `apps/worker/src/runner.ts`'s `reapStaleClaims` calls
   `repositories.outbox.reapStaleClaims` (the actual row mutation) and only
   THEN `await`s `repositories.audit.record(...)` for each reaped row. If
   that later audit write throws -- a real possibility, for the same class
   of reason the worker's own heartbeat write is already documented as
   best-effort -- the row has already been reset to fresh `pending` with no
   corresponding `audit_log` entry. Round 6's check would silently miss
   exactly the case it was built to catch.

   Fixed by reading `packages/db/src/runtime-repositories.ts`'s real
   (Supabase-backed) `reapStaleClaims` implementation directly: it sets
   `last_error: reason` (`reason` = `"stale claim reaped by
   ${workerId}"`) in the **same** `UPDATE` statement that clears
   `claimed_at`/`claimed_by` and bumps `updated_at` -- before the caller
   ever gets to the separate `audit.record` call. Querying
   `distribution_outbox.last_error` directly is therefore atomic with the
   mutation itself, with no dependency on a second write succeeding.

   This required a small, generically useful addition to the query layer:
   a `'like'` `DbFilter` operator (Supabase/PostgREST already exposes
   `.like()` natively; the wrapper's `applyFilters` switch just needed the
   case added). The check is now
   `distribution_outbox.last_error LIKE 'stale claim reaped by%' AND
   updated_at > receipt.observedAt`. `recap-service.ts`'s own `markFailed`
   calls set `last_error` to an arbitrary delivery-error string (e.g. `"HTTP
   500"`), never this literal reap-specific prefix, so the negative case is
   unaffected. One existing test updated to use this new fixture shape; the
   recap-scheduler negative test's comment updated to explain why its
   `last_error` values never match.

`pnpm type-check`, `pnpm lint` clean; `npx tsx --test
scripts/ops/readiness-refresh.test.ts` 37/37 passing (net count unchanged --
one test updated, not added). Full `pnpm test:ops` deferred to CI again --
local memory pressure has partially recovered (swap 4.0/8.0GB, down from
fully exhausted) but remains elevated.

## Round 8 remediation (post-eighth-review, exact-head 2be41dd8b2bc5455e14fbf4a5804b55e380f5c7c)

Requesting a fresh Codex review at the round-7 exact head (`2be41dd8`)
surfaced one more real gap, fixed here:

10. **`resolveParkedContractReceipt` only considered `deploy.yml` runs on
    `main`.** `.github/workflows/deploy.yml`'s `workflow_dispatch` trigger
    (lines 3-13) carries no `branches:` restriction -- it can be manually
    dispatched from any branch or tag, and that run performs the exact same
    production container replacement as a main-triggered one. A
    `{ branch: 'main' }` filter on the `latestRun('deploy.yml', ...)` call
    would be blind to a newer, non-main-ref run that already mutated
    production: it could keep trusting a stale main-branch receipt as
    `parked_verified` while a genuinely active (or dead) non-main deployment
    exists, or misreport a healthy non-main deployment as drift.

    Fixed by dropping the branch filter entirely --
    `ctx.github.latestRun('deploy.yml')` now considers the newest run across
    every ref. The pre-existing `status`/`conclusion` check (only trust a
    `completed`+`success` run) is unchanged and still the first line of
    defense against a newer non-success run. `probeDeploySha`'s own,
    separate `{ branch: 'main', status: 'success' }` call was deliberately
    left untouched -- that dimension (`deploy_sha_alignment`) has legitimately
    different semantics: it compares the deployed SHA specifically against
    `main`'s HEAD, not "what is the newest thing that touched production."
    One new test added asserting the `latestRun('deploy.yml', ...)` call
    receives no `options` argument at all, and that a run standing in for a
    non-main dispatch is still trusted as the parked receipt's source of
    truth.

`pnpm type-check`, `pnpm lint` clean; `npx tsx --test
scripts/ops/readiness-refresh.test.ts` 38/38 passing (37 + 1 new). Full
`pnpm test:ops` deferred to CI again -- local memory pressure has gotten
worse, not better, since round 7 (swap now 6.4/8.0GB used, down from a
partial recovery to 4.0/8.0GB; same unrelated VS Code file-watcher process
confirmed still the cause via `ps aux --sort=-%mem`, now 8.69GB RSS).

## Round 9 remediation (post-ninth-review, exact-head a315217eb39deef7d824ab5eb21880be050a6979)

Requesting a fresh Codex review at the round-8 exact head (`4e1abf8a`)
surfaced one real, in-scope P1 (fixed here) and one real, out-of-scope P1
(tracked separately, not silently dropped):

11. **Three post-parking activity checks compared ISO timestamp strings
    lexically instead of chronologically.** `cycleStartedAt >
    receipt.observedAt`, `mergedAt > receipt.observedAt`, and `heartbeatAt >
    receipt.observedAt` all used JS's `>` operator directly on timestamp
    strings. This is unsafe when precision differs: `receipt.observedAt` is
    whole-second (as `deploy.yml`'s receipt writer emits it, e.g.
    `...T11:00:00Z`), while Postgres-sourced timestamps commonly carry
    milliseconds (e.g. `...T11:00:00.500Z`). Because `'.'` (0x2E) sorts
    before `'Z'` (0x5A), a millisecond-precision timestamp genuinely AFTER a
    whole-second one can still compare as lexically *smaller* -- silently
    misclassifying real post-parking activity as `parked_verified` instead
    of `parked_drift`.

    Fixed by adding an `isAfter(a, b)` helper that parses both sides to
    epoch millis (`new Date(x).getTime()`) before comparing, used at all
    three call sites. One new test proves the exact failure mode: a DB
    timestamp 500ms after a whole-second `receipt.observedAt` is correctly
    detected as drift (it would have been missed by the old lexical
    comparison).

12. **Worker resume can be invisible to readiness-refresh in a narrow
    combination.** `apps/worker/src/runner.ts`'s per-cycle `worker.heartbeat`
    write is explicitly best-effort/non-fatal on failure, and several
    per-target paths in the same cycle loop (circuit-open, kill-switch-
    engaged, target-disabled) `continue` without ever calling
    `processNextDistributionWork` -- producing neither a
    `distribution.process` run nor a stale-claim-reap marker. If a worker
    resumes and, for some run of cycles, every target hits a skip branch
    AND the heartbeat insert itself fails, the resumed worker produces zero
    durable signal readiness-refresh can observe.

    Not fixed here -- this is a worker-runtime durability question (making
    the heartbeat write non-best-effort, or adding a new always-fired
    cycle-start marker), and `apps/worker/src/runner.ts` is outside this
    lane's locked scope (`file_scope_lock` covers `readiness-refresh.ts`/
    `.test.ts` + the two workflow files only). Filed as UTV2-1662 for its
    own lane, per the same pattern already used for the two P2s tracked in
    round 7's summary.

`pnpm type-check`, `pnpm lint` clean; `npx tsx --test
scripts/ops/readiness-refresh.test.ts` 39/39 passing (38 + 1 new). Full
`pnpm test:ops` deferred to CI again -- local memory pressure remains
elevated (swap 6.2/8.0GB used), same unrelated VS Code file-watcher
process.

## Round 10 remediation (post-tenth-review, exact-head a315217eb39deef7d824ab5eb21880be050a6979)

Requesting a fresh Codex review at the round-9 exact head (`bd4e3ace`)
surfaced one more real P1, fixed here:

13. **`GithubReader.latestRun` trusted GitHub's default run ordering
    (by creation time), not by when a run last actually executed.**
    When an OLDER `deploy.yml` run is manually re-run after a newer run
    already completed, GitHub Actions adds another attempt to that SAME
    run object (bumping its `updated_at`) rather than creating a new
    workflow-run entry -- and that attempt can still execute the
    production-promotion logic. A `per_page=1` query relying on position
    0 would keep returning the genuinely newer (but never re-run) run
    and stay blind to the older run's re-execution being the most recent
    thing that actually mutated production -- potentially reporting its
    stale receipt as `parked_verified` while a fresher, differently-
    stated re-run had already changed things.

    Fixed by fetching a bounded page of candidates (`per_page=20`) and
    selecting the one with the latest `updated_at` via a new, directly-
    testable `selectMostRecentlyUpdatedRun()`, instead of trusting list
    position. This required extracting the selection into its own pure
    function since the real `latestRun` implementation calls the `gh`
    CLI directly and isn't mockable in these tests -- the same pattern
    already used for `isAfter()`. Three new tests: an older-but-
    recently-updated run wins over a newer-but-untouched one; empty list
    returns null, never throws; single-run list returns that run.

`pnpm type-check`, `pnpm lint` clean; `npx tsx --test
scripts/ops/readiness-refresh.test.ts` 42/42 passing (39 + 3 new). Full
`pnpm test:ops` deferred to CI again -- local memory pressure spiked
back up after a brief full recovery (swap 6.3/8.0GB used), same
unrelated VS Code file-watcher process.

## Round 11 remediation (post-eleventh-review, exact-head a315217eb39deef7d824ab5eb21880be050a6979)

Requesting a fresh Codex review at the round-10 exact head (`559bb788`)
surfaced one more real, subtle P1, fixed here:

14. **A parked-contract receipt could belong to an earlier attempt than
    the run's current one.** `deploy.yml`'s receipt is uploaded by the
    `promote` job, its artifact name suffixed with `github.run_attempt`
    as of when `promote` executed. GitHub's failed-jobs-only rerun
    (re-running only a failed downstream job like `smoke`, which
    `needs: promote`) bumps the RUN's own `run_attempt` and `updated_at`
    WITHOUT re-running `promote` -- no new receipt artifact is produced
    for that later attempt. Round 10's `updated_at`-based run selection
    could pick such a run (its `smoke`-only rerun makes it look like the
    most recently executed run), and `latestArtifactJson`'s prefix-only
    match would then silently fall back to the earlier attempt's
    receipt -- which no longer necessarily describes what most recently
    touched production.

    Fixed by adding `run_attempt` to `WorkflowRun` and an optional
    `expectedAttempt` parameter to `latestArtifactJson`;
    `resolveParkedContractReceipt` now passes the selected run's own
    `run_attempt`, so a receipt-attempt mismatch is treated as
    unavailable (falls through to the unchanged active-mode path)
    rather than silently trusting a stale attempt's receipt. New test:
    a run at attempt 2 with a receipt available only for attempt 1
    correctly refuses `parked_verified`.

`pnpm type-check`, `pnpm lint` clean; `npx tsx --test
scripts/ops/readiness-refresh.test.ts` 43/43 passing (42 + 1 new). Full
`pnpm test:ops` deferred to CI again -- local memory pressure remains
elevated (swap 6.4/8.0GB used), same unrelated VS Code file-watcher
process.

## Round 12 remediation (post-twelfth-review, exact-head a315217eb39deef7d824ab5eb21880be050a6979)

Requesting a fresh Codex review at the round-11 exact head (`cc95a8f3`)
surfaced two more real findings, both fixed here:

15. **A single `per_page=20` page could exclude a manually re-run OLDER
    run entirely.** If more than 20 newer-by-created_at runs exist,
    round 10's `selectMostRecentlyUpdatedRun` would never even see an
    older run whose downstream job was just rerun -- it wasn't in the
    fetched page at all. Fixed by paginating up to a bounded 5 pages of
    100 (deploy.yml is a manually/production-triggered workflow, not
    high-frequency CI, so this bound is deliberately generous, not a
    silent truncation -- documented in code as such).

16. **`probeDeploySha` trusted a selected run's `head_sha` directly, with
    no attempt-verification.** Unlike the parked-receipt path (round 11,
    which already checks the artifact belongs to the run's current
    attempt), this dimension had no equivalent check. A failed-jobs-only
    rerun of a downstream job (`smoke`, `needs: promote`) can advance a
    run's current attempt and `updated_at` WITHOUT re-running `promote`
    -- the actual production-mutating step -- so trusting `head_sha`
    from a run selected purely by `updated_at` could report the wrong
    SHA as currently deployed.

    Fixed by adding `jobConclusionForAttempt()` to `GithubReader` and
    verifying `deploy.yml`'s `promote` job (real GitHub display name
    `"Promote production"`, not the YAML job id `promote` -- confirmed
    by reading the workflow's `name:` override) succeeded in the
    selected run's current attempt before trusting its `head_sha`; a
    mismatch is now `unreadable`, never silently wrong. New test: a run
    at attempt 2 where `promote` only ran in attempt 1 correctly refuses
    to trust that run.

Finding 15's pagination loop is real-`gh`-CLI code with no synthetic
unit-test path (same limitation as prior rounds); its correctness rests
on `selectMostRecentlyUpdatedRun`'s existing tests, which already prove
the selection logic generalizes to any candidate count.

`pnpm type-check`, `pnpm lint` clean; `npx tsx --test
scripts/ops/readiness-refresh.test.ts` 44/44 passing (43 + 1 new). Full
`pnpm test:ops` deferred to CI again -- local memory pressure hit full
swap exhaustion mid-round (8.0/8.0GB) then partially recovered
(7.9/8.0GB), same unrelated VS Code file-watcher process.

## Round 13 remediation (post-thirteenth-review, exact-head a315217eb39deef7d824ab5eb21880be050a6979)

Requesting a fresh Codex review at the round-12 exact head (`68b1d87d`)
surfaced two P1s and a P2, all fixed here:

17-18. **`staleUnknown`/`stuckRetryable` (active-mode threshold
    counters) fed into the parked branch's drift detection unbounded.**
    A row already stuck in `processing` BEFORE parking, left untouched
    by parking itself, eventually crosses the 5m/30m active-mode
    threshold purely by the clock running while parked -- producing a
    false `PARKED_DRIFT` with no real post-parking activity. Separately,
    if `claimNextAtomic()` succeeds but the following (separate,
    non-atomic) `runs.startRun()` fails transiently, no existing signal
    caught a live post-parking claim during its first 5 minutes (not yet
    "stale," and no `system_runs` row exists to check). Fixed by
    removing `staleUnknown`/`stuckRetryable` from the parked branch and
    replacing them with a single time-scoped `liveClaimsSinceParking`
    check (`status='processing' AND claimed_at > receipt.observedAt`) --
    catches live post-parking claims immediately, independent of
    staleness age or whether the run-record write succeeded, without
    false-triggering on pre-existing backlog. Two new tests: a
    pre-parking stuck row aging past threshold no longer false-triggers
    drift; a live claim within the first 5 minutes correctly triggers
    drift.

19. **`probeCiVerify` shared `latestRun`'s round-10 `updated_at`-based
    selection**, correct for deployment history (a re-executed older run
    can genuinely be the most recent thing that mutated production) but
    wrong for "the run for this specific commit" -- an unrelated older
    `ci.yml` run's manual rerun could shadow a newer, already-passing run
    for the actual current HEAD. Fixed by adding an optional `headSha`
    filter to `latestRun` (server-side `head_sha` query param), and
    having `probeCiVerify` resolve main's SHA before scoping its run
    lookup to it. New test proves the lookup is called with `headSha`
    bound to the resolved main HEAD.

`pnpm type-check`, `pnpm lint` clean; `npx tsx --test
scripts/ops/readiness-refresh.test.ts` 47/47 passing (44 + 3 new). Full
`pnpm test:ops` deferred to CI again -- local memory pressure remains
elevated (swap 6.8/8.0GB used), same unrelated VS Code file-watcher
process.

## Round 14 remediation (post-fourteenth-review, exact-head a315217eb39deef7d824ab5eb21880be050a6979)

Requesting a fresh Codex review at the round-13 exact head (`8bde6b79`)
surfaced one more P1 and one more P2, both fixed here:

20. **`probeDeploySha` gave up `unreadable` at the very first candidate**
    when its current attempt hadn't run `promote`, even though an OLDER
    candidate's own current attempt genuinely had -- leaving the
    blocking `deploy_sha_alignment` dimension stuck at UNKNOWN until
    another deployment, discarding a recoverable answer. Fixed by adding
    `listRunsByRecency()` to `GithubReader` (the full paginated
    candidate list, newest-`updated_at`-first, sharing the exact same
    `fetchCandidateRuns` pagination `latestRun` already uses) and
    walking it past non-promoting attempts to the first candidate that
    genuinely mutated production; only failing `unreadable` if none of
    the bounded candidates show a successful `promote`. New test: a
    non-promoting newest candidate is correctly skipped in favor of an
    older genuine deploy.

21. **An unreadable kill-switch recheck (`killSwitchNow === null`) was
    folded into `driftReasons`** alongside a confirmed `false` result,
    producing `status: 'fail'`, `runtime_state: 'parked_drift'`,
    `unreadable_reason: null` -- a false RED reported as fully observed,
    when the real problem was "we couldn't check," not "we checked and
    it's bad." Fixed by tracking `killSwitchNow === null` separately: it
    now downgrades the dimension to `unknown` only when no OTHER signal
    already proves genuine drift on its own; a real drift finding from
    another check (e.g. the worker heartbeat ran after parking) still
    reports `fail`/`parked_drift` regardless of kill-switch readability.
    Two new tests: kill-switch-unreadable-alone is `unknown`, never a
    confident `parked_drift`; kill-switch-unreadable does NOT suppress a
    genuinely confirmed drift finding from another signal. One existing
    test updated to match the corrected `unknown`-vs-`fail` distinction.

`pnpm type-check`, `pnpm lint` clean; `npx tsx --test
scripts/ops/readiness-refresh.test.ts` 49/49 passing (47 + 2 new, 1
updated). Full `pnpm test:ops` deferred to CI again -- local memory
pressure remains elevated (swap 7.4/8.0GB used), same unrelated VS Code
file-watcher process.

## Round 15 remediation (post-fifteenth-review, exact-head a315217eb39deef7d824ab5eb21880be050a6979)

Requesting a fresh Codex review at the round-14 exact head (`3a190143`)
surfaced two more real P1s, both fixed here:

22. **Round 14's fallback-search checked only a candidate's CURRENT
    attempt for `promote`, not every attempt.** If `promote` succeeded in
    attempt 1 but a LATER failed-jobs-only rerun of `smoke` alone
    created attempt 2 (which never re-runs `promote`), round 14 rejected
    the ENTIRE run and fell through to an older, less accurate
    candidate -- even though attempt 1 is exactly what changed
    production and this run's own `head_sha` is still correct. Fixed by
    searching every attempt of a candidate (current down to 1) before
    moving to the next candidate. One existing round-12 test corrected:
    its stub was accidentally modeling this exact scenario (attempt 1
    succeeding while attempt 2 doesn't) and asserted `unknown` when the
    correct outcome is `pass`. New test proves the within-run
    multi-attempt search finds attempt 1's success without falling
    through to an older candidate.

23. **`apps/ingestor/src/index.ts` calls `reapStaleRuns()` BEFORE
    `runIngestorCycles()` on every startup.** The real DB implementation
    (`packages/db/src/runtime-repositories.ts`) updates ONLY
    `status='failed'` and `finished_at` on a stale row -- never
    `started_at`. An accidentally-resumed ingestor whose first action is
    this reap (or that crashes/delays before completing a first new
    cycle) would leave `cycleStartedAt` still reflecting the OLD,
    pre-parking value -- genuine post-parking DB activity the
    `started_at`-only check misses. Fixed by adding a
    `finished_at`-after-parking check on `ingestor.cycle` `system_runs`
    rows, which catches this reap (or any cycle completion) regardless
    of whether `started_at` was ever touched. New test proves a
    reap-style mutation (fresh `finished_at`, stale `started_at`)
    correctly triggers `parked_drift`.

`pnpm type-check`, `pnpm lint` clean; `npx tsx --test
scripts/ops/readiness-refresh.test.ts` 51/51 passing (49 + 2 new, 1
corrected). Full `pnpm test:ops` deferred to CI again -- local memory
pressure remains elevated (swap 7.6/8.0GB used), same unrelated VS Code
file-watcher process. Self-caught and corrected mid-round: a stray `cd`
into the root checkout while reading `apps/ingestor/src/index.ts`
silently redirected subsequent shell commands away from this worktree
(a known pattern) -- caught via an anomalous test count (21 instead of
49) before any commit landed in the wrong place; no bad state was ever
pushed.

## Round 16 remediation (post-sixteenth-review, exact-head 3c1133996b85684e102173e6f59e106965d596ce)

Requesting a fresh Codex review at the round-15 exact head (`cb0faf40`)
surfaced one more real P1, fixed here:

24. **`candidates` is ordered by run-level `updated_at`, which an unrelated
    downstream job's rerun can bump without touching `promote` at all.**
    Rounds 10/14 select/walk `deploy.yml` candidates by `updated_at`; round
    15 widened the per-candidate promote check to search every attempt.
    But an OLDER run whose `promote` succeeded long ago, if later given a
    smoke-only rerun (bumping only that run's `updated_at`), would still
    outrank a genuinely NEWER run whose `promote` actually completed more
    recently in real wall-clock time -- the round-14/15 early-exit-on-first-
    promoted-candidate logic would pick the older run's `head_sha`, reporting
    it as currently deployed even though the newer run was the last one to
    actually execute `promote`, potentially making the blocking
    `deploy_sha_alignment` dimension falsely RED (or falsely GREEN against
    the wrong SHA).

    Fixed by changing `GithubReader.jobConclusionForAttempt` to return the
    promote job's own `completedAt` alongside its `conclusion` (GitHub's
    `.../attempts/{attempt}/jobs` response already carries `completed_at`).
    `probeDeploySha` now collects every candidate whose `promote` succeeded
    in any attempt (still searching current-attempt-down-to-1 per candidate,
    per round 15), then selects the single candidate whose `promote` job's
    own `completedAt` is most recent across the entire set -- not the first
    one encountered in `updated_at` recency order. `measured.deploy_run_completed_at`
    and the age/evidence text now report the promote job's own completion
    time, not the run's `updated_at`, since round 16's own finding is that
    the latter is not trustworthy for this purpose. New test proves the
    exact scenario: an older run's `promote` succeeded 120 minutes ago (its
    `updated_at` bumped to 1 minute ago by an unrelated rerun) does not beat
    a newer run whose `promote` completed 15 minutes ago -- the newer run's
    `head_sha` wins.

`pnpm type-check`, `pnpm lint` clean; `npx tsx --test
scripts/ops/readiness-refresh.test.ts` 52/52 passing (51 + 1 new). Full
`pnpm test:ops` deferred to CI again -- local memory pressure remains
elevated (swap near-exhausted), same unrelated VS Code file-watcher process.

## Round 17 remediation (post-seventeenth-review, exact-head 6308d91c329b61c0d7dbf5f07acbcf9b7e5d506a)

Requesting a fresh Codex review at the round-16 exact head (`3be07234`)
surfaced one P2 (no P1s remained), fixed here:

25. **The kill-switch-unreadable-alone path returned the generic
    `unreadable()` helper directly, whose `measured` is always `null`.**
    Every other unreadable path in this file (both `probeIngestorHealth`'s
    and `probeWorkerOutboxHealth`'s generic `catch` blocks) wraps the
    result with `measured: { runtime_state: 'unreadable' }` so a consumer
    can distinguish an observer failure from `active_failed`/`parked_drift`
    at the field level, not just via the coarser `status: 'unknown'`. This
    one call site (the `killSwitchUnreadable` branch inside
    `probeWorkerOutboxHealth`'s parked-mode branch) was the one place that
    didn't follow that pattern. Fixed to match. One existing test (round
    14's kill-switch-unreadable-alone test) extended with a positive
    assertion that `measured.runtime_state === 'unreadable'`.

`pnpm type-check`, `pnpm lint` clean; `npx tsx --test
scripts/ops/readiness-refresh.test.ts` 52/52 passing (net count unchanged --
one test extended, not added). Full `pnpm test:ops` deferred to CI again --
local memory pressure remains elevated, same unrelated VS Code file-watcher
process.

## Round 18 review (investigated, refuted with live evidence, no code change -- exact-head unchanged at 8d05d7d3da8b39fde8190fe40c7f72e47f304d40)

Requesting a fresh Codex review at the round-17 exact head (`8d05d7d3`)
surfaced one P1 claim, investigated and refuted rather than blindly applied:

**Claimed:** `actions/upload-artifact@v4` excludes hidden files by default
unless `include-hidden-files: true` is set; since the parked-contract
receipt lives under `.out/` (a hidden directory), the upload would find no
eligible file and `if-no-files-found: error` would fail the promote job
after production is already mutated, with no receipt ever produced.

**Investigated against live evidence, not just the general v4 changelog
claim:** the exact same pattern (`path: .out/<file>.json`, no
`include-hidden-files`, `if-no-files-found: error`) already exists in
`ci.yml`'s pre-existing `ci-db-proof-receipt` upload (unrelated to this
lane). A real, recent successful `ci.yml` run on main (run `30732146417`,
SHA `75280b8b`) was checked directly via `gh api`/`gh run download`: the
`utv2-1630-db-proof-receipt-30732146417-1` artifact was produced
successfully (1452 bytes) and downloads to the real receipt JSON content,
not empty or missing. `actions/upload-artifact@v4`'s hidden-file exclusion
applies to glob-pattern matching (wildcard segments don't traverse into
dot-directories by default); an explicit literal path segment like `.out`
(no wildcard) is matched directly and is not excluded -- confirmed
empirically, not just by re-reading documentation.

**Not applied as a fix.** The finding does not reproduce against this
repo's actual usage pattern, and the identical pattern is already proven
working in production CI. Posted as a reply on the review thread
(https://github.com/griff843/Unit-Talk-v2/pull/1365#discussion_r3698535321)
with the same evidence, rather than silently dismissing it. The code
commit remains `8d05d7d3da8b39fde8190fe40c7f72e47f304d40` (round 17's
commit, unchanged) since no remediation was warranted.

## Round 19-20 remediation (PM review of exact-head 4b2fae0157b2c3f09b7d35c9ca584bd56ade140e)

An automated Codex review at that same exact head (round 19) returned zero
findings. The PM then performed an independent exact-head review of the
same commit and posted `PM_VERDICT: CHANGES_REQUIRED` with one real P1 and
two governance findings, all addressed here:

26. **P1 -- live kill-switch verification fails open when a required
    target row is missing.** `verifyKillSwitchesEngagedNow()` counted rows
    where `killed=false` for `best-bets`/`trader-insights` and returned
    `true` (engaged) when both counts were zero. A MISSING target row also
    produces a zero count for that query, so an absent
    `delivery_kill_switch` record could be silently certified as engaged --
    the exact fail-open gap this lane's entire `parked_verified` contract
    depends on kill switches NOT having. Fixed by requiring, for each
    required target: exactly one row exists (`countRows` on the target
    alone, not `killed=false`) AND that row's own `killed` column reads as
    strictly `true` (`latestRow`, not a count). Missing (zero rows),
    duplicate (more than one row), or a value that isn't literally `true`
    (malformed) all now fail closed, identically to an unreadable query.
    Three new tests: a missing target row, duplicate target rows, and a
    malformed (`null`) `killed` value each correctly report `parked_drift`
    with `kill_switch_reverified_engaged: false`, never `parked_verified`.

27. **Governance -- Branch Discipline red (three commit messages
    referenced UTV2-1640/1647/1662 alongside UTV2-1660).** Addressed by
    squashing this branch's full history to a clean, UTV2-1660-only set of
    commits (see the "Branch history note" above) -- not a code or logic
    change, a branch-hygiene remediation.

28. **Governance -- File Scope Lock red (`readiness-refresh.yml` added
    after the trusted first-commit scope snapshot).** Resolved as a side
    effect of the branch-history squash: the new first commit
    (`chore(lanes): UTV2-1660 start lane`) declares the lane manifest's
    `file_scope_lock` with the FULL, final file list (including
    `readiness-refresh.yml` and `docs/06_status/proof/UTV2-1660/.gitkeep`,
    the latter caught by a follow-up `Return review packet` scope check
    after the first squash push), so the trusted first-committed snapshot
    is now accurate and complete without needing a manual scope-override.
    Confirmed green: `File scope lock` and `Check issue references` both
    passed on the squashed head.

`pnpm type-check`, `pnpm lint` clean; `npx tsx --test
scripts/ops/readiness-refresh.test.ts` 55/55 passing (52 + 3 new).

## Round 21 remediation (post-twenty-first-review, exact-head 003880750b7a7eafe4ba8954e624c1402f215631)

A fresh Codex review at the round-20 exact head (`11dcc7ce`) surfaced one
more real P1, fixed here:

29. **`probeDeploySha`'s candidate fetch excluded any deploy.yml run whose
    OVERALL conclusion was failure, even if `promote` itself had succeeded.**
    The real `listRunsByRecency('deploy.yml', { branch: 'main', status:
    'success' })` call passed `status: 'success'` straight through to
    GitHub's REST API as a server-side filter on the run's aggregate
    conclusion. A run where `promote` succeeds (mutating production) but a
    later, unrelated downstream job (`smoke`) fails turns the WHOLE
    workflow run's conclusion to `failure` -- that run would never even
    appear in `candidates`, so its genuine production mutation would be
    silently invisible to this dimension, never reaching the existing
    per-attempt `jobConclusionForAttempt(promote)` check that was supposed
    to be the actual arbiter of trust.

    Fixed by dropping the `status` filter from this call entirely --
    `candidates` now includes every deploy.yml run on `main` regardless of
    overall conclusion, and the pre-existing per-candidate/per-attempt
    promote-job check (rounds 12/14/15/16 unchanged) is what decides
    whether a given attempt actually mutated production, never the run's
    own aggregate `status`/`conclusion` fields (which this code path never
    reads at all). The `candidates.length === 0` and
    `promotedCandidates.length === 0` fail-message wording was also
    corrected to no longer claim "successful" runs specifically, since
    candidates are no longer pre-filtered that way. New regression test:
    a run stubbed with `conclusion: 'failure'` overall (representing a
    passed `promote` + failed `smoke`) is still trusted as the deployed
    SHA, proven by asserting `measured.deployed_sha` matches that run's
    `head_sha` and `status` is `'pass'` when it aligns with main HEAD.

`pnpm type-check`, `pnpm lint` clean; `npx tsx --test
scripts/ops/readiness-refresh.test.ts` 56/56 passing (55 + 1 new).

## ASSERTIONS:

- [x] `parked_verified` is a distinct literal value from `active_healthy`; evidence text explicitly states it is not ordinary active health.
- [x] `parked_drift` is a hard failure (`status: 'fail'`), triggered independently by: receipt-flag mismatch, post-parking ingestor/merge activity, post-parking worker heartbeat, post-parking outbox claim/attempt activity, and a live kill-switch re-check disagreeing with the receipt.
- [x] The exact pre-existing active-mode threshold logic (same failures[] computation, same evidence strings) is unchanged and is what runs whenever parked evidence is unavailable or mode is active.
- [x] A receipt whose `releaseTag` doesn't match the run's own head SHA is never trusted.
- [x] Kill switches are re-verified live against `delivery_kill_switch`, never just read from the deploy-time receipt.
- [x] `pnpm type-check`, `pnpm lint` clean; `npx tsx --test scripts/ops/readiness-refresh.test.ts` 56/56 passing; `pnpm test:ops` 1906/1906 confirmed on an earlier commit of this same function (full re-run deferred to CI for this commit — local memory pressure from an unrelated process remains elevated).
- [x] `probeDeploySha` fetches every deploy.yml run on main regardless of overall workflow conclusion; a run whose `promote` job succeeded is trusted even if a downstream job (`smoke`) later failed and turned the whole run red.
- [x] `probeDeploySha` selects the deployed SHA by the `promote` job's own completion time across every candidate and attempt, never by run-level `updated_at` recency order or per-candidate early-exit — an unrelated downstream job's rerun bumping an older run's `updated_at` cannot shadow a genuinely newer run whose `promote` completed more recently.
- [x] Every unreadable-classification return path in this file sets `measured.runtime_state: 'unreadable'` (never a bare `measured: null`), so an observer failure is field-level distinguishable from `active_failed`/`parked_drift`/`parked_verified` everywhere, not just via the coarser `status: 'unknown'`.
- [x] The live kill-switch re-check requires exactly one authoritative row per required target with `killed` strictly `true`; a missing target row, duplicate target rows, or a malformed `killed` value all fail closed to `parked_drift`, never `parked_verified`.
- [x] All twenty-five in-scope Codex/PM-flagged P1s, plus one P2 (across twenty-one review rounds) fixed and covered by dedicated tests: post-parking ingestor activity is detected via `finished_at` even when a `reapStaleRuns()`-style mutation leaves `started_at` untouched; `probeDeploySha` searches every attempt (not just the current one) of a candidate for a genuinely successful `promote` before moving to an older candidate; an unreadable kill-switch recheck alone reports `unknown`, never a confident `parked_drift`, but does not suppress a genuinely confirmed drift finding from another signal; unbounded active-mode staleness counters no longer feed the parked-drift check (replaced with a time-scoped live-claim signal that also catches a claim whose run-record write failed); `probeCiVerify`'s run lookup is scoped to the resolved main HEAD so an unrelated older rerun cannot shadow it; `deploy.yml` runs are paginated (not a single per_page=20 page) so a manually re-run older run is never excluded from selection entirely; `probeDeploySha` verifies the selected run's `promote` job actually succeeded in that run's current attempt before trusting its `head_sha`, never just a downstream job's rerun; a parked-contract receipt must belong to the run's own current attempt, never an earlier attempt whose promote job ran before a later failed-jobs-only rerun of a downstream job; `actions: read` permission present; post-parking worker activity detected via TWO code-path-exclusive, atomically-written signals — `system_runs.run_type='distribution.process'` (main claim path) and `distribution_outbox.last_error LIKE 'stale claim reaped by%'` (the separate stale-claim-reap path, keyed to the same atomic UPDATE that clears `claimed_at`, not the non-atomic follow-up `audit_log` write) — deliberately NOT an actor-based filter, since real production data showed that space is large and unstable; never triggering on a legitimate parked-enabled scheduler's writes; the newest `deploy.yml` run must itself be a completed success before its receipt is trusted, never an older successful run while a newer non-success run exists; that newest-run lookup is never scoped to `main` given `deploy.yml`'s unrestricted `workflow_dispatch`; is selected by most-recent execution (`updated_at`) rather than list position, so a manually re-run older run is never missed; and all timestamp comparisons against `receipt.observedAt` are done as parsed epoch values, never lexical string comparison. One further P1 (worker resume invisible to readiness-refresh when the best-effort heartbeat write fails and every target hits a processing-skip branch) requires changes to `apps/worker/src/runner.ts`, outside this lane's locked scope — filed as UTV2-1662, not silently dropped.

## Verification

`pnpm type-check`, `pnpm lint`, and `npx tsx --test scripts/ops/readiness-refresh.test.ts`
were run in this lane worktree after every remediation round, most recently
round 21 (commit `003880750b7a7eafe4ba8954e624c1402f215631`): 56/56 tests
passing, type-check clean, lint clean. Full `pnpm test:ops` (1906/1906
confirmed on an earlier commit of this same function) is deferred to CI for
this exact commit per the memory pressure note below.

## EVIDENCE:

`pnpm verify` covers env:check + lint + type-check + build + test. Stages
were run individually in this worktree rather than as one invocation:

```text
$ pnpm type-check
(clean)

$ pnpm lint
(clean)

$ npx tsx --test scripts/ops/readiness-refresh.test.ts
# tests 56
# pass 56
# fail 0

$ npx tsx --test scripts/ci/deploy-parked-mode.test.ts
# tests 25
# pass 25
# fail 0

$ tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 9
Rules matched: (none)

$ pnpm test:ops
(deferred to CI for this exact commit -- local environment under severe
memory pressure from an unrelated VS Code file-watcher process, now 8.8GB
RSS with swap fully exhausted (8.0/8.0GB). 1906/1906 confirmed on an
earlier commit of this same function; this commit only changes the query
inside probeWorkerOutboxHealth's parked branch and its corresponding
tests, both re-verified above.)
```

## Scope

`.github/workflows/deploy.yml` (adds a receipt-file write + artifact upload
step after the existing production confirm step; no change to release,
promotion, or rollback logic), `.github/workflows/readiness-refresh.yml`
(adds `actions: read` to the scheduled job's `permissions` block),
`scripts/ops/readiness-refresh.ts`, `scripts/ops/readiness-refresh.test.ts`,
plus lane apparatus. No application, domain, package, or migration file
touched. No production dispatch, deploy, rollback, secret change, DB
mutation, or queue mutation is part of this lane.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
