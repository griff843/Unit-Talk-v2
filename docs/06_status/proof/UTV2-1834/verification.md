# PROOF: UTV2-1834

MERGE_SHA: 1d76b75e1296871346284c50032b706009416fc6

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-05T17:55:00.000Z
Issue: UTV2-1834
Tier: T2
Lane type: governance
Branch: claude/utv2-1834-deploy-config-rollback
Head SHA: 901bce784354ee4b2098611bc0278c04c13209da
result: pass

## Summary

`deploy/rollback.sh` rolled the container image tag back and nothing else, while
`.github/workflows/deploy.yml` overwrites `.env.production`, `.env.web` and
`.env.smart-form` in place on every deploy. A rollback therefore produced **the old image
running against the new configuration** — a pairing that was never deployed and never
tested — and no check anywhere detected it.

This lane adds the missing half: `deploy.yml` snapshots the outgoing configuration before
it overwrites anything, and `rollback.sh` restores the snapshot matching the tag it rolls
back to. It also corrects two operator documents that still described the pre-canonical-id
`ALLOWED_CAPPER_EMAILS` shape.

The lane changes a workflow, a deploy shell script, a new CI test, one line of `test:ops`
wiring and two Markdown documents. It changes no application code, no schema, no gate, no
tier and no merge authority.

## ASSERTIONS:

- [x] A1 — The snapshot step exists in **both** the `canary` and `promote` jobs and its step
      index is lower than that job's first `.env.production` write. Ordering is the entire
      control: `.unit-talk-release` is only advanced after the env writes, so a snapshot
      taken one step later would capture the *incoming* configuration and silently make
      rollback useless.
- [x] A2 — The snapshot is keyed on `$(cat .unit-talk-release)` and not on the incoming
      image tag, so the snapshot is named after the release whose configuration it holds.
- [x] A3 — All three configuration files the deploy overwrites are snapshotted.
- [x] A4 — A host with no `.unit-talk-release` (first-ever deploy) exits 0 rather than
      failing the deploy.
- [x] A5 — `rollback.sh` restores all three files before `docker compose up`, so the
      containers start against the configuration that ran with the image being restored.
- [x] A6 — A missing snapshot **warns and continues** rather than aborting, and the warning
      says explicitly that the code rolled back and the configuration did not.
- [x] A7 — Functional round trip: executing the workflow's own snapshot heredoc and the
      script's own emitted remote command against a temp directory restores byte-identical
      contents at mode 0600.
- [x] A8 — The pre-existing `rollback-dry-run` CI job still exits 0 against the modified
      script.
- [x] A9 — `docs/05_operations/REQUIRED_SECRETS.md` and `deploy/production/ENV_FILES.md`
      now state the `<email>=<canonicalCapperId>` pair shape, the silent-drop behaviour of
      an entry without `=`, and that only emptiness is ever validated.
- [x] A10 — Every control was made to fail on the condition it names. Six mutations, six
      distinct named failures. See `## Control mutations`.
- [x] `pnpm type-check` exit 0; `pnpm test` 5485/5485 with 0 failures and 0 `not ok` lines,
      exit 0; `r-level-check` PASS with no rules matched.

## EVIDENCE:

```
$ pnpm type-check
> @unit-talk/v2@0.1.0 type-check
> pnpm exec tsc -b tsconfig.json
(no diagnostics)
TYPECHECK_EXIT=0

$ pnpm test
# tests 5485
# pass 5485
# fail 0
"not ok" lines: 0
TEST_EXIT=0

$ pnpm exec tsx --test scripts/ci/deploy-config-rollback.test.ts
# tests 9
# pass 9
# fail 0

$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 9
Rules matched: (none) — no R-level artifacts required for this diff
RLEVEL_EXIT=0

$ bash deploy/rollback.sh --dry-run --tag "$(git rev-parse HEAD)"
OK exit 0        # the pre-existing rollback-dry-run job's exact invocation

$ git diff --stat 879569a1ba762499fadee24aa0041a216f208391..HEAD
 .github/workflows/deploy.yml              |  82 +++++++++++
 .ops/sync/UTV2-1834.yml                   | 176 +++++++++++++++++++++++
 deploy/production/ENV_FILES.md            |   5 +-
 deploy/rollback.sh                        |   9 ++
 docs/05_operations/REQUIRED_SECRETS.md    |   2 +-
 docs/06_status/lanes/UTV2-1834.json       |  41 ++++++
 docs/06_status/proof/UTV2-1834/.gitkeep   |   0
 package.json                              |   2 +-
 scripts/ci/deploy-config-rollback.test.ts | 232 ++++++++++++++++++++++++++++++
 9 files changed, 546 insertions(+), 3 deletions(-)
```

`pnpm verify` is not restated as a local run. The required CI `verify` context executes it
on this branch; citing it as a local result would be a claim no local artifact supports.

## Control mutations

Each mutation changes exactly one thing. The table records which **named** test refused it.
Mutations were applied to an isolated copy of the changed files; none touched the branch.

| # | Mutation | Named test that failed |
|---|---|---|
| M1 | Snapshot step moved to AFTER the promote job's first env write | `promote: snapshots the outgoing configuration before overwriting it` |
| M2 | Keyed on `$UNIT_TALK_IMAGE_TAG` instead of `$(cat .unit-talk-release)` | `canary/promote: keys the snapshot on the outgoing release, not the incoming tag` |
| M3 | `.env.smart-form` dropped from the snapshot loop | `canary/promote: snapshots every configuration file the deploy overwrites` |
| M4 | Restore loop deleted from `deploy/rollback.sh` | `rollback.sh restores the configuration snapshot for the tag it rolls back to` |
| M5 | `WARNING: no configuration snapshot` text downgraded | `rolling back to a tag with no snapshot warns and still rolls the code back` |
| M6 | Snapshot step deleted from the canary job only | both `canary:` tests; promote unaffected |

M2, M3 and M4 additionally fail the functional round-trip test, which executes the shell
bodies rather than asserting on their text.

**One control was corrected by running the mutations.** M2 and M3 initially produced an
identical failure set, because a single test carried both the keying assertion and the
file-coverage assertion and stopped at the first. The coverage assertion was split into its
own test so the two defects are now distinguishable by name. Recorded because the fix came
out of executing the mutations, not out of reading the tests.

## Verification
- [x] `pnpm type-check`: PASS (exit 0)
- [x] `pnpm test`: PASS — 5485/5485, 0 fail (exit 0)
- [x] `pnpm verify`: deferred to the required CI `verify` context on this branch
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, no rules matched

## Runtime Verification

**No runtime proof against the production host is claimed, and none is possible within this
lane's authority.** Verifying that the snapshot step writes real files on the real host
requires dispatching a `Deploy` run, which is a reserved action and is not requested here.

What *is* proven at runtime is the shell logic itself, executed rather than described: the
functional test writes env files to a temporary directory, executes the workflow's own
`SNAPSHOT_REMOTE` heredoc through `bash -s`, overwrites the files as a deploy would,
obtains the rollback script's own emitted remote command via `--dry-run`, executes it, and
asserts byte-identical restoration at mode 0600. Only the two `docker compose` lines are
removed, because no daemon exists in the test environment; every other byte executed is the
byte that would be sent to the host.

Three ambient facts were measured rather than assumed:

1. `DEPLOY_HOST`, `DEPLOY_USER` and `DEPLOY_PATH` are workflow-level `env`, so the new step
   requires no `env:` block of its own.
2. The emitted YAML parses, and the quoted heredoc survives the block-scalar dedent intact —
   the terminator sits at the run-block indent, so it reaches the shell at column 0.
3. Every `env_file:` entry in `deploy/production/docker-compose.yml` is an explicit path
   with no glob, so the new `.env.*.<tag>` snapshot files cannot be picked up by compose.

## Merge SHA Binding

Merge SHA: 1d76b75e1296871346284c50032b706009416fc6
PR: pending
Execution SHA: 901bce784354ee4b2098611bc0278c04c13209da
