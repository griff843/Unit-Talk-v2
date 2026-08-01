# PROOF: UTV2-1618
MERGE_SHA: 788e227fdbfb122021db440860770879616af91f

Bound to the code-only commit carrying the final state of every in-scope file
(788e227f, extending the original 2e80a15a scope onto `deploy.yml`). Code and
proof are deliberately separate commits so the proof can name a SHA that
actually contains the code it describes.

## Summary

Hardens the read-only production diagnostic so its verdict can be trusted, and
fixes the compose image-tag context in the containment workflow that stopped the
first production run verifying its own result.

**Extension (this commit, 788e227f):** the identical defect class recurred as a
live production incident in `.github/workflows/deploy.yml`'s canary and
production confirm steps. Fixed both, and extended production readiness to
prove the full parked contract plus the public kill-switch state.

### Extension: live incident, root cause, and corrected record

2026-08-01: the parked-mode deploy re-dispatched after the UTV2-1648 GHCR fix
merged. The `canary` job's "Release API canary" step correctly recreated the
API container and it passed its health check. The very next step, "Confirm
syndicate machine gate in canary container", then reported
`SYNDICATE_MACHINE_ENABLED readiness RED: runtime='missing'` and failed the job.

Root cause: the production compose file declares
`${UNIT_TALK_IMAGE_TAG:?required}` on every service, so **every** Compose
evaluation -- not just `up` -- needs that variable. The release step supplied
it; the confirm step's `docker compose exec` did not. Compose therefore failed
closed before `printenv` ever ran, and the confirm script's own
`2>/dev/null || true` discarded that failure and stdout together, so a
genuine Compose evaluation error was misreported as "the variable is absent at
runtime" -- a different, misleading failure class.

**Corrected incident record:** only the canary job's API container was ever
recreated. `promote` and every other production service (ingestor, worker,
discord-bot) were never touched -- `promote` correctly never ran, since
`canary`'s own job failure (from the broken confirm step, not from the actual
container state) blocked the pipeline before promotion.

Fix, applied to both the canary and production confirm steps:
1. Resolve the exact deployed tag from the host's own `.unit-talk-release`
   record (written by the release step moments earlier) and cross-check it
   against the tag this job resolved, independent of anything compose reports.
2. Supply `UNIT_TALK_IMAGE_TAG` on every `docker compose exec` in these steps.
3. Remove all `2>/dev/null || true` suppression from these checks; capture
   stdout+stderr together and the real exit status.
4. Classify failures precisely: Compose evaluation failed (variable
   unset/required) / service or container could not be resolved / variable
   absent in the container / variable value mismatch -- four distinct
   `::error::` messages instead of one collapsed "missing" case.
5. Independently cross-verify every checked value via `docker ps --filter
   label=com.docker.compose.service=...` + `docker inspect` against the
   container's real `Config.Env` and image reference -- a path that performs
   no Compose-file evaluation at all, so it cannot be broken by this same bug
   class, and cross-validates rather than replaces the compose-exec result.
6. Production readiness now also queries the live Supabase
   `delivery_kill_switch` table (read-only, via `curl` + the service-role
   key already available to the job) and fails closed unless both
   `best-bets` and `trader-insights` report `killed=true` -- proving the
   public-delivery defense-in-depth containment survived the deploy, not
   just the container-level parked-mode variables.
7. Five new regression tests in `scripts/ci/deploy-parked-mode.test.ts` lock
   in items 2-6 above by mutating the fixed workflow source back toward each
   specific defect and asserting the static audit catches it.

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

### Live-DB runtime proof

```
$ pnpm test:db
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 84746.106151
```

Live Supabase project `zfzdnfwdarxucxtaojxm`. This lane ships CI/ops workflows
with no DB schema or query changes; `pnpm test:db` establishes that the live-DB
suite remains undisturbed. The suite writes its own fixture rows, which are test
artifacts and must be excluded from any production pick or settlement count.

### Static verification

```
$ pnpm type-check
(clean)

$ pnpm lint
(clean)

$ pnpm test:ops
# tests 1881
# pass 1881
# fail 0

$ npx tsx --test scripts/ci/deploy-parked-mode.test.ts
# tests 20
# pass 20
# fail 0
```

`pnpm test` (the full composite) fails inside `test:apps`, earlier in the chain
than `test:ops`, due to a pre-existing local.env misconfiguration in this
worktree (`UNIT_TALK_API_RUNTIME_MODE=test`, an invalid value) -- reproduced
identically with this diff's changes fully `git stash`ed out, confirming it is
unrelated and pre-existing. `local.env` is gitignored and not part of this
diff. CI on the merge SHA runs in a clean environment and is authoritative.

### Scope

Two production-path CI/diagnostic workflows, `.github/workflows/deploy.yml`,
three contract test files, `package.json` for test wiring, plus lane apparatus.
No application, domain, package or migration file is touched. No production
dispatch, deploy, rollback, secret change, DB mutation, row quarantine or
networking mutation is part of this lane -- deploy.yml's change is to
verification logic only, not to what gets deployed or how.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1314
