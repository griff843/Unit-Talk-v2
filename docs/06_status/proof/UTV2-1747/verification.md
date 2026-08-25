# PROOF: UTV2-1747

MERGE_SHA: 87372863beb8a974e3ef9424ab1ecebf2ad28f86

Verified source SHA: `87372863beb8a974e3ef9424ab1ecebf2ad28f86`

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
- [x] Production behaviour DID change, deliberately and by PM direction:
  `lane-start.ts` (contract lifecycle) and `execution-packet.ts` (standalone CLI,
  nesting-aware parser, residue fidelity) are rewritten beyond the preserved
  head. `claude-exec.ts` and `codex-exec.ts` remain byte-identical to it.
- [x] No test-only root parameter was added to production code.

## EVIDENCE:

```text
pnpm verify:static           PASS (exit 0)
pnpm test                    4934 tests, 4934 pass, 0 fail (exit 0)
focused executor suites      85 tests, 85 pass, 0 fail
lane-start suite             39 tests, 39 pass, 0 fail
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
| `pnpm test` | PASS | 4934 tests, 0 failures, exit 0. `pnpm verify:static` totals 5048 because it also runs the smart-form package suite (114); an earlier revision mislabelled that pipeline total as `pnpm test`. |
| `pnpm exec tsx --test scripts/ops/{execution-packet,claude-exec,codex-exec}.test.ts` | PASS | 85 tests, 0 failures. |
| `pnpm exec tsx --test scripts/ops/lane-start.test.ts` | PASS | 39 tests, 0 failures. |
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

Measured at this head, not at the time of the port. An earlier revision of this
table still listed `execution-packet.ts` and `lane-start.ts` as "ported
byte-identical"; both were subsequently rewritten in this bounce, so those rows
were false and are corrected here.

```text
FILE                       MAIN      581af41b  THIS HEAD  STATUS
claude-exec.ts             778ee512  7b1577a3  7b1577a3   ported byte-identical
codex-exec.ts              095d4c44  927868f5  927868f5   ported byte-identical
execution-packet.ts        15b02a9b  9fd72abc  3de57483   ported, then rewritten (bounce 1)
lane-start.ts              b88f2f3d  9a7e519b  b368855f   omitted, ported, then rewritten (bounce 1)
lane-start.test.ts         6d41de15  2b2b69d8  0bd36c96   omitted, ported, then extended
claude-exec.test.ts        a93c47f2  e5ce303c  (rewritten) executing tests, this lane
codex-exec.test.ts         2afd51d5  43f5b78d  (rewritten) executing tests, this lane
execution-packet.test.ts   2c43eb9b  162979f8  (rewritten) executing tests, this lane
```

`lane-start.ts` and `lane-start.test.ts` were accidentally omitted from the
original port. They are the capture step. On `main`, `lane-start` writes a sync
record with no `task_contract`, and `readTaskContract` throws
`task contract is absent` for every real lane. Stated precisely: capture is not
absent altogether -- the exec-time path still captures at dispatch -- but a dry
run deliberately never captures, so without lane-start-time capture every
`--dry-run` on a real lane refuses. `581af41b`'s full 14-file diff contains
nothing else beyond UTV2-1737's own lane apparatus, which is correctly not
carried.

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

### Tier C safety

`scripts/ops/lane-start.ts` is a Tier C path every lane start depends on. An
earlier revision of this bundle described two behavioural risks here as
"disclosed rather than fixed", and named `syncContentWithTaskContract`, which no longer exists, a line
number that no longer exists, and `captureOrReadTaskContract`, which does still
exist but is no longer called by `main()`. That text
described the pre-bounce design and directly contradicted the Option B section
above. It was stale and is withdrawn. What ships:

| Previously disclosed risk | Status at this head | Evidence |
|---|---|---|
| Linear required on every lane start AND resume | **Fixed.** Only a first capture needs it. | `lane-start main()` resumes to `lane_resumed` with `LINEAR_API_TOKEN` and `LINEAR_API_KEY` deleted from the child environment; a fetch on that path fails with `LINEAR_API_TOKEN or LINEAR_API_KEY is required`, so exit 0 is only reachable without one. `resolveLaneTaskContract` returns from either root's valid contract before any fetch. |
| Resume merged a worktree write against the control checkout's record, overwriting branch entities | **Fixed.** Each destination merges against its own record. | With different findings seeded in each root, neither leaks into the other. |

`main()` calls `resolveLaneTaskContract`, not `captureOrReadTaskContract`; the
latter survives only as a re-export for the dispatch path.

Residual, and intended: a lane with no valid contract in either root still needs
a reachable Linear and a valid token for its single bounded capture. There is no
work order to proceed from without one. That capture precedes every lease,
worktree and manifest mutation, so a failure leaves lane state untouched.

Two further findings are recorded rather than fixed, both pre-existing on `main`:
the readmission path still copies the control checkout's sync record into the
worktree, so readmit can still overwrite branch-accumulated entities; and
`generateDispatchExecutionPacketResult`'s `LINEAR_API_KEY` fallback is dead code
because `readConfiguredEnvValue` returns `''` rather than a nullish value, so a
deployment carrying only `LINEAR_API_KEY` would refuse there while `lane-start`
(which uses `||`) would succeed. Neither is introduced by this lane and neither
is in its declared scope.

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

Recounted at this head with `git diff --numstat`. Two earlier revisions of this
section reported figures that did not match the tree; both are withdrawn.

```text
scripts/ops/execution-packet.ts      | 760 +
scripts/ops/execution-packet.test.ts | 516 +
scripts/ops/claude-exec.test.ts      | 364 +
scripts/ops/codex-exec.test.ts       | 360 +
scripts/ops/lane-start.test.ts       | 341 +
scripts/ops/lane-start.ts            | 171 +
scripts/ops/claude-exec.ts           |  66 +
scripts/ops/codex-exec.ts            |  60 +
8 script files

8 script files: 2638 insertions(+), 38 deletions(-)
whole diff: 13 files (8 script, 5 lane/proof artifacts)
```

The whole-diff insertion total is deliberately not quoted. It counts the proof
bundle itself, so writing the number into this file changes it -- which is why
three successive revisions of this section quoted a figure that did not match
the tree. The script-file total above is stable under proof edits and is the
figure that describes the actual change.
