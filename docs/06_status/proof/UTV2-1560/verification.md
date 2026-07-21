# PROOF: UTV2-1560

MERGE_SHA: 8f8cf3a575b9ad179b2e07b9283f086e11f50a72

(This is the reviewed-implementation content commit, an ancestor of this
branch's actual head — a file cannot bind its own future hash once further
proof-doc commits land on top of it, per this repo's established
convention.)

## Summary

Continuation of PR #1258 (frozen at the T1 bounce limit per PM direction),
carrying forward the exact same already-reviewed content on a fresh branch
from current main. PR #1256 (the original read-only network diagnostic) is
already merged and unaffected; this continuation adds two diagnostic-gap
fixes to that workflow plus a new narrow, `workflow_dispatch`-only
worker-recovery workflow.

This revision fixes a live Codex P2 finding on the manual-restart
verification signal (RestartCount -> StartedAt, see below) and restores
`test:ops` wiring for the recovery workflow's regression test now that the
two lanes that previously locked that `package.json` line have both merged.

## Verification

### ASSERTIONS:

- [x] `.github/workflows/ops-network-diagnose.yml` hardening carried forward unchanged from the accepted #1258 content (robust DB/pooler key discovery, curl-or-node HTTPS fallback)
- [x] `.github/workflows/ops-worker-recovery.yml` (new, `workflow_dispatch`-only) carried forward, with the manual-restart verification signal replaced (see "RestartCount defect fix" below)
- [x] `scripts/ops/worker-recovery-workflow.test.ts` passes (13/13), including the PM-verdict-requested Codex P2 fixes (env-passthrough for `inputs.confirm`, escaped nested quotes in the SSH python one-liner) and the new StartedAt-gating regression test
- [x] No API restart, deploy, or environment mutation anywhere in either workflow
- [x] This PR does not dispatch the recovery workflow
- [x] `pnpm test:db` PASS (7/7, live Supabase)
- [x] `pnpm verify` PASS (exit code 0), including all live-DB suites
- [x] `test:ops` now wires in `scripts/ops/worker-recovery-workflow.test.ts` and it runs as part of `pnpm test`/`pnpm verify`

## RestartCount defect fix (this revision)

**Finding (Codex P2, live on the prior head):** verifying a successful
manual restart by checking that Docker's `RestartCount` advanced by exactly
1 is unreliable. `RestartCount` reflects only restarts performed by the
container's own restart policy (`on-failure`/`always`) — it does **not**
increment for an operator-initiated `docker restart` invocation, which is
exactly what this workflow performs. Gating success on it would fail closed
on every legitimate manual recovery (a false negative on every real run).

**Fix:** replaced the gating check with the container's `.State.StartedAt`
timestamp, captured as `PRE_STARTED_AT`/`POST_STARTED_AT` immediately
alongside the existing `RestartCount` capture. Docker sets `StartedAt`
every time the container's process actually starts, whether the restart was
manual or policy-triggered, so it is a reliable, restart-cause-agnostic
signal. The workflow now requires both timestamps to be non-empty and
requires `pre != post` for PASS; `RestartCount` is still captured and
logged for audit purposes (per the workflow's own auditability header
comment) but no longer gates PASS/FAIL. Both the pre- and post-state
`docker inspect` summary lines now also print `StartedAt` for auditability.

## EVIDENCE:

```text
$ pnpm exec tsx --test scripts/ops/worker-recovery-workflow.test.ts
# tests 13
# suites 0
# pass 13
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

```text
$ pnpm type-check
(clean, no errors)
```

```text
$ pnpm verify
> @unit-talk/v2@0.1.0 verify
> pnpm verify:static && pnpm test:live-db
  ops:sync-check ... PASS
  ops:system-alignment-check ... PASS
  ops:automation-coverage-check ... PASS
  env:check ... PASS
  lint ... PASS
  type-check ... PASS
  build ... PASS
  test (all suites, including live-DB suites e.g. claimNextAtomic
        concurrency, settlement corrections, alert-agent brake paths) ... PASS
  test:live-db -> test:db (7/7) && test:t1-proof:live ... PASS
(exit code 0)
```

```text
$ pnpm test:db
> tsx --test apps/api/src/database-smoke.test.ts
TAP version 13
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

```text
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 13
Rules matched: (none) — no R-level artifacts required for this diff
```

## Known gaps

- The Docker daemon events window (`--since 168h`) covers 7 days; if the
  original 314-restart count accumulated over a longer period, older
  individual events will have rotated out of the daemon's event log.
  `RestartCount` and `.State` still report the current lifetime total
  regardless (informational only, no longer gates verification — see above).
- Deploy-timestamp correlation is done at the analysis layer against
  `gh run list` history after the artifact is downloaded, not inside the
  SSH probe itself.
- **File Scope Lock** (advisory check, not in `main`'s required status
  checks) fails: `docs/06_status/lanes/UTV2-1560.json` on `main` is a ghost
  manifest left over from PR #1256 (merged, but its `status` was never
  advanced past `"started"` and its `branch` field still names the original
  `claude/utv2-1560-hetzner-supabase-502-diagnosis` branch). The file-scope
  guard trusts the base-branch copy of any manifest path that already
  exists there, so this PR's own diff cannot correct it. Fixing this
  requires a `main`-side `ops:lane-close --repair-merged` reconciliation,
  which is outside this lane branch's scope (no direct-main changes
  permitted) and outside this session's authorized actions.
- **Readiness Regression Gate** (advisory, not in `main`'s required status
  checks) fails on a repo-wide, pre-existing `readiness-score.json` ledger
  (stale, verdict RED) unrelated to any file this lane touches.

## Owner boundary

T1 — production investigation. Requires the `t1-approved` label and a
Griff-authored `pm-verdict/v1` APPROVED comment bound to the reviewed head
before merge. This proof supplies neither. No workflow dispatch or
production restart is authorized by this lane.
