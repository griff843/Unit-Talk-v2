# UTV2-1827 — verification

**Issue:** UTV2-1827 — governed staging proof runner
**Tier:** T1 · **Lane type:** runtime · **Executor:** claude
**Branch:** `claude/utv2-1827-governed-staging-proof-runner`
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1505
**Anchor (`verified_source_sha`):** `00ed6f6edfae3042f8ad820c767a4f2effc9bcad`

## Verification

Commands run on the branch at the anchor, in the lane worktree
`.out/worktrees/claude__utv2-1827-governed-staging-proof-runner`:

| Command | Result |
|---|---|
| `pnpm type-check` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm exec tsx --test scripts/ci/staging-proof-commands.test.ts scripts/ci/run-staging-proof-command.test.ts` | `# tests 44 / # pass 44 / # fail 0` |
| `pnpm test` (full suite) | run in CI as part of the required `verify` check — see `evidence.json` → `hosted_verification` |

`pnpm type-check` and `pnpm test` are both executed inside the required `verify` check on this PR,
and that check is the authoritative receipt for them. The local runs above are stated as local runs
and are not offered in place of it.

## What the controls are, and the mutation that proves each one

Each control below was removed or weakened, the suite re-run, and the file restored from a backup.
Every count in this section was read off the run that the mutation produced; none of it is recalled.

### M1 — remove the staging-target refusal

`admit()` calls `assertStagingTarget(env)` and returns a refusal when it is not `ok`. Deleting the
`if (!assertion.ok) { ... }` block — keeping the call, so the assertion is still computed and simply
not acted on — produces:

```
not ok 7 - refuses the canonical PRODUCTION project even with a valid key
not ok 8 - refuses a target whose identity cannot be resolved from its URL
not ok 9 - refuses when no target is configured at all
# tests 44 / # pass 41 / # fail 3
```

This is the control that makes production refusal structural rather than conventional: an
unidentifiable target — custom domain, pooler, tunnel, empty value — is refused alongside the
positively-identified production project, so the failure mode is closed rather than merely named.

### M2 — replace the registry lookup with an accept-anything constructor

Substituting `resolveStagingProofCommand()` with a constructor that builds a command out of whatever
key was supplied (`argv: options.commandKey.split(' ')`) — the shape a "just let the caller pass the
command" refactor would take — produces:

```
not ok 4 - refuses an unknown command key before any spawn decision is reached
not ok 5 - refuses a free-form command line supplied in place of a key
not ok 6 - refuses an arbitrary path supplied in place of a key
# tests 44 / # pass 41 / # fail 3
```

### M3 — change the workflow input from a closed list to free text

Replacing `type: choice` plus its `options:` list with `type: string` in
`.github/workflows/staging-proof-runner.yml` produces:

```
not ok 18 - the dispatch input is a closed choice list matching the registry exactly
# tests 44 / # pass 43 / # fail 1
```

The runner would still refuse a free-form value at M2's boundary, so this mutation does not open a
hole on its own. It is asserted because the closed list is what stops an unadmitted key from ever
being *offered*, and because a security property that lives only in YAML is exactly the kind that
gets edited away without anyone noticing.

### M4 — loosen exact match to a case-insensitive prefix

Replacing `command.key === requestedKey` with a lowercased 8-character prefix comparison produces:

```
not ok 23 - every admitted key resolves to its own fixed argv
not ok 31 - refuses trailing whitespace: "canonical-reference-bootstrap "
not ok 32 - refuses different case: "Canonical-Reference-Bootstrap"
not ok 33 - refuses truncated prefix: "canonical-reference-bootstra"
not ok 34 - refuses key with a suffix appended: "canonical-reference-bootstrap-extra"
not ok 38 - refuses a shell chain appended to a real key: "canonical-reference-bootstrap; cat /etc/shadow"
not ok 39 - refuses a shell conjunction: "canonical-reference-bootstrap && curl evil.example"
# tests 44 / # pass 37 / # fail 7
```

Seven failures: **six** of the fourteen rejected-key table entries, plus the fixed-argv test at
line 18. The other **eight** table entries — the empty string, whitespace, a path in place of a key,
`../../etc/passwd`, `/bin/sh`, `$(curl evil.example)`, backticks, and a free-form command line — are
still refused under the loosened comparison, because none of them shares the admitted key's opening
characters. That is the honest reading: this mutation shows the *exactness* of the match is
load-bearing for the near-miss, case-variant and appended-suffix cases specifically, not that every
entry in the table depends on it.

### M5 — treat an indeterminate ancestry answer as admissible

Removing the `isAncestorOfDefault === null` refusal from `admitRef()`, so "cannot tell" falls
through to the reachability check and passes:

```
not ok 14 - refuses when ancestry cannot be determined, rather than assuming it
# tests 44 / # pass 43 / # fail 1
```

### M6 — drop the ancestry requirement entirely

Removing both refusal branches, so any dispatched ref is admitted:

```
not ok 13 - refuses an unapproved ref — a commit not reachable from the default branch
not ok 14 - refuses when ancestry cannot be determined, rather than assuming it
# tests 44 / # pass 42 / # fail 2
```

### M7 — make the checkout shallow

Changing `fetch-depth: 0` to `fetch-depth: 1` in the workflow:

```
not ok 21 - the checkout has the history the ancestry check needs
# tests 44 / # pass 43 / # fail 1
```

`merge-base --is-ancestor` cannot answer on a depth-1 clone, and M5 shows the runner refuses on
"cannot tell". A shallow checkout therefore fails every dispatch closed rather than admitting one —
the assertion exists so that failure mode is caught at review rather than at the first dispatch.

### Restored

```
# tests 44 / # pass 44 / # fail 0
```

`git status --porcelain` reported no modification to any of the three mutated files after
restoration, so the tree the CI receipts describe is the unmutated tree.

## What this PR does NOT prove

Recorded plainly, because the gap is real and a reviewer should not have to find it.

1. **The runner has never executed end to end against staging.** `workflow_dispatch` workflows are
   only dispatchable once they are on the default branch, so `staging-proof-runner.yml` cannot be
   triggered from this PR at all. What is proven here is the admission boundary — which keys are
   accepted, which targets are refused, and that the workflow around them releases only
   `CI_SUPABASE_*`. What is *not* proven is a successful spawn, a real receipt, or the exit-status
   pass-through, all of which are first exercised by the first dispatch after merge.
2. **The first dispatch after merge is therefore the real acceptance test**, and it should be run
   deliberately rather than assumed. `canonical-reference-bootstrap-report` (`writes: false`) is the
   right first dispatch: it exercises the whole path — environment binding, staging assertion,
   spawn, receipt, artifact upload — without writing anything.
3. **The workflow-shape assertions read the YAML as text.** They confirm the file says
   `environment: staging-ci`, pins `ref: ${{ inputs.ref }}`, names no `secrets.SUPABASE_*`, and
   scrubs under `if: always()`. They do not confirm GitHub *honours* those directives; that is a
   property of the Actions runtime, evidenced by `staging-db-proof.yml` having behaved this way in
   production CI, not by anything this PR measures.
4. **The ancestry gate binds the registry to reviewed code, not the reviewer to good judgement.**
   It guarantees the `staging-proof-commands.ts` that admits a key is one that reached `main`
   through the normal PR path. It does nothing about a command admitted *into* `main` by a review
   that should have refused it, and nothing about someone who can write to `main` directly. Those
   are the merge gate's and branch protection's problems, and they are not solved here.
5. **`writes: true` on `canonical-reference-bootstrap` is a declaration, not an enforcement.** The
   registry records whether a command writes so a reviewer can see it; nothing in this PR prevents a
   command declared `writes: false` from writing. The containment that actually holds is the
   credential boundary — the job releases only project-scoped staging keys, and a Supabase API key
   is a project-scoped JWT, so the staging key returns 401 against production regardless of what any
   admitted command attempts.

## The controls, named

| # | Control | Where | Mutation that proves it |
|---|---|---|---|
| 1 | the dispatch input is a key, resolved against a repository-owned registry by exact match | `staging-proof-commands.ts`, `run-staging-proof-command.ts` | M2, M4 |
| 2 | the closed choice list stops an unadmitted key being offered at all | `staging-proof-runner.yml` | M3 |
| 3 | the target must be positively the approved staging project before any spawn | `run-staging-proof-command.ts` → `assertStagingTarget` | M1 |
| 4 | the executed commit must be reachable from the default branch, and "cannot tell" is a refusal | `admitRef()`, `readRefFacts()` | M5, M6, M7 |
| 5 | a refusal exits 78, never a code the proof command could produce | `run-staging-proof-command.ts` | asserted directly (`the refusal exit code is distinct…`) |
| 6 | the job releases only `CI_SUPABASE_*`, pins the ref, and scrubs `local.env` under `if: always()` | `staging-proof-runner.yml` | asserted as workflow shape |

Control 4 is the one the issue's requirement 6 names as "unapproved ref". It closes the gap that
would otherwise make every other control decorative: the registry is only as trustworthy as the
commit it is read from, so a dispatcher who can push a branch could rewrite the registry on that
branch and dispatch it. The registry would still be consulted — it would just be theirs.

## Dispatch identity

Requirement 2 asks the execution to record the command key, environment and project identity,
actor, run id and exit status. The shared `ci-db-proof-receipt/v2` schema carries every one of those
except the actor, and widening a structure that four other workflows already verify was the wrong
way to add one field. The runner therefore writes `staging-proof-dispatch/v1` beside the receipt,
carrying the command key and argv, the declared `writes` flag, the requested ref, the resolved
commit, the ancestry verdict, `GITHUB_ACTOR` and `GITHUB_TRIGGERING_ACTOR`, the run id and attempt,
the observed project ref, the timings and the exit status — plus the receipt's own `receipt_sha256`,
which is what ties the two files together. Both are uploaded under the run-scoped artifact name.

## Scope and containment

One existing file is modified — `package.json`, and only its `test:ops` line, which appends this
lane's two suites so `verify` reaches them. Without it `executable-wiring` fails `verify` with
`WIRING_TEST_UNWIRED_NEW` for both files; with it the check reports
`[executable-wiring] verdict=PASS required_roots=verify` and required-reachable rises 326 -> 327.

`package.json` is outside this lane's `file_scope_lock`, which is pinned to the lane-start commit
and cannot be widened by an agent, so this PR requires an authorized `scope-override/v1` for that
one path. The change is landed before the override is requested so a single human action binds a
head that will not move again.

Every other path in the diff is new. `ci.yml`,
`staging-db-proof.yml`, `proof-gate.yml` and `t1-proof-gate.yml` are untouched, and the new workflow
is `workflow_dispatch`-only, so nothing that runs today changes behaviour.

No production credential is referenced anywhere in the diff, no containment setting is changed, and
no production write path is touched. `SYNDICATE_MACHINE_MODE` and every delivery target are
unaffected.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1505
Approved PR head: pending merge
Execution SHA: 00ed6f6edfae3042f8ad820c767a4f2effc9bcad
