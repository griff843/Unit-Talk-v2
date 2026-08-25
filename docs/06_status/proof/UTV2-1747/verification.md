# PROOF: UTV2-1747

MERGE_SHA: 953dae38f178df9d28b4ac88c103a7f147282697

Verified source SHA: `953dae38f178df9d28b4ac88c103a7f147282697`

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
- [x] Thirteen reintroduced defect classes each make a named test fail, including
  both lane-start capture call sites.
- [x] No production behaviour changed: the entrypoints, the packet module and
  the parser are unmodified by this lane beyond the inherited fixes.
- [x] No test-only root parameter was added to production code.

## EVIDENCE:

```text
pnpm verify:static           PASS (exit 0)
unit suite                   5048 tests, 5048 pass, 0 fail
focused executor suites      81 tests, 81 pass, 0 fail
r-level check                PASS — 13 changed files, rules matched: (none)
mutation battery             13 of 13 defect classes DETECTED
lane-root mutation           0 tracked and 0 untracked changes after a dry run
```

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm verify:static` | PASS | Exit 0. Runs lint, type-check, build and the repository suite. |
| `pnpm verify` | PARTIAL — static stages PASS | `verify` is `verify:static && test:live-db`. The static half exits 0. The live half refuses locally, by design: `assert-staging` requires the `staging-ci` environment and `CI_SUPABASE_*` credentials, and refuses any other target. Not run locally, and not required for this lane. |
| `pnpm type-check` | PASS | Stage of `pnpm verify:static` (exit 0). |
| `pnpm test` | PASS | 5048 tests, 0 failures, within `pnpm verify:static`. |
| `pnpm exec tsx --test scripts/ops/{execution-packet,claude-exec,codex-exec}.test.ts` | PASS | 81 tests, 0 failures. |
| `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | 13 changed files. Rules matched: (none). |
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

### Option B: the port is a source artifact, not the design

PM directed a correction inside this lane rather than a merge-with-disclosure or
a successor. The preserved head supplies the code; it does not settle the
contract lifecycle. `lane-start.ts` therefore deviates from `581af41b`
deliberately and by instruction, and the deviation is the point of this bounce.

Implemented lifecycle:

| Rule | Where |
|---|---|
| A fresh lane captures once, validates, and persists the SAME contract to both roots | `resolveLaneTaskContract` + `persistLaneTaskContract` |
| Resume uses the lane's existing valid contract and does not routinely refetch | `resolveLaneTaskContract` returns `fetched: false` from either root |
| Resume merges against the DESTINATION's own sync record | `syncContentForDestination(destRoot, ...)` |
| Two valid contracts with different hashes fail closed, structurally | `LaneContractConflictError`, surfaced as `code: lane_contract_conflict` |
| A legacy lane with no contract anywhere gets one bounded capture, before any lease, worktree or manifest mutation | both call sites sit above `prepareLaneWithIsolatedPnpm`/`reserveLease` |
| A missing token may block first capture but is not a dependency of normal resume | resume with `LINEAR_*` stripped succeeds |

Both previously disclosed Tier C risks are now **fixed rather than disclosed**:
the resume path no longer requires Linear, and each destination merges against
its own record, so branch-accumulated entities survive.

### PM review findings (bounce 1)

**1. Standalone packet CLI refused pre-contract lanes.** `main()` called the
strict gate directly, so the policy-required command failed on exactly the lanes
it exists to preview. It now routes through the same authoritative
capture-and-persist the dispatch path uses, then applies the identical strict
validator. Covered by an executing child-process CLI test with `curl` stubbed.

**2. Nested acceptance headings produced a false refusal.** Any heading at any
level replaced the current section, so an `## Acceptance criteria` parent whose
items sat under `### Functional` ended up empty -- and because the parent
heading existed, the fallback was disabled and the contract was refused for
"missing acceptance criteria" while the criteria sat one level down.
`parseSections` is now nesting-aware: a line belongs to the deepest heading and
to every ancestor, and consuming a parent consumes its descendants so the same
text is not duplicated into residue.

**3. Residue flattening altered multiline semantics.** `entry.lines.join(' ')`
plus whitespace collapse rewrote multiline commands, fenced code, tables and
paragraph boundaries, while this bundle claimed residue travelled verbatim.
Lines are now preserved as authored. Measured on the real UTV2-1736 issue, the
three safety constraints now render on their own lines instead of folded into a
single run-on line:

```text
"* **No unrestricted DEFAULT partition.** ..."
"* **No retention deletion.** Do not drop, detach or prune historical partitions. ..."
"* **Stop before production DDL.** Do not apply schema changes to production. ..."
```

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

### Tier C safety: two behavioural changes the port introduces

Both were missed by the first revision of this bundle, which asserted
`production_behaviour_changed: false`. That was wrong relative to `main` and is
withdrawn. `lane-start.ts` is a Tier C path that every lane start depends on.

**1. A hard external dependency on Linear, on every lane start and every resume.**
`main()` now calls `captureOrReadTaskContract(issueId, linearTaskToken())` on
both the fresh and resume paths. With no `LINEAR_API_TOKEN`/`LINEAR_API_KEY`, an
unreachable `api.linear.app`, or an issue that cannot be fetched, lane-start now
refuses where `main` succeeded. Neither call site can orphan state — both sit
before lease reservation and worktree creation, and `main()`'s try/catch turns a
throw into a structured `lane_start_failed` with exit 1 — so this fails closed
rather than corrupting anything. But it is a real new failure mode under
containment, in CI, and on any machine without a token.

**2. Asymmetric root on resume, with a silent-overwrite path.**
`syncContentWithTaskContract` merges against `ROOT/.ops/sync/<id>.yml` (the
control checkout), while the resume path writes that merged content into the
**lane worktree**, over the branch's own tracked sync record:

```text
lane-start.ts  helper: reads  ROOT/.ops/sync/<id>.yml
lane-start.ts  :949    writes <worktree>/.ops/sync/<id>.yml

measured, root control checkout:
  481 sync records present
  481 of 481 carry no task_contract
```

Every merge base on the resume path is therefore a legacy root copy. Two
consequences: `entities.findings/controls/proofs` accumulated on the branch are
replaced by whatever the root copy holds, and because the root copy never has a
`task_contract`, each resume re-fetches from Linear and can substitute a
contract with a different `contract_hash` than the one the executor is already
working from.

This is inherited from `581af41b`, not authored here, and it is disclosed rather
than fixed: repairing it means changing the ported capture design, which is
beyond a byte-identical carry-forward. It is the sharpest open question on this
lane and is flagged for PM decision.

### Mutation testing

Thirteen defect classes, each reintroduced alone, the owning suite run, and the
source file restored and checked byte-identical by SHA-256 afterwards.

```text
DETECTED  M1  codex dry-run purity branch removed
DETECTED  M2  claude dry-run purity branch removed
DETECTED  M3  printDryRun called with wrong arity behind an `as never` cast
DETECTED  M4  generateExecutionPacket not imported at all
DETECTED  M5  PREAMBLE_KEY reverted to a NUL-byte sentinel
DETECTED  M6  stripControlChars removed from the render
DETECTED  M7  stale-contract unmapped_sections assertion removed
DETECTED  M8  empty-bodied heading no longer carried as residue
DETECTED  M9a lane-start RESUME capture call site removed
DETECTED  M9b lane-start FRESH capture call site removed
DETECTED  M10 standalone packet CLI reverted to the strict path
DETECTED  M11 parseSections reverted to flat (any heading replaces current)
DETECTED  M12 residue reverted to join(' ') with whitespace collapse
```

**M9 is now detected on both call sites**, which it was not in the previous
bounce. `lane-start`'s `main()` is executed as a child process against a fixture
repository; removing the resume capture fails two tests and removing the fresh
capture fails one. The seven required properties are each asserted by an
executing test: fresh-start capture and persistence, resume without a network
fetch, preservation of branch sync entities, contract-hash stability across
resume, structured refusal on conflicting contracts, zero state creation on
capture failure, and no live-network dependency.

**M8 regressed during this bounce and was caught by the battery.** Making the
parser nesting-aware meant the empty-body fixture (`## DO NOT TOUCH PRODUCTION`
followed by `### Details`) was no longer empty -- the heading now inherits its
subsection -- so the test silently stopped exercising the branch it named. The
fixture was changed to a genuinely empty heading and a companion test added for
the nested case. Recorded because a test going vacuous as a side effect of an
unrelated fix is the failure mode this lane exists to remove.

### A control that passed while its compiler never ran

Independent review found that the narrow compile smoke
(`codex-exec.test.ts`) asserted only on filtered TS2304/TS2305 diagnostics and
never checked that `tsc` executed. With `npx` absent or exiting 127 there is no
output to filter, the diagnostic list is empty, and the test passes — while
proving nothing. It is the only control that catches a wrong-module or missing
import wherever it sits, and that defect shipped past a green suite once before.

Hardened to establish the compiler actually ran, and verified by inversion:

```text
before hardening, npx exits 127:  ok 1  - narrow compile smoke      (vacuous pass)
after  hardening, npx exits 127:  not ok 1 - narrow compile smoke
    error: 'tsc did not report a version, so the compile smoke is vacuous: '
after  hardening, npx healthy:    ok 1  - narrow compile smoke
```

### Why fixtures are built by production code

`buildTaskContract` computes `description_sha256` and `contract_hash`, and
`assertTaskContract` verifies both against the content. A hand-authored fixture
cannot satisfy those checks, so it cannot invent a field the production reader
never consults — a defect this codebase has hit before.

### Substantive diff stat

Recounted. An earlier revision of this bundle reported "6 files changed, 1852
insertions" and omitted both lane-start files -- including the one Tier C
production file this lane adds. That figure was wrong and is withdrawn.

```text
scripts/ops/claude-exec.test.ts      | 365 +++++++++++-
scripts/ops/claude-exec.ts           |  69 +++-
scripts/ops/codex-exec.test.ts       | 356 ++++++++++++-
scripts/ops/codex-exec.ts            |  64 +++-
scripts/ops/execution-packet.test.ts | 339 ++++++++++++-
scripts/ops/execution-packet.ts      | 688 ++++++++++++++++++++++++++
scripts/ops/lane-start.test.ts       |  99 +++-
scripts/ops/lane-start.ts            |  47 +-
8 script files changed
whole diff: 13 files changed
```
