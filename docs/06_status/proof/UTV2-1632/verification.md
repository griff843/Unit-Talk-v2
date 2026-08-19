# PROOF: UTV2-1632

MERGE_SHA: 5aee608a5c7f30539bcb94ffb8e56e9c0f5ad1bd

That SHA is this lane's implementation commit — a real, reachable ancestor of
the PR head, and the commit every measurement below was taken against. This
bundle is the commit that follows it, so it cannot name its own SHA. The
authoritative binding is the PR's squash SHA, written post-merge by
`.github/workflows/post-merge-lane-close.yml`.

## Summary

The DB Health Tripwire had never executed a single check since it was added.
**Two independent defects** stood in front of the first query, and each on its
own was sufficient to guarantee zero execution:

1. **Bare binary.** `.github/workflows/db-health-tripwire.yml:60` ran
   `tsx scripts/ops/db-health-tripwire.ts`. `tsx` is a workspace devDependency;
   pnpm places it in `node_modules/.bin`, which is on PATH inside a `pnpm`
   script but not inside a raw `run:` block. The step exited **127** before Node
   started.
2. **Phantom import.** `scripts/ops/db-health-tripwire.ts` imported the
   `postgres` driver — a package that appeared in **no `package.json` and had no
   `pnpm-lock.yaml` entry anywhere in this repository**. Fixing (1) alone would
   have moved the failure from exit 127 to `MODULE_NOT_FOUND` exit 1: still zero
   checks executed.

Neither was visible from outside. The job's only signal was a red badge, and a
red badge is also what a genuine finding looks like, so a monitor that had never
worked was indistinguishable from a monitor that was working and unhappy. That
ambiguity is why this survived months of scheduled runs, and removing it is the
substance of this lane.

Two further defects surfaced only once the checker actually ran. Both were made
visible for the first time by the receipt this lane introduces:

3. **The execution gate rejected a correct finding.** `provider_offer_history`
   has never been analysed, so "hours since last_analyze" has no number — yet
   the check evaluated and tripped. Requiring a numeric measurement conflated
   "no value" with "nothing measured". Checks now record `measured.observed`,
   and the gate asks whether the check read real data.
4. **The alert would never have been delivered.** Linear's `commentCreate` takes
   the issue UUID, not the human identifier; passing the identifier failed with
   "Issue not found", and the error was logged as a warning and swallowed. The
   identifier is now resolved first, and a failure is recorded in the receipt
   and annotated on the run instead of disappearing.

## What the monitor found once it ran

The tripwire is not merely fixed; it is reporting. **10 of 12 executed checks
trip against production**, including the bloat and vacuum signature behind the
June 2026 write-path degradation. These are pre-existing production conditions
this lane discovered, not conditions it caused:

| Check | Subject | Measured | Threshold | Verdict |
|---|---|---|---|---|
| table_size | system_runs | 1287.33 MB | 500 MB | TRIPPED (critical) |
| table_size | raw_payloads | 693.73 MB | 300 MB | TRIPPED (critical) |
| table_size | odds_snapshots | 427.21 MB | 300 MB | TRIPPED (warn) |
| table_size | game_results | 55.62 MB | 300 MB | PASS |
| table_size | provider_offer_history | 0 MB | 300 MB | PASS |
| toast_bloat | odds_snapshots | 99.1 % | 80 % | TRIPPED (critical) |
| toast_bloat | raw_payloads | 99 % | 80 % | TRIPPED (critical) |
| autovacuum_staleness | system_runs | 905.71 h since last_analyze | 24 h | TRIPPED (critical) |
| autovacuum_staleness | raw_payloads | 905.71 h since last_analyze | 24 h | TRIPPED (critical) |
| autovacuum_staleness | odds_snapshots | 905.71 h since last_analyze | 24 h | TRIPPED (critical) |
| autovacuum_staleness | game_results | 905.71 h since last_analyze | 24 h | TRIPPED (critical) |
| autovacuum_staleness | provider_offer_history | never analysed | 24 h | TRIPPED (critical) |
| statement_timeout_rate | — | not measured (HTTP 404) | — | NOT RUN |

905.71 hours is **37.7 days** since the last `ANALYZE` on every hot table.

**Merging this turns the scheduled monitor red**, at the `Report DB health
verdict` step, for a real and currently-true reason. That is intended, and it is
now distinguishable from a broken harness by the name of the failing step.

ASSERTIONS:

- [x] **The monitor had never executed a check.** Runs `30616577637`,
  `30597176319`, `30573430796`, `30546729826` and `30525259668` are all
  `failure`, with steps 1-6 green and step 7 "Run DB health checks" red.
- [x] **The second defect is independent of the first**, and was reproduced
  before the fix: running the pre-fix script through `pnpm exec tsx` — that is,
  with defect (1) already corrected — fails with `Cannot find module 'postgres'`,
  exit 1. `grep -n postgres pnpm-lock.yaml` matched only `@supabase/postgrest-js`.
- [x] **The checks now execute against production.** Run `30629392553` reports
  `executed=12/13`, and the receipt's counts recomputed from its own rows agree
  with its declared counts.
- [x] **The check logic evaluates rather than merely starts.** Same commit, same
  measured value, threshold moved by a `workflow_dispatch` input only:
  `game_results` measured 55.62 MB in both runs; at the 300 MB env threshold it
  is `pass` (run `30629198346`), at a 1 MB dispatch-override threshold it is
  `tripped (critical)` (run `30629281828`). Tripped count moves 10 to 11. The
  lowered threshold is committed nowhere; the receipt records it as
  `source: dispatch_override`, and it suppressed the Linear alert
  (`linear_alert: suppressed_threshold_override`) so a demonstration cannot be
  mistaken for a production finding.
- [x] **Execution is proved from a receipt, not an exit code.** The
  `--assert-executed` gate recomputes counts from the check rows, re-derives the
  outcome, requires every non-`not_run` row to have observed data and a
  threshold, requires Postgres to have reported `transaction_read_only=on`, and
  requires the receipt to belong to the current `GITHUB_RUN_ID`. It fails closed
  on a missing receipt and runs under `if: always()`, so deleting the producer
  step turns the job red rather than green.
- [x] **The three outcomes are separated.** Run `30628974075`: harness green,
  execution gate RED (a receipt defect), verdict not reached. Run `30629392553`:
  harness green, execution gate GREEN, verdict RED (a real finding). The name of
  the failing step distinguishes them.
- [x] **The credentials are used read-only, and that is measured rather than
  asserted.** All catalog reads run inside a transaction opened with
  `SET TRANSACTION READ ONLY`, and the receipt records what Postgres itself
  answered for `SHOW transaction_read_only`: `"on"`, in every run, against the
  production pooler `aws-1-us-west-2.pooler.supabase.com`. The workflow gained no
  write capability: the diff introduces no SQL verb other than `SELECT`/`SHOW`,
  and the only non-catalog request is a `GET`.
- [x] **The defect class is now mechanically detectable.**
  `scripts/ci/workflow-bare-binary-guard.ts` derives the set of
  workspace-provided binaries from the repository's own manifests and fails on
  any bare invocation across `.github/workflows/**` and `.github/actions/**`. It
  flags the exact pre-fix line as a regression fixture and passes on the fixed
  tree. **A sweep of every workflow found no other instance of this defect.** It
  runs inside the required `verify` context via `pnpm test`.
- [x] **No path from the test suite to a privileged client.** The pure check
  logic lives in `scripts/ops/db-health-checks.ts`, which imports nothing but
  `node:path`, so the unit tests exercise the evaluators without dragging the
  driver in behind them. `pnpm ci:db-client-boundary` passes.

EVIDENCE:

### 1. The phantom import, reproduced before the fix

```text
$ pnpm exec tsx scripts/ops/db-health-tripwire.ts
Error: Cannot find module 'postgres'
Require stack:
- /home/griff843/code/.worktrees/wt-1632/scripts/ops/db-health-tripwire.ts
    at Module._resolveFilename (node:internal/modules/cjs/loader:1383:15)
  code: 'MODULE_NOT_FOUND',
EXIT=1

$ grep -n "postgres" pnpm-lock.yaml
1404:  '@supabase/postgrest-js@2.99.3':
4087:  '@supabase/postgrest-js@2.99.3':
4110:      '@supabase/postgrest-js': 2.99.3
```

The driver the script imports had no lockfile entry of any kind.

### 2. The bare-binary guard, both directions

```text
$ pnpm exec tsx scripts/ci/workflow-bare-binary-guard.ts     # fixed tree
[workflow-bare-binary-guard] PASS — no workflow invokes a workspace binary by bare name
EXIT=0

# the pre-fix workflow, read from git, scanned by the same guard
$ scanDocument('db-health-tripwire.yml(PRE-FIX)', <pre-fix version>, binaries)
[{"file":"db-health-tripwire.yml(PRE-FIX)","job":"db-health-check",
  "step":"Run DB health checks","binary":"tsx",
  "command":"tsx scripts/ops/db-health-tripwire.ts"}]
```

An earlier revision of the guard reported 5 findings. All 5 were command
substitutions of the form `X=$(pnpm exec tsx ...)`, where the assignment token
had swallowed the real leading word. The tokenizer now splits on `$(`, backticks
and `)`, which keeps a genuinely bare `$(tsx ...)` detectable:

```text
leadingCommandWords('NAME=$(pnpm exec tsx a.ts)')  -> [ 'pnpm' ]
leadingCommandWords('OUT=$(tsx a.ts)')             -> [ 'tsx'  ]
```

### 3. Live execution against production — run 30629392553

```text
[tripwire] running catalog checks inside a READ ONLY transaction...
[tripwire] checking statement timeout rate...
| Check | Subject | Measured | Threshold | Source | Verdict |
| --- | --- | --- | --- | --- | --- |
| autovacuum_staleness | game_results | 905.71 hours since last_analyze | 24 hours | env | TRIPPED (critical) |
| autovacuum_staleness | odds_snapshots | 905.71 hours since last_analyze | 24 hours | env | TRIPPED (critical) |
| autovacuum_staleness | provider_offer_history | last_vacuum=never run, last_autovacuum=never run, last_analyze=never run, dead_tup=0, live_tup=0, dead_tup_pct=0.00% | 24 hours | env | TRIPPED (critical) |
| autovacuum_staleness | raw_payloads | 905.71 hours since last_analyze | 24 hours | env | TRIPPED (critical) |
| autovacuum_staleness | system_runs | 905.71 hours since last_analyze | 24 hours | env | TRIPPED (critical) |
| table_size | game_results | 55.62 MB | 300 MB | env | PASS |
| table_size | odds_snapshots | 427.21 MB | 300 MB | env | TRIPPED (warn) |
| table_size | provider_offer_history | 0 MB | 300 MB | env | PASS |
| table_size | raw_payloads | 693.73 MB | 300 MB | env | TRIPPED (critical) |
| table_size | system_runs | 1287.33 MB | 500 MB | env | TRIPPED (critical) |
| toast_bloat | odds_snapshots | 99.1 % | 80 % | env | TRIPPED (critical) |
| toast_bloat | raw_payloads | 99 % | 80 % | env | TRIPPED (critical) |
| statement_timeout_rate | — | not measured | n/a | — | NOT RUN |
[tripwire] outcome=checks_tripped executed=12/13 passed=2 tripped=10 not_run=1

[tripwire:gate] PASS — 12/13 checks executed (2 pass, 10 tripped, 1 not run)
[tripwire:verdict] FINDING — 10 check(s) exceeded threshold:
```

Step results for that run:

```text
Run DB health checks:      success     <- the harness worked
Prove the checks executed: success     <- execution proved from the receipt
Report DB health verdict:  failure     <- a real finding, and only this means that
```

### 4. Negative demonstration — the logic evaluates, it does not merely start

Both runs are on the same commit. Nothing changed but the threshold, supplied as
a `workflow_dispatch` input and never committed.

```text
# run 30629198346 — no override
"measured":  { "value": 55.62, "unit": "MB", "observed": true }
"threshold": { "value": 300, "unit": "MB", "source": "env" }
"status":    "pass"
counts: { total: 13, executed: 12, passed: 2, tripped: 10, not_run: 1 }
linear_alert: "failed"          threshold_override_active: false

# run 30629281828 — -f threshold_overrides='{"GAME_RESULTS_SIZE_THRESHOLD_MB":"1"}'
"measured":  { "value": 55.62, "unit": "MB", "observed": true }
"threshold": { "value": 1, "unit": "MB", "source": "dispatch_override" }
"status":    "tripped"          "severity": "critical"
counts: { total: 13, executed: 12, passed: 1, tripped: 11, not_run: 1 }
linear_alert: "suppressed_threshold_override"   threshold_override_active: true
```

Same measurement, different threshold, different verdict. A run that only
*started* could not produce that difference.

### 5. Read-only, measured

```json
"read_only": {
  "mechanism": "SET TRANSACTION READ ONLY",
  "observed_transaction_read_only": "on"
},
"target": { "kind": "unidentified", "project_ref": null,
            "host": "aws-1-us-west-2.pooler.supabase.com" }
```

`observed_transaction_read_only` is the value Postgres returned for
`SHOW transaction_read_only` inside the same transaction as the catalog reads.
The execution gate fails unless it is `on`, so a future change that drops the
read-only transaction turns the job red. `target.kind` is `unidentified` because
the pooler hostname carries the project ref in the username rather than in the
host; the boundary permits it because this is an unrestricted context, which is
the documented behaviour for a production monitor.

### 6. Fail-closed behaviour, exercised

```text
$ env -u SUPABASE_DB_URL pnpm exec tsx scripts/ops/db-health-tripwire.ts --receipt r.json
[tripwire] harness error — SUPABASE_DB_URL is not set — no database connection could be opened
PRODUCER=2

$ pnpm exec tsx scripts/ops/db-health-tripwire.ts --assert-executed r.json
[tripwire:gate] FAIL — the receipt does not prove the checks executed:
  - receipt reports zero executed checks — the tripwire started but evaluated nothing. This is the exact defect UTV2-1632 exists to prevent, so it fails closed.
  - receipt outcome is harness_error: SUPABASE_DB_URL is not set — no database connection could be opened
GATE=1

$ pnpm exec tsx scripts/ops/db-health-tripwire.ts --assert-executed /tmp/does-not-exist.json
[tripwire:gate] FAIL — receipt not found at /tmp/does-not-exist.json. The tripwire step must produce a receipt; an absent receipt fails closed rather than passing silently.
GATE=1
```

The pre-fix script's top-level handler was `process.exit(0)`, so every one of
these would previously have been reported as a healthy monitor.

### 7. Static suite

```text
$ pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts
1..57
# tests 57
# pass 57
# fail 0
# cancelled 0
# skipped 0
# todo 0

$ pnpm ci:db-client-boundary
[db-client-boundary] 4 direct driver construction site(s) across 4 file(s)
[db-client-boundary] OK: every site is classified and none is reachable from `pnpm test`

$ pnpm exec eslint <changed files>
LINT=0
```

The 57 tests run inside the required `verify` context via `pnpm test` and
`pnpm test:ops`; no `package.json` script list was modified to achieve that.

## Findings handed on, not fixed here

- **The production bloat and vacuum findings above are real and currently true.**
  They are what the monitor exists to detect and are out of scope for this lane,
  which restores detection. `system_runs` at 1287 MB and a 37.7-day `ANALYZE`
  gap on every hot table are the signature of the June 2026 write-path
  degradation.
- **`statement_timeout_rate` cannot run against its current data source.**
  `GET {SUPABASE_URL}/rest/v1/rpc/get_logs?type=postgres` returns **HTTP 404**;
  that endpoint does not exist. Postgres logs are reachable only through the
  Supabase Management API, which needs a credential this job deliberately does
  not hold. Repairing it would *expand* privilege, so it is recorded honestly as
  `not_run` with the 404 as its reason instead of contributing an invisible pass.
- **The Linear alert destination does not resolve.** The tripwire's tracking
  issue returns "Entity not found: Issue" for the token this workflow holds. The
  lookup and error handling are now correct, and the failure is recorded in the
  receipt and annotated on the run, but the destination itself needs a decision:
  the correct issue, or a different channel.
- The Linear post is the one write this workflow performs. It is a write to
  Linear, not to the database, and it predates this lane.
- **The `runtime` lane contract cannot express a dependency fix.**
  `.lane/lanes/runtime.yml` allows `package.json` but not `pnpm-lock.yaml`.
  Under pnpm 10 with `pnpm install --frozen-lockfile`, a `package.json`
  dependency change without its lockfile entry cannot install, so the pair is
  indivisible and no dependency-adding runtime fix can satisfy the contract as
  written. `Lane authority` is red on this PR for exactly that reason
  (`outside_allowed_paths: pnpm-lock.yaml`). It is not a required context, and
  the contract was deliberately **not** edited here — widening a lane's
  authority to make one's own lane pass is a governance change that belongs in
  its own lane, not a side effect of a runtime fix.
