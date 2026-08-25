# PROOF: UTV2-1747

MERGE_SHA: f4cc222cd4a51249dc358c657e5d38e72b43e4a6

Verified source SHA: `f4cc222cd4a51249dc358c657e5d38e72b43e4a6`

The executor packet layer shipped with tests that could not observe it. This
lane does not change what the packet does; it makes the packet's behaviour
measurable, and then measures it.

The premise was verified rather than asserted. With the dry-run purity branch
removed from `codex-exec.ts`, the test this lane replaces still passes:

```text
M1 defect applied (dry-run takes the capturing path):
  ok 31  - codex-exec --dry-run executes to a rendered packet carrying the captured contract
  not ok 32 - codex-exec --dry-run leaves the lane root byte-identical
  not ok 33 - codex-exec --dry-run refuses a lane with no captured contract instead of fetching one
  ok 35  - REPLACED VACUOUS TEST restored verbatim
```

The replaced test named an issue with no manifest on disk, so `main()` exited at
the `manifestExists` guard and every assertion below it was satisfied by a
"no manifest found" refusal. It never reached packet generation.

## ASSERTIONS:

- [x] Both entrypoints execute end-to-end under `--dry-run` and reach packet
  generation, asserted on real exit codes from a child process rather than a
  monkey-patched `process.exit`.
- [x] The rendered prompt carries the captured contract, tied to the on-disk
  record by integrity hash so the assertion cannot pass against a different
  contract.
- [x] Every fixture lives in an isolated lane root. No test writes a lane
  manifest or sync record into the live checkout, where the concurrency governor
  reads a stray manifest as a real active lane.
- [x] No test makes a network or paid model call. Health checks are satisfied by
  stub CLIs on `PATH`.
- [x] A dry run leaves the lane root byte-identical — tracked and untracked.
- [x] Eight reintroduced defect classes each make a named test fail.
- [x] No production behaviour changed: the entrypoints, the packet module and
  the parser are unmodified by this lane beyond the inherited fixes.
- [x] No test-only root parameter was added to production code.

## EVIDENCE:

```text
pnpm verify:static           PASS (exit 0)
unit suite                   5040 tests, 5040 pass, 0 fail
focused executor suites      81 tests, 81 pass, 0 fail
r-level check                PASS — 11 changed files, rules matched: (none)
mutation battery             9 of 9 defect classes DETECTED
lane-root mutation           0 tracked and 0 untracked changes after a dry run
```

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm verify:static` | PASS | Exit 0. Runs lint, type-check, build and the repository suite. |
| `pnpm verify` | PARTIAL — static stages PASS | `verify` is `verify:static && test:live-db`. The static half exits 0. The live half refuses locally, by design: `assert-staging` requires the `staging-ci` environment and `CI_SUPABASE_*` credentials, and refuses any other target. Not run locally, and not required for this lane. |
| `pnpm type-check` | PASS | Stage of `pnpm verify:static` (exit 0). |
| `pnpm test` | PASS | 5040 tests, 0 failures, within `pnpm verify:static`. |
| `pnpm exec tsx --test scripts/ops/{execution-packet,claude-exec,codex-exec}.test.ts` | PASS | 81 tests, 0 failures. |
| `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | 11 changed files. Rules matched: (none). |
| `pnpm test:db` | N/A | No runtime, delivery or database path is touched. `lane_type: governance`, `proof_profile: static`. |

## Runtime Verification

Not applicable, and stated rather than omitted. This lane changes test code and
carries inherited fixes to two control-plane entrypoints and the packet module.
It touches no runtime path, no database, no migration, no deployment, no
ingestion, no delivery and no customer-facing behaviour. Production containment
was in force throughout: no SGO call, no production mutation, no secret access.

The nearest thing to runtime proof that is meaningful here is that the
entrypoints are now genuinely executed rather than simulated, offline, in an
isolated root — which is what the EVIDENCE block above records.

### Root cause

`scripts/ops/execution-packet.ts` is reached only through two entrypoints whose
`main()` functions were effectively untested. `codex-exec.ts` calls
`process.exit()` at 19 sites and shells out to the real `codex` CLI for its
health check, so an in-process test could neither survive it nor run it offline.
The existing test worked around both by never getting far enough to matter.

Isolation turned out to need no production change. `getRepoRoot()`
(`scripts/ops/shared.ts:463`) shells out to `git rev-parse --show-toplevel`
without a `cwd` option, so it inherits `process.cwd()`. Running an entrypoint as
a child process with `cwd` inside a git-initialised fixture directory rebinds
`ROOT` to that directory for the whole run.

### Carry-forward audit (PR #1445, eight script files)

Every script file from the rejected PR, compared by SHA-256 against current
`main`, preserved head `581af41b`, and this worktree:

```text
FILE                       MAIN      581af41b  WORKTREE  CLASSIFICATION
claude-exec.ts             778ee512  7b1577a3  7b1577a3  ported byte-identical
claude-exec.test.ts        a93c47f2  e5ce303c  (rewritten) executing tests, this lane
codex-exec.ts              095d4c44  927868f5  927868f5  ported byte-identical
codex-exec.test.ts         2afd51d5  43f5b78d  (rewritten) executing tests, this lane
execution-packet.ts        15b02a9b  9fd72abc  9fd72abc  ported byte-identical
execution-packet.test.ts   2c43eb9b  162979f8  (rewritten) executing tests, this lane
lane-start.ts              b88f2f3d  9a7e519b  9a7e519b  ACCIDENTALLY OMITTED -> now ported
lane-start.test.ts         6d41de15  2b2b69d8  2b2b69d8  ACCIDENTALLY OMITTED -> now ported
```

`lane-start.ts` and `lane-start.test.ts` were accidentally omitted from the
UTV2-1747 port. They are the **capture** step. On `main`, `lane-start` writes a
sync record with no `task_contract`:

```text
$ cat .ops/sync/UTV2-1747.yml     # written by main's lane-start
version: 1
approval: ...
entities:
  issues: [UTV2-1747]
                                   # no task_contract key

$ readTaskContract('UTV2-1747', <lane root>)
THROWS - task contract is absent from .../.ops/sync/UTV2-1747.yml;
         refusing to dispatch without a work order
```

Stated precisely, because an earlier reading of this was too strong: capture is
**not** absent altogether — the exec-time path
(`generateDispatchExecutionPacketResult`) still captures and persists at
dispatch. What the omission breaks is the **dry-run** path specifically. A dry
run deliberately never captures, so without lane-start-time capture every
`--dry-run` on a real lane refuses. That is exactly the path this lane's new
tests exercise, so testing it without this file would have been coverage of a
path no real lane could reach.

Both files are now ported byte-identically and added to `file_scope_lock`. One
deliberate deviation from byte-identity is disclosed below.

### Disclosed deviation from the byte-identical port

`syncContentWithTaskContract` in `lane-start.ts` gained an `export` keyword and
a doc comment. Nothing else in either file changed. The reason is M9 below: the
inherited `lane-start` suite stayed green when the capture wiring was reverted,
because its capture test exercises the exec-time path rather than lane-start's
own wiring. The export provides the seam for a test that executes that wiring.

### Complete UTV2-1736 rendered packet

End-to-end proof on the real production lane, run against an isolated root so
the live lane was never written:

```text
CAPTURE  ok - real read-only Linear fetch, description 3374 bytes
BUILD    ok - objective, 8 unmapped sections
PERSIST  ok - sync record written to the isolated root
REREAD   ok - description_sha256 + contract_hash verified: true
RENDER   ok - 7702-byte prompt

contains "No unrestricted DEFAULT partition":  true
contains "No retention deletion":              true
contains "Stop before production DDL":         true
falsely claims "(none declared)" anywhere:     false
```

The packet is complete and honest. Note a parser quality limitation, recorded
rather than fixed here because parser expansion is out of scope for this lane:
UTV2-1736 uses the heading vocabulary `## Deliverables` and `## Hard
constraints`, which no whitelist consumes, so `guardrails` and
`acceptance_criteria` are not cleanly extracted. Nothing is lost — the content
is carried verbatim in `unmapped_sections`, and every unextracted field renders
as `(not extracted - see "Additional issue content" below)` rather than
`(none declared)`, so the executor is never told a guardrail does not exist when
one does. Worth a follow-up to widen the whitelist; not a blocker.

### Mutation testing

Each defect class was reintroduced, the relevant suite run, and the source file
restored and checked byte-identical by SHA-256 afterwards.

```text
DETECTED  M1 codex dry-run purity branch removed
            not ok - codex-exec --dry-run leaves the lane root byte-identical
            not ok - codex-exec --dry-run refuses a lane with no captured contract
DETECTED  M2 claude dry-run purity branch removed
            not ok - claude-exec --dry-run leaves the lane root byte-identical
            not ok - claude-exec --dry-run failure path refuses structurally
DETECTED  M3 printDryRun called with wrong arity behind an `as never` cast
            not ok - claude-exec --dry-run failure path refuses structurally
DETECTED  M4 generateExecutionPacket not imported at all
            not ok - executor modules resolve every imported symbol
DETECTED  M5 PREAMBLE_KEY reverted to a NUL-byte sentinel
            not ok - PREAMBLE_KEY is safe to pass as a process argument
DETECTED  M6 stripControlChars removed from the render
            not ok - control characters in the issue description never reach the prompt
DETECTED  M7 stale-contract unmapped_sections assertion removed
            not ok - a contract predating unmapped_sections refuses structurally
DETECTED  M8 empty-bodied heading no longer carried as residue
            not ok - a section heading with an empty body is still carried as residue
DETECTED  M9 lane-start capture reverted to a contract-less sync file
            not ok - lane-start persists a sync record the executor can read back
```

M9 was **not** detected when the two lane-start files were first ported: the
inherited suite passed with the capture wiring reverted. That is the third
instance in this lane of the same class -- a control that does not execute the
path it names. It is recorded here rather than quietly fixed, because the
pattern, not the individual test, is the finding.

M5 and M6 were **not** detected on the first run of this battery. The
control-character test inherited into this lane used a fixture containing no
control characters, so its assertion held whether or not any stripping was
applied, and reverting `PREAMBLE_KEY` to a NUL sentinel changed nothing it
observed. That is the same vacuity class this lane exists to remove, found in
its own inherited code. The replacement carries a hostile description, asserts
its own fixture is non-vacuous before asserting anything about the output, and
passes the rendered prompt to `spawnSync` as a real argv element — the failure
the strip exists to prevent. Both classes are detected only after that change.

### Why fixtures are built by production code

`buildTaskContract` computes `description_sha256` and `contract_hash`, and
`assertTaskContract` verifies both against the content. A hand-authored fixture
cannot satisfy those checks, so it cannot invent a field the production reader
never consults — a defect this codebase has hit before.

### Substantive diff stat

```text
scripts/ops/claude-exec.test.ts      | 365 ++++++++++++++++++-
scripts/ops/claude-exec.ts           |  69 +++-
scripts/ops/codex-exec.test.ts       | 341 ++++++++++++++++-
scripts/ops/codex-exec.ts            |  64 +++-
scripts/ops/execution-packet.test.ts | 339 ++++++++++++++++-
scripts/ops/execution-packet.ts      | 688 +++++++++++++++++++++++++++++++++++
6 files changed, 1852 insertions(+), 14 deletions(-)
```
