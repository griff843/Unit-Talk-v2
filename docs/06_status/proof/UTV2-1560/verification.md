# PROOF: UTV2-1560

MERGE_SHA: 5546c7324415fff7feb2c574bdc583c899a4b2c9

## Summary

Continuation of PR #1258 (frozen at the T1 bounce limit per PM direction),
carrying forward the exact same already-reviewed content on a fresh branch
from current main. No new implementation changes beyond wiring the test
into `test:ops`. PR #1256 (the original read-only network diagnostic) is
already merged and unaffected; this continuation adds two diagnostic-gap
fixes to that workflow plus a new narrow, `workflow_dispatch`-only
worker-recovery workflow.

## ASSERTIONS:

- [x] `.github/workflows/ops-network-diagnose.yml` hardening carried forward unchanged from the accepted #1258 content (robust DB/pooler key discovery, curl-or-node HTTPS fallback)
- [x] `.github/workflows/ops-worker-recovery.yml` (new, `workflow_dispatch`-only) carried forward unchanged
- [x] `scripts/ops/worker-recovery-workflow.test.ts` passes (12/12)
- [x] No API restart, deploy, or environment mutation anywhere in either workflow
- [x] This PR does not dispatch the recovery workflow
- [x] `pnpm test:db` PASS (7/7, live Supabase)

## EVIDENCE:

```text
$ pnpm exec tsx --test scripts/ops/worker-recovery-workflow.test.ts
# tests 12
# suites 0
# pass 12
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
$ pnpm test:db
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
```

## Known gaps

- The Docker daemon events window (`--since 168h`) covers 7 days; if the
  original 314-restart count accumulated over a longer period, older
  individual events will have rotated out of the daemon's event log.
  `RestartCount` and `.State` still report the current lifetime total
  regardless.
- Deploy-timestamp correlation is done at the analysis layer against
  `gh run list` history after the artifact is downloaded, not inside the
  SSH probe itself.

## Owner boundary

T1 — production investigation. Requires the `t1-approved` label and a
Griff-authored `pm-verdict/v1` APPROVED comment bound to the reviewed head
before merge. This proof supplies neither.
