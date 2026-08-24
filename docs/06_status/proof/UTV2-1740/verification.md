# PROOF: UTV2-1740

MERGE_SHA: 10c3f82dbf06aa95cbdd352d061ad20b645bc436

Verified source SHA: `10c3f82dbf06aa95cbdd352d061ad20b645bc436`

This lane supersedes the previous alerting runtime lane, whose PR remains open
and preserved. T1 approval there was refused for a fail-open production defect
and three evidence contradictions. Every figure below was produced by a command
run against this lane at this head.

## ASSERTIONS:

- [x] The scheduled pass receives the loaded configuration. `main()` previously
  called `runScheduledAlertPass(repositories)` without it, so the pass read
  `process.env` and file-configured values were ignored.
- [x] The disabled path performs **zero writes** — zero detections persisted,
  zero `system_runs` started, zero notified updates — and zero delivery attempts.
- [x] The zero-write claim is not self-confirming: moving the throw *after* the
  detection pass, so it still rejects with the same message but writes first,
  fails on the write counter rather than the rejection.
- [x] The call site itself is guarded. Behavioural tests inject a configuration
  directly and structurally cannot observe an omission at the call site;
  reverting it to its shipped form fails a dedicated wiring guard.
- [x] Member delivery stays canary-only, system picks disabled, no SGO or
  ingestion triggers, production parked.
- [x] One durable independent review, APPROVE, bound to this lane's head.

## Scope of the fix — stated exactly

This closes the **operator path**, not the scheduled-workflow path. Measured:

```text
workflow (process.env ALERT_AGENT_ENABLED='true')  -> enabled=true
operator (variable absent from the process)        -> enabled=false
```

`ALERT_AGENT_ENABLED` is a declared `AppEnv` key and `readEnvValue` reads
`process.env` first, so the scheduled workflow's explicit `'true'` still wins.
An earlier revision of this lane's own comment and one test name claimed the
loaded configuration wins over `process.env` generally. That was wider than the
evidence and is withdrawn. Making the workflow path honour file configuration
means removing that variable from the workflow env — a production-posture change
outside this correction.

## EVIDENCE:

```text
verify:static: PASS (exit 0)
focused runtime: PASS (23 tests, 0 failed)
disabled path: 0 writes, 0 delivery attempts
mutations killed: 3 of 3
r-level check: PASS (6 changed files, no rules matched)
```

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm exec tsx --test 'scripts/ingestor-alert-check.test.ts'` | PASS | 23 tests passed, 0 failed. |
| `pnpm verify:static` | PASS | Exit 0. |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | Verdict: PASS. 6 changed files. Rules matched: (none). |
| Disabled-path write audit | PASS | detections 0, notified 0, runsStarted 0, runsCompleted 0, fetch 0. |
| `pnpm test:db` (writable, staging) | CI | Runs in the governed `staging-ci` environment; credited to CI, not asserted here. |

### Mutation testing

Three mutations, all killed:

```text
remove the enabled check                  -> 2 failures (both zero-write tests)
move the throw after the detection pass   -> fails on the WRITE COUNTER, not the rejection
revert the call site to its shipped form  -> fails the wiring guard
```

The second is the decisive one: a test asserting only `assert.rejects` would
have passed it.

### Known limitations

- The fix closes the operator path only, as measured above.
- Retry truncation still precedes filtering: `listRecent` applies its limit
  before the `notified=false` and window filters. Raising it to 2000 narrows
  exposure without removing it; the repair belongs in the `packages/db` query,
  outside this lane. Production holds 176 undelivered rows against that limit.
- The member-channel policy is enforced in this entry point only; the dormant
  alert-agent service would deliver unguarded.
- A disabled agent alerts every scheduled run and reds the workflow. Pre-existing
  and arguably correct — silent disablement is how the previous outage persisted.

### Substantive diff stat

```text
.github/workflows/ingestor-staleness-alert.yml |  60 +-
scripts/ingestor-alert-check.test.ts           | 706 ++++++++++++++++++++-
scripts/ingestor-alert-check.ts                | 826 ++++++++++++++++++++-----
3 files changed, 1430 insertions(+), 162 deletions(-)
```
