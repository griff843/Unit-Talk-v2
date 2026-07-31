# PROOF: UTV2-1594

MERGE_SHA: 2cce459967197925c058d4b2dad77305bfe7cbb8

That SHA is a real ancestor — the `main` tip this lane branched from and
measured against, not a merge SHA that does not exist yet. It is rebound to this
PR's actual squash SHA post-merge by `post-merge-lane-close.yml`, which runs
`ops:proof-generate --merge-sha`.

## Summary

Two of the three subsystems in UTV2-1594 are implemented here. **Section B
(canonical PM amendment ingestion) is deliberately not implemented** — see
"Where section B is left" below.

### C — crash-safe full-verify semaphore

The reported incident: a stale slot left by a dead preflight process blocked
real work for 3+ hours while consuming about one second of CPU. The cause was
in the reclaim rule, not in the lock. `scripts/ops/preflight.ts` wrote a bare
`slot-N/owner.json` holding a pid and a timestamp, and the only reclaim signal
was `Date.now() - acquired_at > 6h`. A pid that died one second after acquiring
kept its slot for the full six hours, and the same rule would have cleared a
legitimately slow verifier the moment it crossed the threshold. The lock had no
concept of whether its owner was alive.

Reclaim is now **proof-based**. A slot is removed only when its owner is
provably gone; anything that cannot be proven dead is left alone and reported:

| Reclaimed (provably gone) | Never auto-reclaimed |
|---|---|
| `dead_owner` — pid not running on this host | `live` — pid running, heartbeat current |
| `pid_reused` — pid alive but a different process (start-time mismatch) | `live_heartbeat_stale` — pid alive, heartbeat lapsed |
| `machine_reboot` — kernel boot id changed since acquisition | `expired_live_owner` — pid alive, lease expired |
| `expired_unverifiable` — foreign host, lease expired | `live_foreign_host` — foreign host, lease valid |
| `corrupt_orphan` — record never completed, past the write grace | `corrupt_recent` — inside the write grace (someone is mid-acquire) |
| `hard_deadline_exceeded` — absolute bound elapsed | `legacy_live` — pre-1594 record whose pid is alive |

A heartbeat renews the lease but never the hard deadline, so the hard deadline
is the single bound that can retire a still-running owner and execution stays
bounded. The heartbeat runs on a **worker thread**, because `pnpm type-check`
and `pnpm test` are blocking `spawnSync` calls — a main-thread timer would stop
beating for the entire duration of the verify it is supposed to prove alive.

Ownership records are **self-describing**. UTV2-1634 records the opposite
failure elsewhere in ops: `readAllManifests()` resolves lane state from the
local working tree, so ownership that lives on a PR branch is invisible from
other worktrees. A verify slot must never need the writer's context to be
interpreted, so each record carries everything a foreign reader needs to decide
liveness on its own — operation id, pid, process-start token, hostname, kernel
boot id, acquired-at, heartbeat, lease expiry, hard deadline, plus
issue/branch/worktree/command for the operator. Asserted directly, not just
described (E6).

### A — resumable execution

`codex-exec.ts` applied one fixed `timeout: 30 * 60 * 1000` to every lane, every
tier and every phase, and nothing survived the kill. Four consecutive attempts
produced four independent runs and zero accumulated progress.

Timeouts are now derived from `(tier, reasoning effort, phase)` by a
deterministic policy that is clamped into `[5m, 4h]` for every reachable input
combination — bounded, but no longer identical for a T3 closeout and a T1
implementation. Progress persists to a durable checkpoint per issue: completed
phases, findings, pending actions, per-attempt outcomes, heartbeat. A resume
reads it and skips what is already settled instead of re-deriving it.

Silence is never success: a run that produced no heartbeat inside the silence
window is reported as `EXECUTION_SILENT` with outcome `silent_no_heartbeat`,
distinct from `EXECUTION_TIMED_OUT` and `EXECUTION_FAILED`, and every
non-success path closes the attempt and hands back any verify slot whose owner
is provably dead.

ASSERTIONS:

- [x] A1. A dead process holding a slot is reclaimed, with a stated reason, and
      the next waiter is admitted into the freed slot (E1, fixture 3).
- [x] A2. A live verifier is never reclaimed — not when slow, not when its
      heartbeat lapses, not when its lease expires (E2, fixture 4).
- [x] A3. A recycled pid is detected and is not mistaken for the original owner
      (E3).
- [x] A4. Signal, uncaught-exception and normal-exit paths all release the slot
      (E4).
- [x] A5. A waiting process emits periodic progress naming who holds the queue
      (E5).
- [x] A6. An ownership record is interpretable by any process, with no
      writer-side state (E6).
- [x] A7. Four consecutive timeout/resume attempts become one resumable
      execution history rather than four replays (E7, fixture 1).
- [x] A8. Every reachable timeout is deterministic and inside `[5m, 4h]` (E8).
- [x] A9. A slot record written by the previous code path, held by a live pid,
      survives the rollout (E9).
- [x] A10. `pnpm type-check`, `pnpm lint` and `pnpm test` are green on the
      branch head (E10).
- [ ] A11. Section B (canonical PM amendment ingestion) — **not claimed**. It is
      deliberately out of scope pending the structured PM-decision schema this
      issue directs coordination with; see "Where section B is left".

EVIDENCE:

## Verification

- `pnpm type-check` — PASS, clean exit, no output.
- `pnpm lint` — PASS, clean exit, no output.
- `pnpm test` — PASS, 4099 tests, 4099 pass, 0 fail, 0 skipped (E10).
- `npx tsx --test scripts/ops/verify-semaphore.test.ts` — 40 tests, 40 pass, 0 fail, 0 skipped.
- `npx tsx --test scripts/ops/execution-checkpoint.test.ts` — 23 tests, 23 pass, 0 fail, 0 skipped.
- `npx tsx --test scripts/ops/codex-exec.test.ts` — 21 tests, 21 pass, 0 fail, 0 skipped.
- `npx tsx --test scripts/ops/preflight.test.ts` — 14 tests, 14 pass, 0 fail, 0 skipped.

No `pnpm test:db` claim is made in this bundle. This lane touches no database
path, performs no production write, and changes no schema. The changed files are
`scripts/ops/{verify-semaphore,execution-checkpoint,preflight,codex-exec,lane-maximizer}.ts`,
their tests, `package.json` and `docs/governance/LANE_CONCURRENCY_POLICY.md`.

## Evidence

Fixtures 3, 4 and the pid-reuse case below were demonstrated with **real
processes**, not stubbed liveness, against an **isolated temp semaphore
directory** passed with `--dir`. The live
`.out/ops/preflight/full-verify-semaphore/` state that five sibling lanes depend
on was never used as a test target, and was confirmed untouched at the end of
the run.

The transcripts quoted below were captured before the three self-review fixes in
E12. Rather than let the proof cite a build that is not the one being merged,
the whole demonstration was **re-run unchanged against the final
implementation**; every fixture reproduced identically, with new pids and
timestamps:

```
slot 0: LIVE                                         (holder acquired)
slot 0: DEAD_OWNER (reapable)                        (after SIGKILL)
slot 0: LIVE                                         (next waiter admitted)
no reapable slots — nothing removed
protected slot 0: live — owner pid 212020 is running and heartbeating (lease until 2026-07-31T13:04:53.809Z).
owner still UTV2-2222: UTV2-2222        holder still alive: YES
heartbeat_at t0: 2026-07-31T12:49:53.809Z
heartbeat_at t1: 2026-07-31T12:49:57.815Z
slot 0: PID_REUSED (reapable)
reaped slot 0: pid_reused — pid 212020 is running but is a different process than the slot owner
               (recorded start linux:starttime:1, current start linux:starttime:146832); the pid was recycled.
holder pid 212020 still alive: YES
```

The E12 fixes widen which slots are *scanned* and tighten when a slot may be
*released*; neither touches the classification paths these fixtures exercise,
which is what the re-run confirms rather than assumes.

### E1 — fixture 3: a dead process holding a slot is reaped, next waiter admitted

A holder process acquired slot 0 and was then `SIGKILL`ed, so no cleanup handler
could run and the record was left exactly as a crashed preflight leaves it:

```
--- slot held by a live process (pid 95675) ---
  slot 0: LIVE
    owner       pid=95675 operation=9ace07ca-6842-4e57-85e0-137305f9fe52 user=griff843
    lane        issue=UTV2-1111 branch=codex/utv2-1111
    age         2s   heartbeat 0s ago
    reason      owner pid 95675 is running and heartbeating (lease until 2026-07-31T12:50:13.184Z).

--- SIGKILL the owner (no cleanup handler can run) ---
owner.json still on disk: YES

--- operator view of the corpse ---
  slot 0: DEAD_OWNER (reapable)
    owner       pid=95675 operation=9ace07ca-6842-4e57-85e0-137305f9fe52 user=griff843
    lane        issue=UTV2-1111 branch=codex/utv2-1111
    age         4s   heartbeat 2s ago
    reason      owner pid 95675 is not running on this host.

--- next waiter acquires (reclaims the corpse) ---
ACQUIRED slot 0 pid 96707
  slot 0: LIVE
    owner       pid=96707 operation=ba9bdcb2-c742-46ed-93a4-63e5f02a6d20 user=griff843
    lane        issue=UTV2-2222 branch=codex/utv2-2222
    reason      owner pid 96707 is running and heartbeating (lease until 2026-07-31T12:50:16.653Z).
```

Four seconds, not six hours. The reclaim is auditable after the fact — the
reap log records the reason, the reclaiming process and the full previous owner:

```json
{"slot":0,"state":"dead_owner","reason":"owner pid 95675 is not running on this host.",
 "reaped_at":"2026-07-31T12:35:15.556Z",
 "reaped_by":{"pid":96707,"operation_id":"ba9bdcb2-c742-46ed-93a4-63e5f02a6d20"},
 "previous_owner":{"schema_version":2,"operation_id":"9ace07ca-...","pid":95675,
  "process_start_token":"linux:starttime:58881",
  "machine":{"hostname":"DESKTOP-GP6RM0V","boot_id":"ae53f7c9-9021-4819-9912-3b1c889a44d0"},
  "issue_id":"UTV2-1111","acquired_at":"2026-07-31T12:35:11.111Z", ...}}
```

Unit coverage of the same path: `FIXTURE: a dead process holding a slot is
safely reaped and the next waiter admitted` in `verify-semaphore.test.ts`.

### E2 — fixture 4: a live slow verifier is NOT reaped

The most important fixture, because getting it wrong corrupts real runs. With
the UTV2-2222 holder still running, the reaper was asked to sweep:

```
--- the UTV2-2222 holder (pid 96707) is still running; ask the reaper to sweep ---
no reapable slots — nothing removed
protected slot 0: live — owner pid 96707 is running and heartbeating (lease until 2026-07-31T12:50:17.654Z).

owner still UTV2-2222: UTV2-2222
holder still alive: YES
```

The reaper does not merely decline — it names what it protected and why.

The heartbeat that keeps a long verify alive advances on its worker thread while
the owner is blocked:

```
heartbeat_at t0: 2026-07-31T12:35:17.654Z
heartbeat_at t1: 2026-07-31T12:35:21.660Z
```

`the heartbeat keeps beating while the main thread is blocked in spawnSync`
asserts this against a real blocking `spawnSync`, not a sleep.

Three further protections are asserted as units, each one a case where a naive
implementation would have cleared a live run:

- `FIXTURE: a live slow verifier is never reaped, however long it has been
  running` — 5.5 hours of legitimate work, still `live`, `reapable: false`.
- `a live owner whose heartbeat merely lapsed is reported, not reaped` —
  `live_heartbeat_stale`, `reapable: false`. A running process is never provably
  dead.
- `a live owner past its lease is reported but still not auto-reaped` —
  `expired_live_owner`, `reapable: false`; only the hard deadline retires it.
- `a foreign-host owner is protected until its lease expires` — a local pid
  probe says nothing about a remote host, so `live_foreign_host` is not
  reapable even when the local probe reports the pid dead.

And a contender that cannot get in waits rather than stealing: `FIXTURE: a live
slow verifier is not reaped and a contender queues behind it` asserts the
holder's `operation_id` and pid are unchanged and that `reap-log.jsonl` was
never even created.

### E3 — PID reuse is detected

`/proc/<pid>/stat` field 22 (`starttime`) is fixed for the life of a process, so
a recycled pid reports a different value than the one the slot recorded. To
demonstrate it without waiting for the kernel to wrap the pid space, the record's
start token was rewritten while the pid stayed alive — the exact state a
recycled pid produces:

```
recorded pid          : 96707
recorded start token  : linux:starttime:59319
rewritten start token : linux:starttime:1 (same live pid, different process identity)

  slot 0: PID_REUSED (reapable)
    reason      pid 96707 is running but is a different process than the slot owner
                (recorded start linux:starttime:1, current start linux:starttime:59319);
                the pid was recycled.

--- reap now removes it, even though the pid is alive ---
reaped slot 0: pid_reused — pid 96707 is running but is a different process than the slot owner ...
holder pid 96707 still alive: YES
```

A bare `process.kill(pid, 0)` liveness check would have reported this slot as
live forever. Note the last line: the reap removed the *slot*, not the process.

Two supporting units: `readProcessStartToken is stable for a live process and
absent for a dead pid` (the same live process always reports the same token; a
pid with no `/proc` entry reports none), and `a matching start token keeps a
live owner protected`.

Machine identity is handled with the same caution. `bootIdsProveReboot` only
concludes "rebooted" when **both** sides are real kernel boot UUIDs; the
portable `uptime:` approximation can drift by a minute within one boot, and
treating that drift as a reboot would reap a live owner. Asserted in
`bootIdsProveReboot only fires when both sides are real kernel boot ids`.

### E4 — signal, crash and expiry cleanup

- `a killed process releases its slot through the signal path` — a real child
  process acquires a slot, receives `SIGTERM`, and the slot is gone after it
  exits. The child is spawned as `node <script>` (not through a wrapper) so the
  signal lands on the process under test rather than on a shell that would
  swallow it.
- `an uncaught exception releases the slot before the process dies` — the slot
  is released, the process still exits non-zero, and the original `boom` error
  still reaches stderr. Cleanup does not swallow the crash.
- `installVerifySlotReleaseHandlers can be uninstalled and leaves no listeners
  behind` — exit/SIGINT/SIGTERM/uncaughtException listener counts return to
  their pre-install values.
- `release does not delete a slot that has since been re-claimed by someone
  else` — if this slot was already reaped and re-acquired, `release()` leaves
  the new owner's slot intact instead of destroying a live verify.
- `the hard deadline retires even a live, heartbeating owner` — the bounded
  upper bound is real.
- `an incomplete slot is protected inside the write grace and reapable after
  it` — the acquire race (directory created, record not yet written) does not
  let a contender delete a slot that is being taken right now.

### E5 — a waiting process reports progress

From `FIXTURE: a live slow verifier is not reaped and a contender queues behind
it`, the waiter's first progress line:

```
waiting 0s for a full-verify slot (1/1 occupied, 0 waiting) — slot 0: live pid=4242 issue=UTV2-1594 age=10800s
```

Progress is emitted **before** the give-up check, so a waiter that runs out of
patience still explains what it was waiting behind. `preflight.ts` routes this
to stderr, and routes every reclaim through `onReap`, so neither a queue nor a
reclaim is ever silent.

`operator status explains every occupied and waiting slot` asserts the operator
surface directly: two occupied slots (one dead, one live), one waiter, one free
slot; every occupied entry carries pid, age, heartbeat age and a reason string;
the rendered output names each issue and marks the reapable one. `a dead waiter
is dropped from the queue view` asserts a waiter that died in the queue is
removed rather than inflating the queue depth forever.

Live operator output for a free semaphore:

```
$ pnpm ops:verify-slots
full-verify semaphore: /home/griff843/code/.worktrees/wt-1594/.out/ops/preflight/full-verify-semaphore
slots: 0/1 occupied, 0 reapable, 0 waiting

  slot 0: FREE
```

### E6 — ownership records are readable by any process (the UTV2-1634 lesson)

`a slot record is self-describing: a foreign reader can classify it with no
writer-side state` re-reads the record from disk as raw bytes, asserts all
fifteen fields a foreign reader needs are present, then classifies it twice
using only the record plus the reader's own machine identity and process table
— once with the owner alive (`reapable: false`) and once with the owner dead
(`dead_owner`, `reapable: true`). `the semaphore directory is the only shared
state a reader needs` classifies a slot written by a process that never existed
in this test's memory.

### E7 — fixture 1: four timeout/resume attempts, one execution history

`FIXTURE: four consecutive timeout/resume attempts become one resumable history,
not four replays` runs four attempts, each ending in `timed_out`, and asserts:

- The four attempts land in **one** checkpoint file, not four
  (`fs.readdirSync(dir)` is exactly `['UTV2-1590.json']`).
- Each attempt started where the previous one stopped: start phases are
  `orient → plan → implement → verify`, never `orient` four times.
- Each attempt's resume plan skips exactly what earlier attempts completed, and
  carries forward exactly the findings they recorded (asserted per attempt, so a
  regression that drops carry-forward on attempt 3 fails).
- All four findings survive and none is recomputed (four distinct summaries).
- Each completed phase is credited to the attempt that actually finished it
  (`[1, 2, 3, 4]`).
- The resume brief handed to the next attempt says `RESUMED RUN`, `Do not repeat
  completed analysis`, `Resume at phase: closeout`, and contains all four prior
  findings.

Supporting units: `pending actions and findings survive across attempts`;
`a completed phase is not double-recorded if an attempt reports it twice`;
`a corrupt checkpoint falls back to the last valid write instead of replaying
from zero` (a truncated write does not discard accumulated progress); `an
unreadable checkpoint with no backup is treated as absent, never as progress`.

Silence handling: `a silent attempt is reported as silent, never as progress`;
`an unreadable heartbeat counts as silence rather than as liveness`; `a closed
attempt is not mistaken for a silent one`; `a silent attempt fails visibly and
releases the resources it owned` (outcome `silent_no_heartbeat`, status not
`completed`, released resources recorded); `a reaper that itself throws cannot
swallow the failing outcome`.

Operator cancellation: `operator cancellation is recorded on the checkpoint with
its reason`, and `codex-exec.ts` honours it before any spawn (`EXECUTION_CANCELLED`,
exit 2). `a new attempt clears a consumed cancellation flag rather than
inheriting it forever` prevents a cancelled lane from being permanently wedged.

### E8 — the timeout policy is deterministic and bounded

`every reachable timeout is bounded by the hard cap and the floor` enumerates
all 3 tiers × 7 reasoning efforts (including an unknown one) × 5 phases = 105
combinations and asserts each result is inside `[5m, 4h]`. `the timeout policy
is deterministic` asserts identical inputs produce a byte-identical decision
object. `the timeout policy varies by tier, reasoning effort and phase` asserts
the ordering actually differentiates. `an unknown reasoning effort degrades to
1x and says so` — the fallback is recorded in `fallbacks[]`, not silent. `the
old fixed 30-minute timeout is no longer what a T1 implementation phase gets`
asserts the specific defect is gone.

### E9 — the rollout does not disturb slots held by the previous code path

Five sibling lanes are running `pnpm verify` right now, some holding slots
written by the pre-UTV2-1594 format (a bare pid and timestamp, no schema
version). `a pre-UTV2-1594 slot record held by a live pid is left alone`
asserts such a record classifies as `legacy_live`, `reapable: false`. `a
pre-UTV2-1594 slot record held by a dead pid is reclaimed immediately, not after
6h` asserts the improvement applies to legacy records too.

### E12 — three gaps found in self-review, fixed, and checked both directions

Reviewing this lane's own diff before certifying it surfaced three ways the
same failure class could have survived inside the fix itself.

**1. A slot above the configured concurrency was invisible and unreclaimable.**
`readSemaphoreStatus` and `reapVerifySlots` both iterated `slot < maxConcurrent`.
Lowering `UNIT_TALK_FULL_VERIFY_CONCURRENCY` from 2 to 1 would leave a corpse in
`slot-1` that nothing would ever look at again — never listed by the operator
command, never reclaimed. That is exactly "a dead owner holds something
forever", relocated. Both functions now scan the configured range **union** any
`slot-N` directory actually on disk.

**2. `release()` deleted a slot whose record was missing.** The check was
`if (current && current.operation_id !== operationId) return;` — a *missing*
record fell through to the delete. The one window in which the record can be
missing is between another process's `mkdirSync(slotPath)` and its own record
write, so that path could drop a slot out from under a verify that was starting
at that instant. Release now requires **positive** ownership
(`current?.operation_id !== operationId`). A directory orphaned by this branch
is not a leak: it classifies as `corrupt_orphan` past the write grace and is
reclaimed normally.

Both fixes were checked in both directions rather than asserted. The four new
assertions were run against the pre-fix implementation and then against the
fixed one:

```
=== PRE-FIX ===
not ok 37 - a slot above the configured concurrency is still reported, not orphaned forever
not ok 38 - a dead slot above the configured concurrency is reclaimed rather than leaked
ok  39 - a LIVE slot above the configured concurrency is still not reclaimed
not ok 40 - release requires positive ownership: a slot mid-acquire by someone else is left alone

=== POST-FIX ===
# pass 40
# fail 0
```

Assertion 39 passes in both directions **by construction**, and is recorded as
such rather than counted as a regression test: pre-fix the slot was not scanned
at all, so nothing was reaped either. It exists to stop the widened scan from
widening what may be *reaped* — a guard against the fix over-reaching, which is
the specific way this change could have hurt a live verifier.

**3. A killed runner left its attempt open forever.** `beginAttempt` appended a
new attempt without closing any prior one, and `classifyCheckpointLiveness`
took the **first** open attempt. A `codex-exec` process killed before it could
call `finishAttempt` therefore left a dangling record, and the next run's
liveness check described that stale attempt instead of the run actually in
flight. `beginAttempt` now closes any dangling attempt as
`silent_no_heartbeat` — the failure it actually was, never success — and
liveness takes the **last** open attempt. Progress recorded by the killed
attempt is still carried forward.

Checked the same way:

```
=== PRE-FIX ===
not ok 22 - an attempt left open by a killed runner is closed as silence when the next attempt starts
not ok 23 - liveness describes the attempt in flight, not an older dangling one

=== POST-FIX ===
# pass 23
# fail 0
```

This one is worth naming plainly: the lane exists because long-running work
loses its progress when it is stopped abruptly, and this session was itself
stopped abruptly mid-implementation. The defect it exposed in my own code was
the same shape as the defect the lane was opened to fix.

### E10 — full suite

`pnpm test` on the branch head, measured on the final implementation (after the
three E12 fixes and their six new assertions): **4099 tests, 4099 pass, 0 fail,
0 skipped**, exit code 0. No `not ok` line anywhere in the run.

```
$ pnpm lint && pnpm type-check && pnpm test
...
=== aggregated over all suites ===
tests 4099  pass 4099  fail 0  skipped 0
EXIT=0
```

The count moved 4093 → 4099 across this lane's own self-review: four new
assertions in `verify-semaphore.test.ts` and two in `execution-checkpoint.test.ts`.

### E11 — a preflight defect found and fixed on the way in

Running preflight for this very lane produced `PB2 | FAIL | spawnSync pnpm
ENOBUFS`. `pnpm test` now emits more than `spawnSync`'s 1 MiB default
`maxBuffer`, so the child was aborted and a green suite was reported as a failed
baseline — turning a passing tree into an INFRA verdict and blocking lane start
for a reason unrelated to the code under test. Fixed by raising the buffer on
both the win32 and posix spawn paths; asserted by `preflight raises the baseline
spawn buffer so pnpm test output cannot ENOBUFS`. This is in scope: it is the
same `runCommand` call the semaphore wraps, and it was a false red on the
throughput path this lane exists to harden.

## Where section B is left

Section B (canonical PM amendment ingestion) is **not implemented here**. The
issue itself says to "coordinate with UTV2-1547 rather than creating a second
incompatible PM-decision schema", and UTV2-1547's `pm-decision/v1` has not
landed. Building an amendment schema here would either duplicate it or pre-empt
it. Fixture 2 of the original spec (a PM correction consumed on resume) is
therefore not claimed.

The seam A and C leave for it is narrow and deliberate:

1. **The ingestion point exists.** `codex-exec.ts` reads the checkpoint and
   builds the prompt in one place, before the spawn:
   `readCheckpoint → buildResumeBrief → buildCodexPrompt(packet, resumeBrief)`.
   Amendment ingestion is a second brief composed at the same point, and
   `buildCodexPrompt` already takes the brief as a parameter rather than
   inlining it.
2. **The record has somewhere to go.** `ExecutionCheckpoint` is a versioned,
   additive record (`schema_version: 1`) that already persists per-attempt
   provenance. Consumed amendment ids and their `updated_at` values belong
   alongside `findings`/`pending_actions` as a new field; nothing about the
   resume path needs to change to carry them.
3. **The fail-closed path exists.** `failVisiblyAndRelease` is already the
   single "stop before code and release what we hold" exit. The spec's
   "conflicting authoritative amendments stop before code" is a new outcome
   value routed through that function, not new machinery.
4. **The acknowledgement path exists.** Every attempt already emits a structured
   `execution` block on stdout and closes with a recorded outcome; an
   acknowledgement of consumed amendments is another field on that block.

What is deliberately absent: any notion of which comment authors are
authoritative, any precedence rule between description and amendments, and any
comment parsing. Those are exactly the decisions UTV2-1547 owns, and guessing
them here is what the scope guard forbids.

## Scope notes

- Merge authority, branch protection, direct-main policy, production runtime and
  model-routing policy are untouched. `docs/05_operations/policies/codex-model-routing.json`
  is read, never modified; the timeout policy keys on *reasoning effort* rather
  than profile name specifically so it does not couple to that file's contents.
- The semaphore directory remains **per worktree checkout**, as ratified in
  `docs/governance/LANE_CONCURRENCY_POLICY.md` §10a. Making it host-wide would
  serialize every concurrent lane's baseline and is a policy change, not a bug
  fix, so it is exposed as an operator opt-in
  (`UNIT_TALK_FULL_VERIFY_SEMAPHORE_DIR`) and the default is unchanged.
- One observation recorded but not acted on: because the directory is
  per-checkout, the throttle does not currently constrain concurrent baselines
  across sibling worktrees, which is what §10a specifies. Changing that is a
  governance decision with real throughput consequences and belongs in its own
  lane.
