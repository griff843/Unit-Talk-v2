# DIFF SUMMARY: UTV2-1951

Lane type `runtime`, tier T2, executor claude.
Branch `claude/utv2-1951-settlement-recap-provenance`, cut from `origin/main` and
synced forward across the UTV2-1950 merge (`81db253d5`, PR #1624).

**16 files, +932 / -83** against `origin/main`. Two of those files are lane
registry (`docs/06_status/lanes/UTV2-1951.json`, `.ops/sync/UTV2-1951.yml`)
written by `ops:lane-start`, not by this work.

## Why this lane exists separately from UTV2-1950

These 13 files were carried on the Command Center recovery branch and could not
legally travel with it. `deriveDeliveryUiApp` (`scripts/ops/shared.ts:933`)
returns `null` unless **every** `file_scope_lock` entry sits under exactly one
of four app roots, so no lane type admits `apps/command-center/**` together with
`apps/api/**` and `deploy/**`. They were reverted on that branch at `b09afe0b1`
and preserved verbatim rather than mistyping a lane to force one PR through —
choosing a lane type to evade a structural rule is an operating-model change
reserved to PM.

## Area table

| Area | Files | Lines |
|---|---|---|
| `apps/api/src` — recap observation + grading extraction | 6 | +416 / -78 |
| `scripts/` — staging operator proof runner + enforcement | 2 | +153 |
| `deploy/rollback.sh` — command-substitution repair | 1 | +1 / -1 |
| wiring (`package.json`, `db-writer-classification.json`, `.env.example`, `staging-db-proof.yml`) | 4 | +38 / -4 |
| lane registry (written by `ops:lane-start`) | 2 | +402 |

## Defect 1 — `deploy/rollback.sh` executed a comment while assembling itself

`:95` opens the remote script with an **unquoted** heredoc
(`REMOTE_COMMAND=$(cat <<EOF`), so the body expands before it is ever sent.
`:129` escapes its backticks. `:146` did not:

```sh
# failed at `docker compose up` left the host naming a release it had not
```

so `docker compose up` ran on the operator's own machine at the moment a
rollback was being built, and its stdout was spliced into the script text.

Measured with a stub `docker` first on `PATH`, driving only the heredoc
assignment exactly as `rollback.sh` does:

| | stub `docker` invocations | resulting line 51 of the generated script |
|---|---|---|
| before | **1** | `# failed at The stub docker printed this to stdout left the host naming a release it had not` |
| after | **0** | `` # failed at `docker compose up` left the host naming a release it had not `` |

**The fix escapes the backticks** (matching `:129`) rather than rewording the
comment to avoid them. A reword removes the symptom and leaves the trap for the
next person who writes a backtick in this heredoc.

**Why the repository was green.** GitHub runners carry no `docker` binary, so
the substitution yields empty and `scripts/ci/deploy-config-rollback.test.ts`
passed. On this WSL host `docker ps -a` writes
`The command 'docker' could not be found in this WSL 2 distro.` to **stdout**,
producing `bash: line 50: The: command not found` and 5 failures in that suite.
`main` was never red — it was red wherever a `docker` binary answered. That
suite now passes **19/19 with the same shim still on `PATH`**.

**A mechanical guard replaces the prose.** A new test in
`scripts/ci/staging-path-enforcement.test.ts` parses the heredoc body and
rejects any unescaped backtick or `$(`. It lives in that suite because that
suite already asserts over the *text* of the scripts CI executes, and this
defect is not what the rollback does on the host — it is what the local shell
does while building the string.

## Defect 2 — a recap attempt left no durable per-pick provenance

The attempt ran inline in `grading-service.ts`. A thrown request was
indistinguishable from a confirmed refusal, and nothing durable recorded that a
recap had been attempted at all, so history could not answer *"did this pick's
recap post?"*.

`settlement-recap-observation.ts` writes a `recap.post` run row **before** the
attempt and keeps the three outcomes distinct:

| outcome | persisted `status` | meaning |
|---|---|---|
| posted | `succeeded` | the post was accepted |
| known refusal | `cancelled` | carries its reason, e.g. `kill-switch-engaged` |
| attempt threw | `failed` | `recap_request_outcome_unknown` — deliberately **not** a claim that the post did not happen |

If provenance cannot be written the recap is **not attempted**
(`recap_provenance_unavailable`) rather than posted unobserved. If the terminal
write fails, the run stays unresolved rather than relabelling an accepted
Discord post as failed.

## One scope change from the preserved patch

The live-DB proof for that behaviour was originally appended to
`apps/api/src/t1-proof-utv2-1904-operator-evidence-settlement.test.ts`. That file
is held by the **open** UTV2-1919 lane (PR #1589), so `ops:lane-start` refused —
correctly, and not as a ghost: #1589 is genuinely open. The case is
self-contained and shares no state with the UTV2-1904 cases, so it now lives in
`apps/api/src/t1-proof-utv2-1951-settlement-recap-provenance.test.ts` and is
registered in both places a credentialed test must be registered or `pnpm verify`
fails closed: `package.json`'s `test:t1-proof:live`, and
`docs/05_operations/db-writer-classification.json`.

No file was dropped, no scope was widened, and no lane type was mistyped.

## Not in scope

No migration, no containment change, no delivery activation, no secrets, no
Command Center source changes.
