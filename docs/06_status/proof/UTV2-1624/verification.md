# PROOF: UTV2-1624

MERGE_SHA: 97fc751d7443e466167f3b088859ddb42a8e57af

That SHA is the implementation commit — this lane's work rebased onto `origin/main`
at `b5ebdc23` — and it is a real ancestor of the PR head. Every count and every
command output below was measured on it. The proof bundle itself lands in a
following commit, so the PR head is one commit later by construction; the
authoritative binding is the squash merge SHA, written post-merge by
`post-merge-lane-close.yml` via `ops:proof-generate --merge-sha`. The exact PR
head SHA is carried by the `executor-result/v1` comment, which the required
`Executor Result Validation` context checks against the live PR head.

## Summary

The repository ships tests and ops scripts that no execution path reaches. A dead
test is indistinguishable from green CI, so capability *presence* was being read
as capability *coverage*. This lane makes that mechanically visible and mechanically
enforced, from inside the gate that already runs in `verify:static`.

`scripts/ops/executable-wiring.ts` builds a real execution graph — root package
scripts, every workspace package script, chained `pnpm` / `pnpm --filter` /
`pnpm exec`, direct `tsx --test` and `node --test`, glob expansion, and every
workflow `run:` block. Reachability is never inferred from filename similarity;
every verdict carries the concrete command chain that reaches the file.
`scripts/ops/automation-coverage-check.ts` — already required inside
`verify:static` — invokes it, so there is no parallel competing checker.

### The reported figures did not survive re-derivation

The issue quoted a prior audit: 430 test files, 175 unreachable, 8 orphan ops
scripts. None of those numbers is hardcoded anywhere in this lane, and none of
them reproduced. The tool re-derives everything.

| Metric | Reported by prior audit | Re-derived at `97fc751d` |
|---|---|---|
| Canonical test files | 430 | **457** |
| Reachable from required `pnpm verify` | — | **302** |
| Reachable only from another named command / workflow | — | **36** |
| Unreachable | 175 | **119** |
| Orphan `scripts/ops/**` + `scripts/ci/**` capabilities | 8 | **18** |

The prior audit both over-counted unreachable tests and under-counted orphan
capabilities by more than 2x. It also named `proof-auditor-gate.test.ts` as
unexecuted; it is in fact `required-reachable` via
`pnpm verify -> verify:static -> test -> test:ops -> tsx --test`. Four of the five
named merge-path tests were genuinely unwired; the fifth was not. Trusting the
scan rather than the tool would have produced a wrong lane.

### Two mis-reads that make dead tests look alive

Both were found by building the graph and are now modelled explicitly.

1. **`**` is not globstar in POSIX `sh`.** pnpm runs scripts under `sh`, which
   expands `**` as a single-segment `*`. `apps/qa-agent`'s
   `tsx --test src/**/*.test.ts` therefore runs one file and silently skips the
   nested one. Verified directly against pnpm rather than assumed — see EVIDENCE 2.
   Reported as `WIRING_GLOB_SHADOWED`.
2. **Not every runner invocation runs tests.** A first implementation read
   `npx playwright install chromium --with-deps` in `post-merge-qa-gate.yml` as
   "playwright discovers every spec in the repository", which marked 131 dead
   tests as reachable. Runner discovery now requires an actual test run, and
   Playwright discovery is scoped to its config's `testDir`. There is a
   regression fixture for exactly this.

### Defects surfaced by running what had never run

Executing the unwired merge-path tests directly found three that are RED — they
have been failing silently because nothing ever ran them:

- `scripts/ops/runtime-verifier-gate.test.ts` — the gate exits 0 when a merge SHA
  is supplied and is **absent** from the proof file. That is core invariant 4
  ("proof must tie to the merge SHA") not being enforced by the gate that exists
  to enforce it. Filed as UTV2-1639 (Urgent, T1).
- `scripts/ops/policy-engine.test.ts` — 12 failures; the merge policy engine has
  drifted from its test contract.
- `scripts/ops/fix-sync-yml.test.ts` — asserts `worktree-setup.ps1` is a
  deprecated stub; it is not.

None of the three is wired in this lane. Wiring a red test into `verify` would
block every merge in the program. They are baselined with `failing-triage`, an
owner, an issue and an expiry, which is exactly what the staged-enforcement
design is for.

### What was wired, and why only this much

Twelve tests, all governance/merge-path, all green and deterministic, all
negatively demonstrated by mutation. `packages/invariants` — which holds
proof-bundle, proof-validator, merge-sha-binding, proof-freshness and
certification tests — is `optional-reachable` only: its `test` script exists but
the root `test` script never calls it. That is real, and it is handed to
UTV2-1637 rather than bulk-wired here, per the non-goal "do not run all tests
indiscriminately in every CI job".

### The baseline can shrink but never grow

119 test entries and 18 capability entries, each with a classification, owner,
issue and expiry. `max_entries` caps both sections. Entries that become
reachable, become non-executable fixtures, or point at deleted files are *stale*
and fail — which is what forces the ledger down. Expiry lapse is a **warning**,
deliberately: a calendar date must never block every merge in the program.

ASSERTIONS:

1. Exact current counts are re-derived by the checked-in tool, not hardcoded.
   457 / 302 / 36 / 119 / 18 at `97fc751d`. The reported 430/175/8 appear nowhere
   in the implementation. (EVIDENCE 1)
2. A test file can exist while remaining unreachable, and is detected. Fixture
   `counts are derived from the graph, not hardcoded, and an unreachable test
   file is detected`, plus the live negative demonstration in EVIDENCE 4.
3. A chained root-to-workspace script resolves correctly and emits the exact
   path: `pnpm verify -> verify:static -> test -> test:apps -> @fixture/api:test
   -> tsx --test`. (EVIDENCE 3, fixture 7)
4. Supported globs expand correctly, including POSIX `sh`'s single-segment `**`,
   and the shadowed files are reported. (EVIDENCE 2, fixtures 3–5)
5. Fixture/helper files that match test naming but register no tests are not
   treated as executable tests. (fixture 12)
6. Reachability is not inferred from filename similarity — two files with the
   same basename in different directories get different verdicts. (fixture 8)
7. The named critical governance tests are each either proven already reachable
   or wired in this lane, with execution receipts. (EVIDENCE 5, 6)
8. Every newly wired test is negatively demonstrated: mutating the module it
   exercises makes it fail. 12/12 killed, every source byte-restored.
   (EVIDENCE 6, `mutation-check.json`)
9. A newly added unwired test fails the required gate. (EVIDENCE 4a)
10. An active orphan ops capability with no disposition fails. (EVIDENCE 4b)
11. A baseline entry that loses its owner, issue or expiry fails. (EVIDENCE 4c,
    fixture 14)
12. Existing baseline debt is explicit and cannot grow: `max_entries` caps both
    sections, and stale entries fail. (fixtures 16, 17)
13. Tool/parser failures are reported separately from implementation findings,
    and an execution graph that cannot be built at all fails closed rather than
    degrading to a silent pass. (fixture 24; coverage-check fixture `a missing
    workspace manifest fails closed rather than silently skipping the wiring
    section`)
14. Documentation-only reference is not sufficient for a capability claimed as
    automated. (fixture 20)
15. Running the new gate against pristine `origin/main` fails on exactly the
    delta this lane closes — 11 tests plus 1 capability — and nothing else. No
    finding is suppressed. (EVIDENCE 7)
16. `pnpm verify` passes on the branch. (EVIDENCE 8)

EVIDENCE:

### 1. Re-derived inventory at `97fc751d`

```text
$ pnpm ops:automation-coverage-check
[automation-coverage] verdict=PASS fail=0 warn=1 classified=15
[executable-wiring] verdict=PASS required_roots=verify
[executable-wiring] tests total=457 required-reachable=302 optional-reachable=36 fixture-helper=0 quarantined=0 unwired=119 (baselined=119 new=0)
[executable-wiring] capabilities total=143 wired=125 orphan=18 (baselined=18 new=0)
[executable-wiring] baseline tests=119/119 capabilities=18/18
[WARN] WIRING_GLOB_SHADOWED apps/qa-agent/src/**/*.test.ts - POSIX sh expands "**" as a single path segment, so 1 file(s) under this pattern never run: apps/qa-agent/src/adapters/unit-talk/surfaces/discord/skills/pick-delivery.test.ts
```

Baseline composition:

```text
tests by disposition:        {"phase-b-wiring":77,"failing-triage":10,"external-service":32}
tests by owning issue:       {"UTV2-1636":68,"UTV2-1637":38,"UTV2-1638":12,"UTV2-1639":1}
capabilities by disposition: {"manual-diagnostic":5,"one-shot-migration-aid":2,"archive-delete-candidate":11}
```

### 2. `**` collapse verified against pnpm itself, not assumed

A temporary root script was used to print the arguments pnpm's shell actually
delivers, then reverted:

```text
$ pnpm __globprobe          # script body: node -e 'console.log(JSON.stringify(process.argv.slice(1)))' apps/qa-agent/src/**/*.test.ts
["apps/qa-agent/src/core/trust.test.ts"]

$ find apps/qa-agent/src -name '*.test.ts'
apps/qa-agent/src/core/trust.test.ts
apps/qa-agent/src/adapters/unit-talk/surfaces/discord/skills/pick-delivery.test.ts
```

Two test files exist under that pattern; pnpm delivers one.

### 3. Reachability fixtures

```text
$ pnpm exec tsx --test scripts/ops/executable-wiring.test.ts
ok 1 - splitCommandSegments splits on every shell operator without breaking quotes
ok 2 - tokenize keeps quoted arguments as single tokens
ok 3 - expandGlob expands a single-star glob to the files that exist
ok 4 - expandTestArgument models POSIX sh, which collapses ** to one path segment
ok 5 - expandTestArgument falls back to recursive globbing when the shell matches nothing
ok 6 - counts are derived from the graph, not hardcoded, and an unreachable test file is detected
ok 7 - a chained root-to-workspace script resolves and emits the exact execution path
ok 8 - reachability is never inferred from filename similarity
ok 9 - a test reachable only from a non-required command is optional-reachable with its named command
ok 10 - workflow run blocks that execute tests outside package scripts count as reachable
ok 11 - a non-test runner subcommand never marks the whole tree reachable
ok 12 - a test-file-shaped fixture that registers no tests is not treated as executable
ok 13 - a complete baseline entry suppresses the unwired failure but stays visible
ok 14 - a baseline entry that loses its owner, issue or expiry fails
ok 15 - a baseline entry with an unapproved disposition fails
ok 16 - the baseline may shrink but never grow beyond max_entries
ok 17 - a baseline entry that is now reachable is stale and must be removed
ok 18 - an expired baseline entry warns rather than blocking every merge in the program
ok 19 - an active ops capability with no executable reference and no disposition fails
ok 20 - a documentation-only reference is not sufficient for a capability claimed as automated
ok 21 - an orphan capability with an allowed disposition, owner, issue and expiry passes
ok 22 - a capability dispositioned with an unapproved value still fails
ok 23 - a capability imported only by an unwired test is still an orphan; wiring that test covers it
ok 24 - the report separates tool/parser failures from implementation findings
ok 25 - the human summary reports totals, baseline size and the required roots it used
# pass 25
# fail 0

$ pnpm exec tsx --test scripts/ops/automation-coverage-check.test.ts
# pass 8
# fail 0
```

### 4. Negative demonstrations against the live repository

**(a) A newly added unwired test fails the required gate.** A throwaway test file
was created, the gate run, then the file removed:

```text
$ printf "import test from 'node:test';\ntest('negative demonstration for UTV2-1624', () => {});\n" > scripts/ops/utv2-1624-negative-demo.test.ts
$ pnpm ops:automation-coverage-check
[automation-coverage] verdict=FAIL fail=1 warn=1 classified=15
[executable-wiring] verdict=FAIL required_roots=verify
[executable-wiring] tests total=455 required-reachable=299 optional-reachable=36 fixture-helper=0 quarantined=0 unwired=120 (baselined=119 new=1)
[FAIL] WIRING_TEST_UNWIRED_NEW scripts/ops/utv2-1624-negative-demo.test.ts - test file is not reachable from any package script or workflow command and is not in the reviewed wiring baseline; wire it into a test command, or add a reviewed baseline entry with disposition, owner, issue and expiry
```

**(b) An active orphan ops capability with no disposition fails.**

```text
$ printf "export const negativeDemo = true;\n" > scripts/ops/utv2-1624-negative-demo-capability.ts
$ pnpm ops:automation-coverage-check
[automation-coverage] verdict=FAIL fail=1 warn=1 classified=15
[executable-wiring] capabilities total=144 wired=125 orphan=19 (baselined=18 new=1)
[FAIL] WIRING_CAPABILITY_ORPHAN scripts/ops/utv2-1624-negative-demo-capability.ts - active capability has no executable reference from any package script, workflow or code path; wire it, or give it a reviewed disposition and owner
```

**(c) A baseline entry that loses its metadata fails.** One test entry had `owner`
deleted and one capability entry had `expiry` deleted; the ledger was then restored:

```text
$ pnpm ops:automation-coverage-check
[automation-coverage] verdict=FAIL fail=2 warn=1 classified=15
[FAIL] WIRING_BASELINE_TEST_ENTRY_INCOMPLETE apps/api/src/alert-notification-service.test.ts - baseline entry is incomplete: missing owner
[FAIL] WIRING_BASELINE_CAPABILITY_ENTRY_INCOMPLETE scripts/ci/check-promotion-target-sync.ts - baseline entry is incomplete: missing or malformed expiry (expected YYYY-MM-DD)
```

After restoring the ledger the gate returns to `verdict=PASS fail=0`.

### 5. The five named merge-path tests, verified mechanically

Cross-checked against the tool with an independent grep, because the issue says
to trust the tool rather than the initial scan:

```text
$ for f in runtime-verifier-gate review-verdict merge-risk ci-dispatch-watchdog proof-auditor-gate automation-coverage-check; do
    printf "%-28s in package.json: " "$f"; grep -c "scripts/ops/$f.test.ts" package.json; done
runtime-verifier-gate        in package.json: 0
review-verdict               in package.json: 0
merge-risk                   in package.json: 0
ci-dispatch-watchdog         in package.json: 0
proof-auditor-gate           in package.json: 1
automation-coverage-check    in package.json: 1

$ for f in runtime-verifier-gate review-verdict merge-risk ci-dispatch-watchdog; do
    printf "%-28s workflows: " "$f"; grep -rl "$f.test.ts" .github/ | tr '\n' ' '; echo; done
runtime-verifier-gate        workflows:
review-verdict               workflows:
merge-risk                   workflows:
ci-dispatch-watchdog         workflows:
```

Direct execution of the unwired merge-path candidates, which is how the three RED
tests were found:

```text
scripts/ops/runtime-verifier-gate.test.ts     exit=1 # pass 8  # fail 1
scripts/ops/review-verdict.test.ts            exit=0 # pass 7  # fail 0
scripts/ops/merge-risk.test.ts                exit=0 # pass 9  # fail 0
scripts/ops/ci-dispatch-watchdog.test.ts      exit=0 # pass 9  # fail 0
scripts/ops/review.test.ts                    exit=0 # pass 12 # fail 0
scripts/ops/policy-engine.test.ts             exit=1 # pass 9  # fail 12
scripts/ops/proof-check.test.ts               exit=0 # pass 19 # fail 0
scripts/ops/proof-schema.test.ts              exit=0 # pass 18 # fail 0
scripts/ops/agent-result-schema.test.ts       exit=0 # pass 7  # fail 0
scripts/ops/review-state-schema.test.ts       exit=0 # pass 26 # fail 0
scripts/ops/runtime-contract-check.test.ts    exit=0 # pass 5  # fail 0
scripts/ops/p0-detect.test.ts                 exit=0 # pass 16 # fail 0
scripts/ops/concurrency-rules.test.ts         exit=0 # pass 7  # fail 0
scripts/ops/fix-sync-yml.test.ts              exit=1 # pass 1  # fail 1
```

The `runtime-verifier-gate` failure, in full:

```text
not ok 6 - fails when sha provided but not found in proof file
  error: |-
    Expected values to be strictly equal:
    0 !== 1
  expected: 1
  actual: 0
  stack: TestContext.<anonymous> (scripts/ops/runtime-verifier-gate.test.ts:120:10)
```

### 6. Mutation check — every newly wired test is load-bearing

Each newly wired test was paired with the module it actually imports or spawns,
that module was mutated, the test re-run, and the module byte-restored. A test
that passes under mutation would be decorative. Machine-readable receipt:
`docs/06_status/proof/UTV2-1624/mutation-check.json`.

```text
KILLED   scripts/ops/review.test.ts <- scripts/ops/review-state-schema.ts (clean=0, mutant=1, restored=true)
KILLED   scripts/ops/review-verdict.test.ts <- scripts/ops/review-state-schema.ts (clean=0, mutant=1, restored=true)
KILLED   scripts/ops/review-state-schema.test.ts <- scripts/ops/review-state-schema.ts (clean=0, mutant=1, restored=true)
KILLED   scripts/ops/agent-result-schema.test.ts <- scripts/ops/agent-result-schema.ts (clean=0, mutant=1, restored=true)
KILLED   scripts/ops/merge-risk.test.ts <- scripts/ops/merge-risk.ts (clean=0, mutant=1, restored=true)
KILLED   scripts/ops/ci-dispatch-watchdog.test.ts <- scripts/ops/ci-dispatch-watchdog.ts (clean=0, mutant=1, restored=true)
KILLED   scripts/ops/p0-detect.test.ts <- scripts/ops/p0-detect.ts (clean=0, mutant=1, restored=true)
KILLED   scripts/ops/proof-check.test.ts <- scripts/ops/proof-schema.ts (clean=0, mutant=1, restored=true)
KILLED   scripts/ops/proof-schema.test.ts <- scripts/ops/proof-schema.ts (clean=0, mutant=1, restored=true)
KILLED   scripts/ops/concurrency-rules.test.ts <- scripts/ops/concurrency-rules.ts (clean=0, mutant=1, restored=true)
KILLED   scripts/ops/executable-wiring.test.ts <- scripts/ops/executable-wiring.ts (clean=0, mutant=1, restored=true)
KILLED   scripts/ops/runtime-contract-check.test.ts <- scripts/ops/runtime-contract-check.ts (clean=0, mutant=1, restored=true)
killed 12/12
```

An earlier round paired `review.test.ts`, `review-verdict.test.ts` and
`proof-check.test.ts` with their same-named CLI entrypoints and recorded
SURVIVED. That was a harness error, not weak tests: those files import
`review-state-schema.ts` and `proof-schema.ts` respectively. Re-pairing against
the module actually under test kills all three. The mis-pairing is recorded here
rather than quietly dropped.

### 7. The new gate run against pristine `origin/main`

`origin/main` at `b5ebdc23` was extracted with `git archive`, this branch's
baseline ledger copied in, and the checker run against it. It fails on exactly
the delta this lane closes and on nothing else:

```text
[executable-wiring] verdict=FAIL required_roots=verify
[executable-wiring] tests total=456 required-reachable=290 optional-reachable=36 fixture-helper=0 quarantined=0 unwired=130 (baselined=119 new=11)
[executable-wiring] capabilities total=142 wired=123 orphan=19 (baselined=18 new=1)
--- fail findings against pristine origin/main ---
WIRING_TEST_UNWIRED_NEW scripts/ops/agent-result-schema.test.ts
WIRING_TEST_UNWIRED_NEW scripts/ops/ci-dispatch-watchdog.test.ts
WIRING_TEST_UNWIRED_NEW scripts/ops/concurrency-rules.test.ts
WIRING_TEST_UNWIRED_NEW scripts/ops/merge-risk.test.ts
WIRING_TEST_UNWIRED_NEW scripts/ops/p0-detect.test.ts
WIRING_TEST_UNWIRED_NEW scripts/ops/proof-check.test.ts
WIRING_TEST_UNWIRED_NEW scripts/ops/proof-schema.test.ts
WIRING_TEST_UNWIRED_NEW scripts/ops/review-state-schema.test.ts
WIRING_TEST_UNWIRED_NEW scripts/ops/review-verdict.test.ts
WIRING_TEST_UNWIRED_NEW scripts/ops/review.test.ts
WIRING_TEST_UNWIRED_NEW scripts/ops/runtime-contract-check.test.ts
WIRING_CAPABILITY_ORPHAN scripts/ops/agent-result-schema.ts
```

Those are the 11 tests this lane wires (the 12th, `executable-wiring.test.ts`,
does not exist on `main`) and the one capability that becomes `test-covered-library`
once its test is wired. Everything `main` would otherwise fail on is in the
baseline, explicitly, with an owner and an expiry — nothing is suppressed.

### 8. Verification commands on the branch

```text
$ git rev-parse HEAD
97fc751d7443e466167f3b088859ddb42a8e57af

$ pnpm type-check
TYPECHECK_EXIT=0

$ pnpm lint
LINT_EXIT=0

$ pnpm test:ops
# tests 1670
# pass 1670
# fail 0
# skipped 0
```

### 9. Rebase onto `origin/main` — union resolution, nothing unwired

UTV2-1604 added an entry to `test:ops` concurrently. Dropping an entry during
conflict resolution would silently unwire tests, which is the exact defect class
this lane exists to make impossible. The resolution was verified to be a strict
superset:

```text
main test:ops entries: 105
this branch:           117   (105 + 12 newly wired)
dropped from main:     0     []
other root scripts changed by this lane: []
```

## Follow-ups filed

| Issue | Scope |
|---|---|
| UTV2-1636 | Phase B — `apps/**` baseline (68 entries) |
| UTV2-1637 | Phase B — `packages/**` baseline (38 entries), plus chaining `@unit-talk/invariants` and `@unit-talk/observability` into the required `test` root |
| UTV2-1638 | Phase B — `scripts/**` baseline (12 entries) and the 18 orphan ops/ci capabilities |
| UTV2-1639 | Runtime Verifier Gate accepts a proof file that does not contain the supplied merge SHA (Urgent, T1) |

## Review findings applied to this lane's own diff

Two defects were found reviewing this diff against the standard it sets, and
both are fixed here rather than deferred:

- The CLI carried a `--no-wiring` flag. A required gate with an off switch is
  exactly the defect class this check exists to catch — the capability stays
  present while no longer doing anything. The flag is removed. The programmatic
  `wiring: false` option remains for registry-only unit fixtures, which have no
  workspace to analyse.
- A missing `package.json` at the analysis root silently skipped the wiring
  section and returned PASS. That is fail-open behaviour in a gate, against core
  invariant 10. It now emits `AUTO_WIRING_TOOL_FAILURE` and fails.

## Non-goals respected

- No suite runs all tests indiscriminately; 12 targeted governance tests were added
  to `test:ops` and nothing else.
- No external-service or destructive test is classified as required. 32 baseline
  entries carry `external-service` precisely because required CI does not provision
  a live database or a browser.
- No test was deleted for being unwired.
- No existing verify, branch-protection or governance requirement was weakened. The
  only behavioural change to an existing gate is additive.
