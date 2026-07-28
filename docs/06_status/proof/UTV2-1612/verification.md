# PROOF: UTV2-1612
MERGE_SHA: 6718c0de3c125beaa241bb8eb6937a7fa8e5f0bb

Governed P0 containment workflow. `MERGE_SHA` is pinned to the current PR head at the
time of writing and is rebound to the authoritative merge SHA at closeout.

## Summary

Adds `.github/workflows/ops-p0-containment.yml`, a single-purpose `workflow_dispatch`-only
workflow that disables the two blind pick producers (`SYNDICATE_MACHINE_ENABLED`,
`BOARD_PICK_WRITER_ENABLED`) and recreates **only** the `api` service at its current
release image, plus `scripts/ci/ops-p0-containment-workflow.test.ts`, which asserts the
capability boundary statically.

No production mutation occurs from merging this PR. Execution additionally requires PM
dispatch **and** human approval of the `production` environment gate.

## ASSERTIONS:

- [x] The workflow can be triggered only by `workflow_dispatch`, only with the exact
      confirmation string, and only after a human approves the `production` environment.
- [x] Both containment variables are hardcoded to `false` and are never accepted as inputs.
- [x] Only the `api` service is recreated, with `--no-deps`, at the image already recorded
      in `.unit-talk-release`. No pull, build, or tag change occurs.
- [x] `.env.production` is backed up to a timestamped file before any mutation, and a
      failure before the restart restores it automatically.
- [x] Each containment key occurs exactly once and equals `false`, verified before the
      restart; any deviation aborts with the API not restarted.
- [x] The remote script cannot be silently truncated: every remote command that could
      otherwise consume stdin is redirected from `/dev/null` (commands reading an explicit
      file argument do not), and the runner asserts a completion sentinel emitted as the
      final statement.
- [x] No workflow context is interpolated into any shell body, so the operator-supplied
      confirmation string cannot reach a command.
- [x] The workflow performs no database mutation, no credential rotation, no distribution
      change, no migration, and no control of any non-API service.
- [x] Containment shares deploy.yml's `production-deploy` concurrency mutex, so a
      containment run and a deploy cannot interleave against the same `.env.production`.
      `cancel-in-progress: false` protects an in-progress run only — see the mutex section
      for the pending-run and coverage limits, which are real and stated, not claimed away.
- [x] Merging this PR performs no production mutation whatsoever.

## EVIDENCE:

### Capability boundary — enforced, not documented

| Constraint | Enforcement site |
|---|---|
| `workflow_dispatch` is the only trigger | `ops-p0-containment.yml:3-9` — single `confirm` input |
| Serialised against deploy.yml | `:33-35` `concurrency: production-deploy`, `cancel-in-progress: false` |
| Human approval required per run | `:41` `environment: production` |
| Exact confirmation binding | `:40` `if: ${{ github.event.inputs.confirm == '<literal>' }}` |
| Both flags hardcoded, never inputs | `:171-180` |
| API-only restart, no dependencies | `:204` `docker compose up -d --no-deps --force-recreate api` |
| Current image reused, never pulled | `:119` `CURRENT_IMAGE="$(tr -d '\r\n' < .unit-talk-release)"` |
| Backup precedes any mutation | `:127` `cp -p -- "$ENV_FILE" "$BACKUP_FILE"` |
| Exactly-once validation, fail closed before restart | `:182-191` `-ne 1` guards |
| Value normalization asserted | `:192-199` `grep -qx` |
| Rollback receipt emitted | `:254-257` |

Live repository configuration confirms the human gate is real, not merely declared:

```
$ gh api repos/griff843/Unit-Talk-v2/environments/production
"protection_rules": [{ "type": "required_reviewers",
                       "reviewers": [{ "type": "User", "reviewer": { "login": "griff843" }}]}]
```

Noted for PM: that environment also reports `can_admins_bypass: true` and
`prevent_self_review: false`.

### Production deployment mutex

`ops-p0-containment.yml:33-35` declares the same workflow-level concurrency group as
`deploy.yml:19-21` (`production-deploy`, `cancel-in-progress: false`). Both workflows
rewrite `.env.production` on the same host, so without a shared mutex a deploy could
interleave with containment — restoring `SYNDICATE_MACHINE_ENABLED` from the repository
secret between containment's write and its restart. The parity test reads the group out of
`deploy.yml` rather than hardcoding it, so a rename on either side fails the suite instead
of silently unserialising the two.

Two limits of this mutex are stated rather than glossed:

- **Coverage is deploy.yml only, not repo-wide.** `ops-env-patch.yml` and
  `ops-fix-ingestor-api-key.yml` also mutate `.env.production` on the same host and are not
  on the group. Putting them on it is outside this lane's `file_scope_lock` and is recorded
  as a required follow-up. A contract test enumerates these two as known exceptions, so a
  *new* off-mutex mutator fails the suite. The detector resolves variable-bound paths
  (`ENV_FILE=".env.production"` … `sed -i … "$ENV_FILE"`) and covers `sed -i`,
  `sed --in-place`, `perl -i`, `tee`, `mv`, `cp`, `install`, `dd`, `envsubst` and `>`/`>>`
  redirection. An earlier revision matched only the literal path, which excluded the
  containment workflow itself and made its own self-check inert; the exact-head review
  caught that, and the suite now fails if the detector cannot classify the containment
  workflow at all.
- **`cancel-in-progress: false` protects an in-progress run only.** GitHub permits a single
  pending run per group, so a later dispatch evicts an earlier queued one, and a job waiting
  on `environment: production` approval holds the group while it waits. A deploy sitting in
  `waiting` therefore keeps containment queued rather than running, and a second deploy
  dispatch would cancel the queued containment with no error annotation. The workflow header
  (`:23-28`) carries the operator precondition: before dispatching containment during an
  incident, confirm no Deploy run is in progress or awaiting approval, and cancel it first.

### Independent exact-head review — one P0 found and closed

Cross-provider review (Codex CLI implemented; Claude Opus 5 reviewed the exact head)
returned APPROVE-WITH-CHANGES against head `a9c96afd`, with one release-blocking finding.

**P0 — stdin theft silently truncated the remote script and reported SUCCESS.**
The remote script is delivered to the host on ssh **stdin** via `bash -s` (`:93`).
`docker compose exec` keeps stdin attached by default — `-T` disables only the TTY — so
the first `printenv` call drained the remainder of the heredoc. The remote shell then
reached EOF and **exited 0 having created no backup, made no edit and performed no
restart**, while the workflow step reported success. An operator would have approved the
production gate, observed success, and stood down while both producers continued writing
picks priced off month-old odds. This violated the fail-closed contract.

Structural confirmation: `deploy.yml:348` issues the identical `docker compose exec -T api
printenv` call safely, because it passes its script as an ssh **argument** rather than on
stdin. The defect is specific to the stdin delivery used here.

Closed two independent ways, either sufficient alone:

1. Every remote `docker`/`curl` invocation is redirected from `/dev/null`.
2. The remote script emits a completion sentinel as its final statement (`:260`) and the
   runner asserts it (`:263-270`). Any *future* command that steals stdin therefore turns
   a silent success into a hard job failure.

**P1 — no restore-on-failure between backup and restart.** A failure in the mutate or
validate window left `.env.production` edited. An `EXIT` trap is now armed after the
backup and before the first mutation (`:134-163`); it restores the file when the restart
has not yet run and prints the manual rollback command when it has.

**P1 — containment is not durable.** `deploy.yml:302` rewrites `.env.production`
wholesale, restores `SYNDICATE_MACHINE_ENABLED` from a repository secret, and hard-fails
unless that secret is exactly `"true"` (`deploy.yml:82`, `:233`, `:407`).
`BOARD_PICK_WRITER_ENABLED` does not appear in `deploy.yml` at all, so a deploy would
erase the appended line. Any later deploy therefore reverts containment. The run log now
states this explicitly and names the required follow-up (`:245-252`); a companion action
on the repository secret is still required and is **not** in this lane's scope.

**P2** — appends could concatenate onto a file lacking a trailing newline (guarded at
`:167-168`); the evidence block no longer claims the image tag is redacted while pre-state
prints it.

### Test suite raised from 9 presence checks to 21 contract assertions

The original suite was pure regex-over-text and could not have caught the P0. Added
coverage: stdin redirection, completion sentinel, restore trap, trailing-newline guard,
workflow-context interpolation, network egress targets, bare `docker` verbs, non-API
services including `grading-cron`, database/credential/distribution surfaces, and
`bash -n` syntax validation of every `run:` block.

**Mutation-verified non-tautological.** Each case below was injected into a copy of the
workflow, the suite re-run, and the file restored. The independent exact-head review
re-ran a subset against its own copies and reproduced the same results; the table is
spot-verified rather than provable from the repo, since no mutation artifacts are
committed.

| Injected bypass | Caught |
|---|---|
| Remove `</dev/null` from one `compose exec` (the P0) | yes |
| Remove `</dev/null` from the `compose up` restart | yes |
| Remove the completion sentinel | yes |
| `docker compose down` | yes |
| Bare `docker stop unit-talk-ingestor` | yes |
| Add `grading-cron` to the restart | yes |
| `docker pull` | yes |
| Interpolate `${{ github.event.inputs.confirm }}` into a run block | yes |
| `psql -c 'delete from picks'` | yes |
| Webhook `curl -X POST` egress | yes |
| Remove the failure-restore trap | yes |
| `printf "$(docker compose exec ...)"` unredirected | yes |
| Redirect present only in a trailing comment | yes |
| Redirect on an inner `sh -c` only | yes |
| Syntax error inside the quoted heredoc | yes |
| `RESTART_DONE=true` set before the restart | yes |
| A new off-mutex `.env.production` mutator (7 spellings) | yes |
| Detector blinded so the self-check goes vacuous | yes |
| Remove the concurrency block | yes |
| Rename the containment mutex group | yes |
| Set `cancel-in-progress: true` | yes |
| Rename deploy.yml's mutex group (drift) | yes |
| Mutate before the backup | yes |
| Shell syntax error | yes |

## Verification

Merge SHA: pending merge. This bundle is bound to `6718c0de3c125beaa241bb8eb6937a7fa8e5f0bb`, which carries the
final state of both in-scope files — `.github/workflows/ops-p0-containment.yml` and
`scripts/ci/ops-p0-containment-workflow.test.ts`.

Two earlier revisions of this bundle were bound to SHAs that did not contain the code they
described (`6c45d45b`, then `994c11b2`, which had 19 tests while the bundle claimed 21).
Both were caught by independent exact-head review. The cause was structural: writing code
and proof in a single commit means the proof can only ever name an earlier SHA than the one
carrying the code. That is fixed here by splitting them — `6718c0de3c125beaa241bb8eb6937a7fa8e5f0bb` is a
code-only commit, and this proof-only commit binds to it, so every claim below is true at
the SHA named. The bundle is rebound to the authoritative merge SHA at closeout.

### Static verification

```
$ pnpm verify:parallel
(lint + type-check in parallel, then build + full test suite)
exit code 0
```

`pnpm verify` covers lint, type-check, build and the full test suite. The contract suite
below is wired into `test:ops`, so `pnpm verify` executes it.

### Contract suite

```
$ tsx --test scripts/ci/ops-p0-containment-workflow.test.ts
1..21
# tests 21
# suites 0
# pass 21
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### Live-DB runtime proof

```
$ pnpm test:db
# Subtest: database repository bundle persists a submission and settlement against live Supabase
ok 1 - database repository bundle persists a submission and settlement against live Supabase
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 83651.3866
```

Live Supabase project `zfzdnfwdarxucxtaojxm`. This lane ships CI/ops tooling with no DB
schema or query changes; `pnpm test:db` establishes that the live-DB suite remains
undisturbed. The suite writes its own fixture rows — those rows are test artifacts and
must be excluded from any production pick or settlement count.

### Scope

Nine files: three production-path, six lane apparatus.

Production-path:

- `.github/workflows/ops-p0-containment.yml` (new)
- `scripts/ci/ops-p0-containment-workflow.test.ts` (new)
- `package.json` — one line, adding the contract suite to `test:ops` so it actually runs.
  This is a same-lane scope addition and is declared in the lane manifest's
  `file_scope_lock`; it requires an externally authored scope override, since a lane cannot
  authorise its own scope expansion.

Lane apparatus (no production effect): `.ops/sync/UTV2-1612.yml`,
`docs/06_status/lanes/UTV2-1612.json`, `docs/06_status/proof/UTV2-1612/{.gitkeep,
evidence.json, model-routing.json, verification.md}`.

No application, domain, package or migration file is touched.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1313

This section is the machine-rebindable anchor `ops:proof-generate --merge-sha` rewrites at
closeout (`scripts/ops/proof-generate.ts`). Until then the authoritative pre-merge binding
is the `MERGE_SHA:` field at the top of this file, pinned to `6718c0de3c125beaa241bb8eb6937a7fa8e5f0bb`.
