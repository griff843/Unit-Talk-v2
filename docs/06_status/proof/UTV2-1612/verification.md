# UTV2-1612 — Governed P0 containment workflow

## Summary

Adds `.github/workflows/ops-p0-containment.yml`, a single-purpose `workflow_dispatch`-only
workflow that disables the two blind pick producers (`SYNDICATE_MACHINE_ENABLED`,
`BOARD_PICK_WRITER_ENABLED`) and recreates **only** the `api` service at its current
release image, plus `scripts/ci/ops-p0-containment-workflow.test.ts`, which asserts the
capability boundary statically.

No production mutation occurs from merging this PR. Execution additionally requires PM
dispatch **and** human approval of the `production` environment gate.

## Evidence

### Capability boundary — enforced, not documented

| Constraint | Enforcement site |
|---|---|
| `workflow_dispatch` is the only trigger | `ops-p0-containment.yml:3-9` — single `confirm` input |
| Human approval required per run | `:18` `environment: production` |
| Exact confirmation binding | `:17` `if: ${{ github.event.inputs.confirm == '<literal>' }}` |
| Both flags hardcoded, never inputs | `:142-151` |
| API-only restart, no dependencies | `:173` `docker compose up -d --no-deps --force-recreate api` |
| Current image reused, never pulled | `:96` `CURRENT_IMAGE="$(tr -d '\r\n' < .unit-talk-release)"` |
| Backup precedes any mutation | `:104` `cp -p -- "$ENV_FILE" "$BACKUP_FILE"` |
| Exactly-once validation, fail closed before restart | `:153-161` `-ne 1` guards |
| Value normalization asserted | `:163-170` `grep -qx` |
| Rollback receipt emitted | `:220-223` |

Live repository configuration confirms the human gate is real, not merely declared:

```
$ gh api repos/griff843/Unit-Talk-v2/environments/production
"protection_rules": [{ "type": "required_reviewers",
                       "reviewers": [{ "type": "User", "reviewer": { "login": "griff843" }}]}]
```

Noted for PM: that environment also reports `can_admins_bypass: true` and
`prevent_self_review: false`.

### Independent exact-head review — one P0 found and closed

Cross-provider review (Codex CLI implemented; Claude Opus 5 reviewed the exact head)
returned APPROVE-WITH-CHANGES against head `a9c96afd`, with one release-blocking finding.

**P0 — stdin theft silently truncated the remote script and reported SUCCESS.**
The remote script is delivered to the host on ssh **stdin** via `bash -s` (`:70`).
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
2. The remote script emits a completion sentinel as its final statement (`:226`) and the
   runner asserts it (`:229-236`). Any *future* command that steals stdin therefore turns
   a silent success into a hard job failure.

**P1 — no restore-on-failure between backup and restart.** A failure in the mutate or
validate window left `.env.production` edited. An `EXIT` trap is now armed after the
backup and before the first mutation (`:111-134`); it restores the file when the restart
has not yet run and prints the manual rollback command when it has.

**P1 — containment is not durable.** `deploy.yml:302` rewrites `.env.production`
wholesale, restores `SYNDICATE_MACHINE_ENABLED` from a repository secret, and hard-fails
unless that secret is exactly `"true"` (`deploy.yml:82`, `:233`, `:407`).
`BOARD_PICK_WRITER_ENABLED` does not appear in `deploy.yml` at all, so a deploy would
erase the appended line. Any later deploy therefore reverts containment. The run log now
states this explicitly and names the required follow-up (`:211-218`); a companion action
on the repository secret is still required and is **not** in this lane's scope.

**P2** — appends could concatenate onto a file lacking a trailing newline (guarded at
`:138-140`); the evidence block no longer claims the image tag is redacted while pre-state
prints it.

### Test suite raised from 9 presence checks to 18 contract assertions

The original suite was pure regex-over-text and could not have caught the P0. Added
coverage: stdin redirection, completion sentinel, restore trap, trailing-newline guard,
workflow-context interpolation, network egress targets, bare `docker` verbs, non-API
services including `grading-cron`, database/credential/distribution surfaces, and
`bash -n` syntax validation of every `run:` block.

**Mutation-verified non-tautological — 12 of 12 injected bypasses fail the suite:**

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
| Mutate before the backup | yes |
| Shell syntax error | yes |

## Verification

Merge SHA: pending merge. This bundle is bound to the code head
`6c45d45b2711012ebc5af0962fad0adc91cec947` — the commit carrying the final state of both
in-scope files — and is rebound to the merge SHA at closeout. The proof commit itself is
necessarily a later SHA; embedding it here is the known circular dependency the proof
auditor treats as advisory.

### Contract suite

```
$ tsx --test scripts/ci/ops-p0-containment-workflow.test.ts
1..18
# tests 18
# suites 0
# pass 18
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

Two production-path files, plus lane apparatus:

- `.github/workflows/ops-p0-containment.yml` (new)
- `scripts/ci/ops-p0-containment-workflow.test.ts` (new)
- `.ops/sync/UTV2-1612.yml`, `docs/06_status/lanes/UTV2-1612.json`,
  `docs/06_status/proof/UTV2-1612/*` (lane apparatus, no production effect)

No application, domain, package or migration file is touched.
