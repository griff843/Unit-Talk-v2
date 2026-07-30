# PROOF: UTV2-1626
MERGE_SHA: 1e1197581155864b550c332daa8d93a40447fceb

## Summary

`docs/06_status/readiness/readiness-score.json` is the input to the Readiness
Regression Gate that runs on every pull request. Before this lane there was no
generator for it. The workflow named "Readiness Ledger Refresh" did not refresh
anything: it read the file's modification age and opened a GitHub issue when that
age crossed a threshold. The ledger itself was written by hand during whatever
lane last cared.

The consequence is measurable, not theoretical. On `origin/main` the ledger's
`generated_at` is `2026-07-16T05:10:24.185Z`. Between that timestamp and this
lane, the refresh workflow ran **29 times and concluded `success` every single
time** (49 of 49 successes across its entire retained run history). A scheduled
job reported that it had done its work 29 times while its only durable output
never changed by one byte.

Meanwhile the pull-request gate kept failing every lane, on a RED verdict nobody
could confirm was still true. The two failure modes — "production is broken" and
"nobody has looked at production in two weeks" — printed the same red X. When a
real regression and a forgotten artifact are indistinguishable, the only rational
response to either is to ignore both, and that is what every lane learned to do.
UTV2-1630's own proof bundle records the gate as "red and pre-existing … left red
deliberately", which is the correct call under the old design and is exactly the
signal loss this lane removes.

This lane closes that with three mechanisms:

1. **A generator that measures.** `scripts/ops/readiness-refresh.ts` observes nine
   dimensions against canonical production, read-only. Nothing is defaulted or
   carried forward; the previous ledger is never read. A dimension that cannot be
   observed is recorded `unknown` with its reason and is never scored as passing.
2. **A gate that names the kind of failure.**
   `scripts/ci/readiness-ledger-gate.ts` separates observer failures
   (`LEDGER_MISSING`, `LEDGER_INVALID`, `LEDGER_STALE`, `DIMENSION_STALE`,
   `OBSERVER_DEGRADED`) from the one product condition (`READINESS_RED`), and
   carries an explicit `observer_failure` boolean.
3. **A refresh that must prove it published.** `--mode persistence` runs after the
   generator, against the copy read back from `origin/main`, and refuses an
   unchanged file, an unadvanced timestamp, or any dimension carried forward from
   a prior run. The 29-green-runs-one-stale-file outcome is no longer reachable.

ASSERTIONS:
- [x] The ledger on this branch is a **measurement**, taken from this worktree against canonical production `zfzdnfwdarxucxtaojxm` at `2026-07-30T23:40:39.763Z`, not a hand-authored score
- [x] Every dimension records `observed_at` and `method`, so staleness is detectable per dimension and not only per file
- [x] `unknown` is never scored as passing — `db_tripwires` and `constitution_convergence` are both unreadable in this run and both hold the verdict back rather than being waved through
- [x] The generator's only database surface is a read-only wrapper exposing `select` reads; there is no insert/update/upsert/delete/rpc path in the file, and a test scans the source to keep it that way
- [x] A non-production target yields `unknown`, not a value — a staging reading can never be published as a production readiness measurement
- [x] The gate distinguishes observer failure from product failure and reports `observer_failure` as a machine-readable field, not as prose
- [x] The persistence assertion was exercised **in both directions**: `OK` on a genuinely new observation, `NOT_REWRITTEN` on a byte-identical file
- [x] `readiness-refresh.yml` is `schedule` + `workflow_dispatch` only and is never pull-request reachable while holding a production credential; `scripts/ci/workflow-production-credential-guard.ts` passes clean on this branch
- [x] The pull-request gate job holds no credential and touches no production system — it reads only the committed ledger
- [x] The scheduled ledger commit is admitted to `direct-main-push-guard.ts` under an exact message pattern and a one-file path scope, not by widening the guard
- [x] The workflow's own shape is asserted by `readiness-refresh-workflow.ts` against the real file, and the tests mutate the parsed workflow to prove each rule actually fires
- [x] No production write, no deploy, no restart, no direct-main push, no admin merge, no branch-protection change

## Verification

`pnpm verify` is not runnable end-to-end on this workstation: under UTV2-1630 the
writable DB stages are pinned to the staging project and refuse without a staging
credential. `pnpm verify:static` is the sanctioned local equivalent (`verify:local`),
and it covers every stage this lane can affect. It passed.

```text
$ pnpm verify:static
ops:sync-check              OK (per-issue): branch "claude/utv2-1626-readiness-refresher" <-> .ops/sync/UTV2-1626.yml
ops:system-alignment-check  verdict=PASS fail=0 warn=0
ops:automation-coverage-check verdict=PASS fail=0 warn=0 classified=15
env:check                   PASS
lint                        PASS
type-check                  PASS
build                       PASS
test                        PASS
smart-form verify           PASS
verify:commands             PASS
exit 0
```

The authoritative complete run is the required `verify` context in CI on this
head.

Full ops suite, which is where this lane's tests live:

```text
$ pnpm test:ops
1..1435
# tests 1447
# suites 6
# pass 1447
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 19255.442796
```

The four test files this lane adds or extends, in isolation:

```text
$ pnpm exec tsx --test scripts/ops/readiness-refresh.test.ts \
    scripts/ci/readiness-ledger-gate.test.ts \
    scripts/ci/readiness-refresh-workflow.test.ts \
    scripts/ci/direct-main-push-guard.test.ts
1..63
# tests 63
# suites 0
# pass 63
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 672.654564
```

Workflow credential scanner, confirming the refresher's production READ credential
did not create a pull-request-reachable exposure:

```text
$ pnpm exec tsx scripts/ci/workflow-production-credential-guard.ts
exit 0
```

## Evidence

EVIDENCE: a live read-only measurement of canonical production, the persistence
assertion exercised in both directions, and the pull-request gate classifying the
result.

### 1. The generator ran against production and produced a measured ledger

Executed from this worktree with production READ credentials. Reads only.

```text
$ pnpm ops:readiness-refresh
READINESS LEDGER — generated_at 2026-07-30T23:40:39.763Z
  verdict:       RED
  observability: degraded
  target:        zfzdnfwdarxucxtaojxm

  [FAIL] deploy_sha_alignment (blocking)
         Last successful deploy (actions/runs/28415953590, 2026-06-30T02:30:15Z,
         741.2h ago) shipped 8deccaceda9f4af3b5efb17ecf23b5151315ed5d; main HEAD
         is 3f83c87692e2fab106156a8ae01f54fd1bdc31d5, 357 commits ahead.
  [FAIL] ingestor_health (blocking)
         latest ingestor.cycle started 2026-06-30T12:55:01.189873+00:00 (43845m
         old, threshold 30m); latest ingestor.cycle status is "failed"; latest
         merged provider cycle updated 2026-06-30T12:24:44.890623+00:00 (43876m
         old). Latest game_results row: 2026-06-30T07:27:28.089891+00:00.
         Read-only observation; no restart or mutation performed.
  [FAIL] worker_outbox_health (blocking)
         pending=9, processing=32, stale_unknown=32, attempted-and-stuck=0.
         worker.heartbeat 2026-07-16T03:48:17.780927+00:00 (21352m, status
         succeeded). FAIL: heartbeat 21352m old (threshold 30m); 32
         bucket:stale_unknown rows (processing > 5m).
  [FAIL] dead_letter_count (blocking)
         1948 dead_letter rows: 1947 bucket:governance_hold (attempt_count=0) +
         1 bucket:true_failure (attempt_count>0). Governance holds do not fail
         readiness under QUEUE_READINESS_SEMANTICS.md v1.0; true failures do.
  [UNKN] db_tripwires (blocking)
         UNREADABLE: db-health-tripwire.yml run 30573430796 concluded "failure"
         (failed step: Run DB health checks) — a red observer cannot distinguish
         a fired tripwire from a broken observation. Not scored as passing.
  [PASS] pnpm_verify
         ci.yml run 30586226850 on 3f83c87692e2fab106156a8ae01f54fd1bdc31d5
         concluded "success" at 2026-07-30T22:17:14Z (1.4h ago). That commit is
         main HEAD.
  [FAIL] scheduled_observer_health
         ingestor-staleness-alert.yml, grading-staleness-check.yml,
         pipeline-health-monitor.yml, db-health-tripwire.yml and
         reconcile-stale-lanes.yml all concluded "failure".
  [FAIL] proof_coverage
         94/104 lanes closed in the window carry a merge-SHA binding in
         verification.md; unbound: UTV2-1365, UTV2-1373, UTV2-1379, UTV2-1390,
         UTV2-1393, UTV2-1395, UTV2-1419, UTV2-1420, UTV2-1476, UTV2-1520.
  [UNKN] constitution_convergence
         UNREADABLE: convergence percentage has no generator in this repo —
         previous ledgers carried a hand-entered "~68%", which this generator
         refuses to reproduce as a measurement. Not scored as passing.

  blockers:   deploy_sha_alignment, ingestor_health, worker_outbox_health, dead_letter_count
  unreadable: db_tripwires, constitution_convergence

[readiness-refresh] wrote docs/06_status/readiness/readiness-score.json
```

Note the last dimension. The prior ledger asserted constitution convergence as a
number no code in this repository produces. The generator declines to reproduce
it, and takes the `unknown` penalty instead. That is the whole behavioural change
in one dimension.

### 2. The persistence assertion, exercised in both directions

A one-directional check here would be worthless: the mode exists precisely to
catch a run that produced nothing, so it must be shown to fail on that input.

```text
$ pnpm ci:readiness-gate -- --mode persistence --file <new> --previous <origin/main copy> \
    --run-started-at 2026-07-30T23:35:00Z
[readiness-persistence] OK — ledger rewritten with 9 dimensions, all observed
within this run (generated_at 2026-07-30T23:40:39.763Z)
exit 0

$ pnpm ci:readiness-gate -- --mode persistence --file <new> --previous <the same file> \
    --run-started-at 2026-07-30T23:35:00Z
::error title=readiness refresh did not persist::NOT_REWRITTEN: the ledger is
byte-identical to the previous version — the generator did not execute, or its
output was not published
exit 1
```

The second case is the exact shape of the 29 green runs. It now fails.

### 3. The pull-request gate classifies the measured result

```json
{
  "code": "READINESS_RED",
  "observer_failure": false,
  "passed": false,
  "age_hours": 0,
  "summary": "Readiness is RED on measured evidence 0h old. Blocking dimensions failing: deploy_sha_alignment, ingestor_health, worker_outbox_health, dead_letter_count."
}
```

`observer_failure: false` and `age_hours: 0` are the load-bearing fields. Run the
same gate against the ledger currently on `origin/main` and it answers differently:

```json
{
  "code": "LEDGER_STALE",
  "observer_failure": true,
  "passed": false,
  "age_hours": 354.6,
  "summary": "The readiness ledger is 354.6h old (threshold 48h). This is an OBSERVER failure: the recorded verdict describes the past, not production now."
}
```

Same gate, same repository, same binary — two conditions that used to be one red X
now come back separated and correctly named. Note that `main`'s ledger also says
`verdict=RED`; the gate refuses to report that as `READINESS_RED`, because a stale
RED is not evidence of a current RED. Reporting it as one would be the same lie the
old gate told.

### 4. Staleness this lane closes

| | `origin/main` | this branch |
|---|---|---|
| ledger `generated_at` | 2026-07-16T05:10:24.185Z | 2026-07-30T23:40:39.763Z |
| age measured by the gate | 354.6 h | 0 h |
| gate classification | `LEDGER_STALE` (observer failure) | `READINESS_RED` (product condition) |
| `schema_version` | 1 | 2 |
| how produced | hand-authored during some lane | measured by `ops:readiness-refresh` |
| refresh runs since it last changed | 29, all green | n/a |

## Self-referential hazard: the Readiness Regression Gate on this pull request

This branch changes the Readiness Regression Gate itself, so its status on this
pull request needs an explicit statement rather than a shrug.

**The gate is RED on this pull request, and that is the correct behaviour.** It is
red as `READINESS_RED` with `observer_failure: false` on a ledger `0h` old —
production is genuinely failing on four blocking dimensions, every one of which is
a live read taken today. The gate is not broken, and it is not red for staleness:
under the old design it was red as `LEDGER_STALE` dressed up as a product verdict,
and the entire point of this lane is that those two are no longer the same signal.

The Readiness Regression Gate is **not a required context**, so this does not
block merge.

It was not made green. Making it green would require writing a readiness score
this lane did not measure, which is precisely the defect being removed. The four
blockers are production runtime state that this diff does not touch and must not
touch:

- `deploy_sha_alignment` — last successful deploy 2026-06-30, `main` 357 commits ahead
- `ingestor_health` — last `ingestor.cycle` 2026-06-30, status `failed`
- `worker_outbox_health` — worker heartbeat 14.8 days old, 32 rows processing past the 5-minute window
- `dead_letter_count` — 1 true delivery failure among 1,947 governance holds

Each is an operational lane of its own. This lane's deliverable is that they are
now *named, dated and re-measurable every six hours*, instead of being a single
undifferentiated red X on a two-week-old file.

## Known limitations

- `constitution_convergence` and `db_tripwires` are reported `unknown`, so the
  ledger's `observability` is `degraded` even when every readable dimension is
  fine. Convergence has no generator in this repository; `db_tripwires` is
  unreadable because `db-health-tripwire.yml` is itself failing. Both are recorded
  as unproven rather than assumed — correct behaviour, but it means a fully GREEN
  verdict is unreachable until a convergence generator exists and the tripwire
  observer is repaired.
- The scheduled refresher needs `SYNC_BOT_TOKEN` to push through branch
  protection. If that secret is absent the push step fails, which is the intended
  outcome — a refresh that cannot publish is not a refresh — but it will surface
  as an observer-failure issue rather than as a configuration message.
- The persistence assertion proves the ledger is new and was published. It does
  not prove the numbers inside it are true; that rests on the generator's reads
  being against the canonical production ref, which is asserted in code and cannot
  fall back to another target.
- `pnpm verify` cannot complete on a workstation without staging credentials
  (inherited from UTV2-1630). Local coverage is `verify:static`; the authoritative
  full run is the required `verify` context in CI.
