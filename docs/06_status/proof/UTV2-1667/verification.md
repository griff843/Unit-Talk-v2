# PROOF: UTV2-1667

MERGE_SHA: fb4aa9d90152e0a2dadc6bf0a2013eaf630fbe8a

Lane: readiness must evaluate every service against its declared, independently verified desired runtime mode.
Tier: T1 · lane_type: runtime
Scope of this pass: the transferred parked-readiness requirement only. The issue's host-journal, monotonic-`journal_sequence` and live-host-observer work is deliberately not attempted here — see §5.
Verified source SHA: `fb4aa9d90152e0a2dadc6bf0a2013eaf630fbe8a` — the implementation commit every command below was executed against. Post-merge rebinding replaces the `MERGE_SHA` above with the merge commit; nothing else in this file is SHA-dependent.

## Summary

`scripts/ops/readiness-refresh.ts` had no parked-mode semantics at all (`grep -n parked` matched nothing before this change). It scored every service as if production were always supposed to be running, so a deliberately parked machine and a dead one produced the same reading.

Every service is now classified into exactly one of six states against the mode its own deploy declared, the declaration is read from a receipt the protected `production`-environment deploy job publishes rather than inferred here, and anything that cannot be proved is reported `unreadable` — never guessed, never scored as passing.

## Verification

ASSERTIONS:

- [x] Six-state classification implemented: `active_healthy`, `active_degraded`, `active_failed`, `parked_verified`, `parked_drift`, `unreadable`. Each state is reached in tests by the condition that names it, not by construction.
- [x] `parked_verified` is not reported as ordinary health: the dimension's evidence string states `PARKED_VERIFIED (not active health)` and the assertion `assert.doesNotMatch(dimension.evidence, /\bhealthy\b/)` holds on the parked path.
- [x] `parked_verified` does not produce the failure a dead active service produces: the same silent database fixture yields `pass` under a parked declaration and `fail` under an active one. The declaration is the only thing that differs.
- [x] In active mode stale ingestor cycles and worker heartbeats remain hard failures — the pre-existing thresholds (30m cycle, 30m merged offers, 30m heartbeat) are unchanged and still fail.
- [x] In parked mode absence of activity passes only when all parked evidence passes. Any ingestor cycle, merged provider cycle, worker heartbeat, queue claim or public delivery recorded after the parked deployment, any disengaged public kill switch, and any parked environment value that differs from the declared contract each produce a hard failure.
- [x] `unreadable` is fail-closed and explicit: no receipt, an in-flight deploy, a malformed receipt, a receipt bound to another `(run_id, run_attempt)`, an unreadable database, or an observation past the retention SLA all report `unknown` with the reason recorded, and `computeVerdict` never scores `unknown` as passing.
- [x] The declaration is never inferred locally. `SYNDICATE_MACHINE_ENABLED` is a protected production secret; the mode is read only from the `runtime-mode-receipt/v1` artifact the promote job publishes after its own container-level assertions have passed.
- [x] Attempt binding is honoured: the receipt is keyed to `(run_id, run_attempt, stage)`, every attempt of the candidate run is searched newest-first, and a receipt whose recorded run/attempt does not match the one it was published under is rejected rather than adopted.
- [x] Run discovery is never scoped to `branch: 'main'`. A test asserts the exact argument passed to `latestRun` is `('deploy.yml', undefined)`.
- [x] A malformed newest-attempt receipt fails closed instead of falling through to an older valid attempt.
- [x] Facts that parking does not explain are kept separate from the parked verdict: ingestion that had already stopped before the parked deployment is surfaced as its own finding under `parked_verified`, and outbox rows stuck mid-flight fail in every mode including `parked_verified`.
- [x] An absent assessment is never read as "assume active": `serviceRuntimeState(undefined, …)` returns `unreadable`, and the affected probe keeps its measured values while refusing to score them.
- [x] Read-only guarantee preserved: the existing source scan for `.insert(`/`.update(`/`.upsert(`/`.delete(`/`.rpc(` still passes; every new database read goes through `ReadOnlyDb`.
- [x] No already-landed invariant weakened: the kill-switch fail-closed check, the `.unit-talk-release` cross-check, the docker-inspect cross-validation and the parked-mode `UNIT_TALK_ENABLED_TARGETS=none` assertion in `deploy.yml` are untouched — `scripts/ci/deploy-parked-mode.test.ts`'s full static audit still passes unmodified.
- [x] No production mutation, activation, unpark, rollback, restart, queue replay, deploy or secret change was performed while implementing or verifying. The only production contact was read-only `gh api` GETs.
- [x] No host infrastructure provisioned. No observer account, sudoers wrapper or pinned host key exists or is required by the code that shipped.

## Runtime Verification

EVIDENCE:

### 1. Every control proved by making it fail on the condition it names

Presence and a green run prove nothing, so each control was removed or inverted in `scripts/ops/readiness-refresh.ts` and the suite re-run. The named tests went red on the mutation and green again on restoration. All output below is verbatim.

```text
$ # MUTATION 1 — parked-drift detection removed (`if (findings.length > 0)` -> `if (false)`)
$ pnpm exec tsx --test scripts/ops/readiness-refresh.test.ts
not ok 29 - parked_drift: an ingestor cycle after the parked deployment is a hard failure
not ok 30 - parked_drift: a queue claim or a public delivery after the parked deployment is a hard failure
not ok 31 - parked_drift: a disengaged public kill switch is a hard failure even with zero activity
not ok 32 - parked_drift: a parked value that drifted from the declared contract is a hard failure
# tests 42
# pass 38
# fail 4

$ # MUTATION 2 — an unreadable mode silently assumed active (serviceRuntimeState returns active_healthy)
not ok 40 - an unassessed mode is never treated as active — the probe keeps the reading and refuses the verdict
# tests 42
# pass 41
# fail 1

$ # MUTATION 3 — the observation freshness SLA removed
not ok 36 - unreadable: an observation past the SLA is not published as parked_verified
# tests 42
# pass 41
# fail 1

$ # MUTATION 4+5 — malformed newest receipt falls through to an older attempt; discovery re-scoped to branch main
not ok 23 - deploy-run discovery is never scoped to a branch, so an off-main dispatch is not read as no deploy at all
not ok 25 - a malformed receipt on the newest attempt fails closed instead of falling through to an older valid one
# tests 42
# pass 40
# fail 2

$ # MUTATION 6+7 — stuck outbox rows excused by parking; the pre-park stoppage finding dropped
not ok 38 - parked silence does not erase the fact that ingestion had already stopped before the machine was parked
not ok 39 - parking does not excuse rows stuck mid-flight — those fail in every mode
# tests 42
# pass 40
# fail 2
```

Restored source, same command:

```text
$ pnpm exec tsx --test scripts/ops/readiness-refresh.test.ts
# tests 42
# pass 42
# fail 0
```

(The suite grew by one executable test after these runs — §2 — so the totals above are from the pre-§2 source and are quoted as they were printed, not restated.)

### 2. The producer and the consumer, executed against each other

The receipt-writing block is lifted out of `.github/workflows/deploy.yml` by the test itself, executed under `bash -euo pipefail` with the values the confirm step proves, and the bytes it writes are fed to this reader's own parser — no hand-written fixture is involved on that path.

```text
$ pnpm exec tsx --test scripts/ops/readiness-refresh.test.ts
ok 43 - EXECUTABLE: the receipt deploy.yml actually writes is one this reader accepts, and no identity means no receipt
```

The same test asserts the fail-closed branch: with the Actions run identity absent there is nothing to bind the receipt to, so the step writes no file at all and emits `::warning::runtime-mode receipt not written`. Readiness then reports the desired runtime mode `unreadable`.

The pre-existing static audit of the deploy workflow was re-run unmodified to confirm no landed parked-mode invariant was weakened:

```text
$ pnpm exec tsx --test scripts/ci/deploy-parked-mode.test.ts
# tests 25
# pass 25
# fail 0
```

### 3. The live reading this produces today, stated as it is

The current production truth was read read-only, with no mutation of any kind:

```text
$ gh api "repos/griff843/Unit-Talk-v2/actions/workflows/deploy.yml/runs?per_page=3" \
    --jq '.workflow_runs[] | {id, run_attempt, status, conclusion, head_branch, updated_at}'
{"conclusion":"success","head_branch":"main","id":30712489763,"run_attempt":1,"status":"completed","updated_at":"2026-08-01T18:36:45Z"}
{"conclusion":"failure","head_branch":"main","id":30707667190,"run_attempt":1,"status":"completed","updated_at":"2026-08-01T16:21:25Z"}
{"conclusion":"failure","head_branch":"main","id":30705483826,"run_attempt":1,"status":"completed","updated_at":"2026-08-01T15:27:14Z"}

$ gh api "repos/griff843/Unit-Talk-v2/actions/runs/30712489763/artifacts" --jq '.total_count, (.artifacts[] | .name)'
5
smoke-result-30712489763.json
griff843~Unit-Talk-v2~2ZSFFK.dockerbuild
griff843~Unit-Talk-v2~S4539K.dockerbuild
griff843~Unit-Talk-v2~ZNO52Q.dockerbuild
griff843~Unit-Talk-v2~1CVVRR.dockerbuild
```

The last production deploy predates this change, so it published no runtime-mode receipt. The generator was then run read-only, writing outside the repository so the canonical ledger was not touched:

```text
$ pnpm exec tsx scripts/ops/readiness-refresh.ts --out <scratch>/ledger.json
READINESS LEDGER
  verdict:       RED
  observability: degraded
  runtime mode:  declared unreadable — api=unreadable ingestor=unreadable worker=unreadable
  target:        no production DB handle

  [UNKN] service_runtime_mode (blocking)
         UNREADABLE: the desired runtime mode of at least one service is unproven.
         api, ingestor, worker: the most recent deploy.yml run
         https://github.com/griff843/Unit-Talk-v2/actions/runs/30712489763 (conclusion "success")
         published no runtime-mode receipt on any of its 1 attempt(s): attempt 1: gh run download
         30712489763 -n runtime-mode-receipt-30712489763-1 failed: ... no artifact matches any of
         the names or patterns provided. Not scored as passing, and not scored as an
         active-service failure either. Phase-1 limitation (DEPLOYMENT_TRUTH_DESIGN.md §12a/row 16):
         an out-of-band container replacement made after the receipt observed_at is not detectable
         here — a live host read is not provisioned, so nothing about the current instant is
         inferred from the receipt.
  [FAIL] deploy_sha_alignment (blocking)
  ...
  blockers:  deploy_sha_alignment
  unreadable: service_runtime_mode, ingestor_health, worker_outbox_health, dead_letter_count,
              db_tripwires, constitution_convergence
```

Three things this establishes. The correct outcome for an unproven mode is `unreadable` with the failing command quoted, not a guess. The verdict stays **RED** — nothing was turned green by adding mode-awareness. And the ingestor and worker dimensions read `unknown` here only because no production database credential exists in this containment environment; that refusal is stated with its own reason and predates this change.

This is the honest state of the channel today: the producer side ships here, and the first reading of a real declared mode is only possible after the next production deploy runs `deploy.yml`. No deploy was triggered to manufacture one.

### 4. Gate commands executed, verbatim

Every command below was executed on this lane branch, at the implementation commit named at the top of this file. Results are recorded as they were printed.

```text
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
  -> clean, exit 0

$ pnpm test
  -> exit 0 (every test group green)

$ pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1667
Verdict: PASS
Changed files: 24
Rules matched: lifecycle-fsm

Advisory (PM-gated) artifacts missing:
  - r4-fault-report [PM-gated]
  -> exit 0

$ pnpm verify
> pnpm verify:static && pnpm test:live-db
  -> verify:static GREEN: ci:db-client-boundary, ops:sync-check, ops:system-alignment-check,
     ops:automation-coverage-check, env:check, lint, type-check, build, the full unit suite,
     @unit-talk/smart-form verify, and verify:commands all passed.
     Unit-suite totals summed across every TAP group in the run:
       tests=4991 pass=4991 fail=0 skipped=0
  -> test:live-db REFUSED:

     > @unit-talk/v2@0.1.0 ci:assert-staging
     > tsx scripts/ci/assert-staging-target.ts
     [assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
     [assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
     Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub
     environment with CI_SUPABASE_* credentials.

  -> VERIFY_EXIT=1
```

**`pnpm verify` is NOT green on this workstation, and is reported that way.** It exits 1. The sole cause is `ci:assert-staging` refusing the containment sentinel `127.0.0.1` before a single database test runs — no lint, type-check, build or test failure occurs anywhere in the run. The T1 database gate is therefore *unsatisfied here*, not waived: it has to be executed through the `staging-ci` GitHub environment on the merge SHA, and this proof does not claim otherwise.

### 5. What host provisioning would be needed, and what was not done without it

`DEPLOYMENT_TRUTH_DESIGN.md` §12a specifies a live host read behind a dedicated observer account, a root-owned forced-command wrapper, pinned host keys, no PTY, no agent forwarding and no `docker` group membership. None of that is provisioned and none of it was authorised for this lane, so none of it was built and no credential for it exists in this change.

The consequences are stated rather than papered over:

- Proving container state *at the current instant* is impossible here. The receipt proves it at `observed_at`; an out-of-band container replacement made afterwards is not detectable. This is the same accepted phase-1 limitation the design document records in regression-matrix row 16, and the dimension prints it in its own evidence text on every single run — it is never left implicit.
- An observation older than the artifact-retention horizon reports `unreadable`, not `parked_verified`. Only a live host read or a fresh deploy can refresh it, and the reason names both.
- The design document's §4/§5/§5.5 host journal, §8 `source_sha` provenance, §10 monotonic `journal_sequence` ordering and §13 three-way `deploy_sha_alignment` classification are not implemented in this pass. `deploy_sha_alignment` is unchanged.

### 6. Out of scope, recorded

- **`.github/workflows/readiness-refresh.yml` needs `actions: read`.** That job declares `permissions: contents: write, issues: write` and runs the generator with `GH_TOKEN: ${{ github.token }}`. With an explicit permissions block every unlisted scope is `none`, so `gh run download` cannot read run artifacts and the mode dimension will report `unreadable` even after a deploy publishes a receipt. The failure is legible — the gh error is quoted verbatim into `unreadable_reason` — but the fix is a one-line permission addition in a file outside this lane's declared scope, so it was reported rather than made.
- **`probeDeploySha` still passes `branch: 'main'`** to `latestRun('deploy.yml')`. `deploy.yml`'s `workflow_dispatch` trigger carries no branch restriction, so a tag or non-main dispatch is a real production deploy that this filter hides. The new mode dimension deliberately does not filter; `deploy_sha_alignment` belongs to the design document's own phase-1 work and was left untouched here rather than half-changed.
- **The lane manifest's `expected_proof_paths` names `evidence.json` and `model-routing.json`**, neither of which is in this lane's declared file scope. They were not created.
- `GENERATOR_VERSION` is bumped because measurement semantics changed; the ledger schema version is unchanged, since no top-level ledger field was added or removed.
