# PROOF: UTV2-1618
MERGE_SHA: 2e80a15abebc381892755b6c85d1bea3f36edd7c

Bound to the code-only commit carrying the final state of every in-scope file.
Code and proof are deliberately separate commits so the proof can name a SHA
that actually contains the code it describes.

## Summary

Hardens the read-only production diagnostic so its verdict can be trusted, and
fixes the compose image-tag context in the containment workflow that stopped the
first production run verifying its own result.

## ASSERTIONS:

- [x] Every `docker compose` evaluation in both workflows receives
      `UNIT_TALK_IMAGE_TAG`, exported once before the first compose call, failing
      closed on a missing or empty release file.
- [x] A failed required check makes the job red: the remote script exits with its
      accumulated status after emitting all receipts and the sentinel, and
      `set -o pipefail` carries a non-zero ssh exit through `tee`.
- [x] Four independent machine-readable verdicts replace one overloaded marker,
      with the governing contract documented in the workflow itself.
- [x] Host-endpoint reachability is advisory and reported independently; it never
      feeds the overall status.
- [x] Env values are normalised deterministically while the raw value is still
      emitted as classified evidence.
- [x] The host port is normalised at its consumer and rejected when non-numeric
      or outside 1-65535, before any probe URL is constructed.
- [x] The transcript artifact publishes only when the redaction step succeeded; a
      detected secret pattern fails the job and blocks publication.
- [x] Only three non-sensitive keys are read from the environment file, enforced
      by test; the prior partial service-role-key log path cannot return.
- [x] The diagnostic performs no production mutation of any kind.

## EVIDENCE:

### Root cause

The production compose file declares `${UNIT_TALK_IMAGE_TAG:?required}` for every
service. The containment workflow exported it only as an inline prefix on the
`docker compose up` line, so its own pre/post `exec` and `ps` checks could not
interpolate: `printenv` returned `<unset>` and `compose ps` hard-failed under
`set -e`. The run applied containment correctly but could not prove it.

### Mutation verification

Each guard was reverted on a scratch copy and the suite re-run. Every one fails
when its fix is removed:

| Mutation | Result |
|---|---|
| Remove the image-tag export from the containment workflow | fails |
| Remove the image-tag export from the diagnostic workflow | fails |
| Revert `exit "$RC"` to `exit 0` | fails |
| Make host-endpoint failure feed the overall status | fails |
| Delete the completion-sentinel check | fails |
| Reintroduce the partial secret print | fails |
| Publish falls back to a bare `always()` | fails |
| Redaction step loses its stable id | fails |
| Secret guard no longer fails the job | fails (2 tests) |
| Port not normalised at its consumer | fails |
| Port range check removed | fails (11 tests) |
| Invalid port still builds a URL | fails |

The diagnostic-workflow export case was a real coverage gap found by independent
review: removing that export previously left every test green.

## Verification

```
$ pnpm type-check
(clean)

$ pnpm lint
(clean)

$ pnpm test:ops
# tests 1277
# pass 1277
# fail 0
```

`pnpm verify` covers lint, type-check, build and the full test suite. Stages were
run sequentially because `verify:parallel` was OOM-killed locally (exit 137);
that is not treated as a waiver, and CI on the merge SHA is authoritative.

### Scope

Two production-path workflows, two contract test files, `package.json` for test
wiring, plus lane apparatus. No application, domain, package or migration file is
touched. No production dispatch, deploy, rollback, secret change, DB mutation,
row quarantine or networking mutation is part of this lane.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1314
