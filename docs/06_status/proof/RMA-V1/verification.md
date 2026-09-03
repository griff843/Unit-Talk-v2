# PROOF: RMA/v1 — Risk-Scoped Merge Authority

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the ratified pre-merge value; the Execution SHA
> row carries the verified implementation identity. This is a mission-native change: there
> is no lane manifest and no Linear issue, so nothing rebinds this row automatically. It is
> bound after merge by the same `ops:proof-generate --merge-sha` path any bundle uses.

Tier: reserved (merge-authority, production-containment, auth-and-authorization)
Lane type: governance
Proof profile: static
Branch: claude/rma-v1-risk-scoped-merge-authority
PR: https://github.com/griff843/Unit-Talk-v2/pull/1491
result: pass

## Summary

RMA/v1 moves merge authorization from "what tier was this lane admitted at?" to "what does
this diff touch?". Under the tier model every PR resolved to T1, so a typo fix and a
production migration demanded the same human relay — which is the same as reserving
nothing, because it prices the real decisions at zero attention.

This bundle covers the ratified change plus the three P1 findings an independent Codex
review raised against it, all of which were real:

1. **The gate could not bootstrap itself.** Merge Gate and Executor Result Validation load
   the classifier from the PR's BASE checkout. On the one PR that first introduces that
   classifier, base does not have it, the `require()` throws, and the failure was recorded
   as an internal error — a condition no label and no verdict can clear. RMA was landable
   only by a repo-owner override of a required check, which is the single dependency a
   merge-authority control must not have.
2. **A rename escaped the boundary.** GitHub reports a rename as `filename` (destination)
   plus `previous_filename` (source). Only the destination was classified, so
   `git mv .github/CODEOWNERS notes.txt` deleted the ownership boundary in a diff that, read
   by destination alone, touched nothing reserved and classified as `auto`.
3. **The surface list was too narrow.** It reserved six surfaces and left auth/authz
   authority, the distribution gating decision, and the worker delivery implementation on
   the `auto` side.

Finding 3 is resolved by risk, not by restoring the historical Tier C list. Pure logic that
CI can actually judge — `packages/domain`, `packages/contracts`, the lifecycle repositories,
ordinary API services — stays `auto` deliberately, and the policy now records that choice as
a `scopeNote` so a later reader does not reintroduce Tier C under a new name.

## ASSERTIONS:

- [x] The bootstrap degrades to `human`, the MOST restrictive classification — not to
      `auto`, and not to an unclearable internal error. A diff that would classify as `auto`
      is BLOCKED while the classifier is absent from base.
- [x] The bootstrap is clearable by the ordinary reserved-surface artifacts — a CODEOWNERS
      `griff-approved` label AND a head-SHA-bound `pm-verdict/v1` APPROVED comment. No admin
      override of a required check is involved at any point.
- [x] The label alone does not clear the bootstrap; both artifacts are required, exactly as
      for any other reserved diff.
- [x] Only `MODULE_NOT_FOUND` enters the bootstrap path. A malformed or unreadable policy
      still fails closed as an internal error, so corrupting the classifier is not a route to
      a path with weaker checks.
- [x] The bootstrap is one-time and self-limiting: re-entering PHASE 1 requires deleting
      `scripts/ops/merge-authority.cjs` from main, which is itself a change to the
      merge-authority surface and therefore already requires a human.
- [x] Executor Result Validation takes the same bootstrap path and REQUIRES a proof bundle
      when it cannot classify, rather than excusing one — the strictest reading of the
      absence. This bundle exists because that rule applies to this PR.
- [x] Renaming a reserved file to an unreserved name is reserved; renaming an unreserved
      file INTO a reserved path is reserved; an ordinary rename between two unreserved paths
      stays `auto`. Content rules are evaluated against the previous path too, so a `.sql`
      file cannot escape the destructive-SQL scan by being renamed to `.txt`.
- [x] Both required gates pass `previous_filename` to the classifier — asserted against the
      workflow files themselves, not only against the module.
- [x] Auth/authz authority, member-delivery gating (including the distribution decision),
      and the worker delivery implementation are reserved.
- [x] A worker TEST file is NOT reserved. Reserving the worker's tests would price writing a
      regression test at the same attention as changing the delivery path.
- [x] `packages/domain`, `packages/contracts`, the lifecycle repositories and ordinary API
      services remain `auto`, asserted explicitly so a later widening is a visible test
      change rather than a quiet one.
- [x] Three mutation controls reproduce each defect independently.
- [x] `pnpm lint`, `pnpm type-check` and `pnpm test:ops` are green on the execution SHA.

## EVIDENCE:

The defect this bundle's first finding names, measured on this PR rather than inferred —
three consecutive Merge Gate evaluations, every one of them unclearable:

```
$ gh pr view 1491 --json comments
**MERGE GATE: BLOCKED**
- Internal error: Cannot find module
  '/home/runner/work/Unit-Talk-v2/Unit-Talk-v2/scripts/ops/merge-authority.cjs'
```

Targeted suites on the execution SHA:

```
$ pnpm exec tsx --test scripts/ops/merge-authority.test.ts
# tests 43
# pass 43
# fail 0

$ pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts
# tests 74
# pass 74
# fail 0
```

The bootstrap tests are not string assertions about the YAML. They extract the
`github-script` body from `merge-gate.yml`, compile it, and run it against a mocked Octokit
with `require('./scripts/ops/merge-authority.cjs')` throwing `MODULE_NOT_FOUND` — the exact
condition the runner hits — then read the conclusion off the resulting check run.

Mutation control 1 — restore the pre-fix rename behavior (`filePaths` returns only
`file.filename`):

```
$ pnpm exec tsx --test scripts/ops/merge-authority.test.ts
not ok 32 - renaming a reserved file to an unreserved name is still reserved
not ok 34 - renaming the gate workflow out of .github/workflows is reserved
not ok 36 - a content rule is evaluated against the previous path too
# pass 40
# fail 3
```

Mutation control 2 — restore the pre-fix bootstrap behavior (rethrow instead of entering
PHASE 1):

```
$ pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts
not ok 69 - RMA bootstrap: a base checkout without the classifier reserves the merge as human, it does not release it
not ok 70 - RMA bootstrap: the CODEOWNERS label plus a head-bound verdict clears it — no admin override needed
not ok 71 - RMA bootstrap: the label alone does not clear it
not ok 72 - RMA bootstrap: only MODULE_NOT_FOUND takes the bootstrap path
# pass 70
# fail 4
```

Mutation control 3 — remove the `auth-and-authorization` surface from the shipped policy:

```
$ pnpm exec tsx --test scripts/ops/merge-authority.test.ts
not ok 37 - auth and authorization authority is reserved
# pass 42
# fail 1
```

Each control fails on the condition its assertion names and on no other, so no one of the
three fixes is carrying another's coverage.

Classification dry-run over every open PR, run through the real classifier against real
`pulls.listFiles` payloads — the widened policy in practice:

```
 1497 auto   -                                        docs(mission): reconcile the plan
 1496 human  secrets                                  feat(deploy): deploy the operator console
 1495 auto   -                                        fix(verify-semaphore): claim the slot
 1494 human  destructive-sql                          harden(command-center): management token
 1493 auto   -                                        fix(command-center): a dot in the path
 1492 auto   -                                        harness: recalibrate the agent environment
 1491 human  merge-authority,destructive-sql          governance: RMA/v1
 1488 human  auth-and-authorization                   UTV2-1824: resolve capper identity
 1485 auto   -                                        UTV2-1825: bind the pre-merge placeholder
 1484 auto   -                                        feat(ops): UTV2-1773 canonical reference
 1479 auto   -                                        UTV2-1815: refuse unknown stake
 1477 human  production-ddl-and-data,destructive-sql  UTV2-1811: shared rate-limit DB contract
 1474 auto   -                                        UTV2-1789: Command Center env auth
 1451 human  production-ddl-and-data,destructive-sql  UTV2-1736: offer_history partitioning
 1429 auto   -                                        chore(governance): de-pin subagent models
```

That table was produced before `apps/command-center/src/middleware.ts` was added to the auth
surface. Re-run at the execution SHA:

```
1474 human auth-and-authorization
1488 human auth-and-authorization
1492 auto  -
```

so the shipped policy is 8 auto / 7 human across the open board. Both movers are the
substance of the third finding: #1488 (capper identity resolution) and #1474 (Command
Center deployed-environment authentication) were each authorizable on green CI before this
change, and neither is a diff whose correctness a test suite can vouch for — the tests that
would catch a weakened authz check are the same tests such a change edits.

## Verification

- [x] `pnpm lint`: pass (silent)
- [x] `pnpm type-check`: pass (silent)
- [x] `pnpm test:ops`: 2909 tests, 2909 pass, 0 fail
- [x] `pnpm exec tsx --test scripts/ops/merge-authority.test.ts`: 73 pass, 0 fail
- [x] `pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts`: 77 pass, 0 fail
- [x] `pnpm exec tsx --test scripts/ops/bootstrap-head-fallback-guard.test.ts`: 5 pass, 0 fail
- [x] `pnpm exec tsx --test scripts/ops/pre-merge-authorization.test.ts`: 49 pass, 0 fail
- [x] `pnpm exec tsx --test scripts/ops/executor-result-validate.test.ts`: 29 pass, 0 fail
- [x] Both workflow files parse as YAML after editing (`yaml.safe_load`)
- [ ] `pnpm verify` end-to-end: not obtainable off-CI — the final `test:live-db` step is
      refused by the fail-closed staging guard on a host with no staging identity. The
      authoritative receipt is the required `verify` context on this PR head.

## Runtime Verification

This is a `static`-profile governance change. It alters merge authorization only: no runtime
service, no database, no migration, no deployment surface, no delivery path is touched.
There is no live-DB behaviour to observe, and the writable-DB receipt is produced inside the
required `verify` context rather than asserted from proof text.

The behaviour that IS in scope — what the gate does when it cannot load its classifier — is
measured by executing the real workflow script under that exact condition, not by reading it.

## Containment

No production DDL, database mutation, deployment, ingestion, delivery, provider
resubscription or branch-protection change.

No gate is loosened. Every change here is in the restrictive direction: the bootstrap turns
an unclassifiable diff into a `human` reservation rather than an internal error, renames now
reserve on two paths instead of one, ERV demands proof where it previously could not decide,
and the surface list grew. The one intentional relaxation is the ratified premise of RMA
itself — that a diff touching no reserved surface is authorized on green CI — which is what
this PR is for and what the human approval on it authorizes.

## Independent review round 2

Four defects closed at this head. Each is stated as what would happen without the fix,
because a control that names no failure it prevents asserts nothing.

- [x] **The ERV bootstrap deadlock (found while verifying, not in review).** The required
      `Executor Result Validation` context is created only by `issue_comment` /
      `workflow_dispatch` runs, and GitHub executes the workflow file for those events from
      the DEFAULT BRANCH — not from the PR head. The PR that first lands RMA is therefore
      judged by main's pre-RMA validator, which rejects any branch outside
      `(claude|codex)/(utv2|uni)-NNN`. Observed live on this PR: *"Invalid Issue ID:
      `<missing>`" / "Invalid branch: claude/rma-v1-risk-scoped-merge-authority"*. No label,
      comment or verdict clears it, and the PR carrying the fix cannot install it before
      being judged by it. `pull_request` is the one event whose workflow file comes from the
      head, so while `scripts/ops/merge-authority.cjs` is absent from the trusted base
      checkout, that run takes the required identity. Once the classifier is on main the
      guard is false forever after and UTV2-1550's one-authoritative-identity rule is
      restored in full.
- [x] **P1 — the sanctioned merge wrapper double-gated the RMA decision.**
      `pre-merge-authorization.ts` resolved a lane-manifest tier and required a pm-verdict
      unless it read T2/T3. An `auto` diff that Merge Gate cleared was still refused at the
      final step, and a mission branch — no tracker id, so no manifest to look up — was
      refused permanently. Merge authority is now decided in exactly one place: a green
      `Merge Gate` on the exact head IS the RMA decision, because the gate itself required
      the CODEOWNERS label and the head-bound verdict before going green. The tier is still
      resolved and recorded in the receipt; it no longer decides anything. This function
      cannot be more permissive than the required check it defers to.
- [x] **P1 — a truncated changed-file list classified as a clean diff.** GitHub's
      List-pull-request-files endpoint stops at 3,000 files however far you paginate, so on
      a larger PR a reserved file can simply be absent from the response and the visible
      subset classify as `auto` in Merge Gate and waive proof in ERV. Both gates now pass
      the PR's own `changed_files` total, and a short list reserves as `unclassifiable`.
- [x] **P2 — a patchless rename skipped content inspection.** GitHub omits `patch` both for
      a 100%-similarity rename (nothing to scan) and for a rename whose accompanying edit is
      too large to return; only the change counts tell those apart. Added `DROP TABLE` in a
      renamed file could therefore reach `auto` when neither path was otherwise reserved. A
      rename is now skipped solely when it reports zero additions and zero deletions;
      anything else, including missing counts, is unclassifiable.

**Declined, on the record: "Keep human approval on every declared Tier C path."** The
ratified instruction for this work is the opposite — *"Do not automatically preserve every
historical Tier C path. The goal is risk-scoped authority, not old tiers under new names."*
`packages/domain`, `packages/contracts` and the lifecycle repositories stay `auto`, asserted
in both directions by test, with the rationale recorded in the policy's `scopeNote`. Every
boundary the PM did name is reserved.

### The bootstrap needed a re-trigger that does not restart CI

Observed on this PR rather than reasoned about. A PHASE 1 run owns the required
`Executor Result Validation` identity and fires on the same `pull_request` event as
`ci.yml`, so it always evaluates while `verify` is still queued: *"CI check is queued, not
completed."* Close/reopen does not resolve it — `reopened` restarts `verify` too, so the
loop cannot converge. Two attempts produced two cancelled CI runs and the same message.

`ci.yml` uses the DEFAULT `pull_request` types, which exclude `labeled`. Adding
`labeled`/`unlabeled` to the ERV workflow gives the required check a re-evaluation trigger
that does not restart CI. The test asserts both halves — ERV listens for it, `ci.yml` does
not — because the escape holds only while `ci.yml` stays on the defaults.

## Independent review round 3

Two P1s, both accepted. Both sit squarely inside the boundary the PM named
("merge authority"); neither is a restoration of historical tiers.

- [x] **Any workflow could mint a required check.** Branch protection binds CONTEXT NAMES,
      not workflows, and a same-repository PR runs its own copy of any workflow it edits.
      With `checks: write` that copy can create a newer, successful check run named `verify`,
      `Executor Result Validation`, `Merge Gate` or `P0 Protocol` — satisfying the very
      contexts that judge it. Reserving only the three workflows that legitimately produce
      those contexts left every other workflow, `ci.yml` included, as a way in.
      `.github/workflows/**` and `.github/actions/**` are now reserved.
- [x] **The sanctioned merge wrapper was `auto`.** The trusted wrapper would therefore merge
      a change that makes the NEXT wrapper return an unconditional authorization, or skip the
      merge mutex, for every subsequent PR. `pre-merge-authorization.ts`, `merge-wrapper.ts`,
      `ops-merge-wrapper.ts`, `merge-mutex.ts`, `truth-check-lib.ts` and
      `executor-result-validate.ts` are now reserved.

`package.json` is deliberately NOT reserved wholesale. Almost every PR edits it to wire a
new test into `test:ops`; reserving the file would make RMA meaningless. A content rule
reserves only lines that define or repoint the merge commands, and a test asserts ordinary
`test:ops` wiring stays `auto`.

### Mutation controls

Each control was applied to the shipped source, the suite run, and the source restored.
Each was caught, and each failed only its own assertions — so no fix carries another's
coverage.

| Mutation | Result |
|---|---|
| truncation guard disabled (`if (false && ...)`) | CAUGHT — 2 fail |
| patchless rename skipped again (`status === 'renamed'` alone) | CAUGHT — 1 fail |
| verdict never required (`return false`) | CAUGHT — 11 fail |
| ERV bootstrap identity removed (event never matches) | CAUGHT — 1 fail |
| only the 3 gate workflows reserved | CAUGHT — 1 fail |
| merge-wrapper-entrypoint content rule removed | CAUGHT — 1 fail |

## Independent review round 4

Three P1s, all accepted. Each is the same defect class: a diff that removes a control
without touching a file the classifier reserves.

- [x] **The required check ran a PR-controlled script.** `.github/workflows/ci.yml:264`
      runs `pnpm verify:static` inside the required `verify` job, resolved from the PR's
      OWN `package.json`. A diff repointing `verify:static` to `true` skipped
      lint / type-check / build / test and still produced a green required context, while
      classifying `auto`. The aggregator keys that job reaches — `verify:static`, `test`,
      `lint`, `type-check`, `build`, `test:command-center`, `ci:db-client-boundary`,
      `env:check` and the rest of the `verify:static` chain — are now frozen by the
      `ci-required-check-entrypoints` content rule.

      The leaf `test:<group>` keys are deliberately NOT frozen: wiring a new test file into
      a group is the ordinary case, and reserving it would make every harness PR a human
      relay. A second rule, `neutered-test-group`, reserves a group redefined to a value
      that invokes no runner at all (`true`, `echo skipped`, `exit 0`). The residual is
      stated rather than hidden: a diff can still delete individual files from a runner's
      argument list and stay `auto`. That change is legible in the diff itself; an emptied
      aggregator is not.

      **Scoping correction.** The unit tests passed on the first draft of these two rules,
      but replaying the last 40 merged PRs through the classifier did not: PR #1469 extends
      `apps/smart-form`'s `test` key with new test files and adds
      `"test:e2e": "playwright test ..."`, and the draft reserved it — freezing exactly the
      ordinary wiring RMA exists to keep automatic. `ci-required-check-entrypoints` is now
      scoped to the ROOT `package.json`, the file the required job actually reads, and the
      complement rule (`neutered-workspace-script`) covers every workspace package with a
      runner allowlist that recognises playwright, vitest, mocha, next and turbo rather than
      `tsx` alone. After the correction #1469 classifies on `auth-and-authorization` alone,
      and 20 of the 40 sampled PRs stay `auto` — the round-4 rules add no human load across
      that sample while still reserving the attack.
- [x] **JSON escapes evaded the entrypoint rule.** `"ops\u003amerge-wrapper"` decodes to
      the key pnpm actually runs, but a regex over the raw patch text sees no colon and
      matches nothing. Content rules now accept `decodeJsonEscapes`, and every added line
      is tested in both its literal and its escape-decoded form.
- [x] **The reserved chain depended on an unreserved file.** `pre-merge-authorization.ts`
      imports `emitJson` from `scripts/ops/shared.ts` and hands it the receipt object
      before deriving the exit code from that same mutable object — so an edit confined to
      `shared.ts` could rewrite an authorization decision while classifying `auto`.
      `scripts/ops/shared.ts` is now part of the `merge-authority` surface.

### Mutation controls (round 4)

| Mutation | Result |
|---|---|
| `decodeJsonEscapes` handling disabled | CAUGHT — 1 fail |
| `ci-required-check-entrypoints` rule removed | CAUGHT — 2 fail |
| `neutered-workspace-script` rule removed | CAUGHT — 2 fail |
| `scripts/ops/shared.ts` unreserved | CAUGHT — 1 fail |
| root entrypoint rule widened past the root package.json | CAUGHT — 1 fail |
| `playwright` dropped from the runner allowlist | CAUGHT — 1 fail |

Each was applied to the shipped source, the suite run, the source restored. Each was
caught, and each failed only its own assertions.

## Independent review round 5

Three P1s and a P2, all accepted, and together they say one thing: **a line regex over a
structured file is the wrong instrument.** Round 4 added two content rules over
`package.json` patch text. Review then found three independent ways to write the same
parsed value while matching neither rule:

- a JSON escape — `"ops\u003amerge-wrapper"` is the key pnpm runs, and carries no colon;
- a reformat — `"verify:static"` on one added line and `: "true"` on the next parses to the
  same key, and neither line matches a pattern that requires both on one line;
- a comment — `true # tsx --test` contains `tsx`, satisfies a substring allowlist, and runs
  nothing.

Patching the regex a fourth time would have been the wrong move. **The package.json rules
are now structural**: `analyzeManifests` parses the manifest at base and at head and
compares the parsed values. Encoding, whitespace, key order and commentary become
irrelevant by construction, because the comparison is on what the parser produces — which is
exactly what pnpm executes.

- [x] **Protected script keys are compared as parsed values.** A root script the required
      `verify` job reaches is reserved when its parsed value changes at all — including to
      another working command, because "what that check proves" is what changed. Every other
      script, in any workspace manifest, is reserved when its new value *executes nothing*:
      the command is split on shell operators, comments are dropped, leading `VAR=` removed,
      `pnpm`/`npx`/`exec`/`run` unwrapped, `pnpm <script>` resolved inside the same manifest,
      `pnpm --filter <pkg> <script>` accepted as delegation, and `bash -c "..."` judged on
      what the shell was handed rather than on the shell's presence.
- [x] **The pnpm execution configuration is reserved.** `script-shell` in `.npmrc` redirects
      every script in the repository, so a diff could hand `verify:static` to a shell that
      returns success without running it while still delegating the DB commands needed to
      produce a genuine receipt. `.npmrc`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`,
      `.pnpmfile.cjs`, `.nvmrc` and `.node-version` are now the `control-toolchain` surface.
- [x] **The toolchain the control chain runs through is reserved.** The wrapper executes
      `pnpm exec tsx scripts/ops/pre-merge-authorization.ts`. Reserving that TypeScript file
      is worthless if the diff can replace what evaluates it: a changed `tsx`, `typescript`,
      `eslint`, `turbo` or `pnpm` version in the root manifest now reserves.
- [x] **A runner substring is no longer taken as proof of a runner.** The check resolves the
      command word actually executed, so `true # tsx --test`, `echo tsx`, `exit 0`, `:` and
      `bash -c "true"` all reserve.

A changed manifest whose contents were not supplied, or that does not parse, is
`unclassifiable` — the classifier fails closed rather than treating an unreadable file as a
clean one. Both gates fetch the manifests they need at base and at head; a read failure that
is not a genuine 404 propagates rather than being reported as "unchanged".

### The head-read guard had to be narrowed, deliberately

`bootstrap-head-fallback-guard.test.ts` asserted Merge Gate *never* calls `repos.getContent`.
That guard exists because the retired bootstrap exception read an **authorizing artifact**
out of a ref and believed it. Reading a PR's own `package.json` to classify it is the
opposite operation: nothing read there can produce `auto` where refusing to read would not,
and a failed read reserves. BHF-2 now asserts the properties that actually matter — exactly
one repository read exists, it is the named manifest reader, it reads only `package.json`
paths, a non-404 failure propagates, the result reaches the classifier as `manifests`, and
no lane/tier/proof/approval artifact is read. Three mutations confirm it is not decorative.

### Replay against real work

The unit tests passed on round 4's regex rules; replaying the last 40 merged PRs through the
classifier is what caught their false positive. That replay is now part of the evidence, run
again against the structural rules with real base/head manifests fetched from GitHub:

| | Round 4 (regex) | Round 5 (structural) |
|---|---|---|
| `auto` | 20 / 40 | 20 / 40 |
| PRs newly reserved by the manifest rules | 1 (#1469, a false positive) | 0 |

No merged PR in that sample touched `.npmrc`, `pnpm-lock.yaml` or `pnpm-workspace.yaml`, so
reserving the toolchain surface costs nothing measurable against real work.

### Mutation controls (round 5)

| Mutation | Result |
|---|---|
| missing manifest contents treated as clean | CAUGHT — 1 fail |
| `control-toolchain` surface removed | CAUGHT — 1 fail |
| toolchain dependency comparison disabled | CAUGHT — 1 fail |
| runner check disabled | CAUGHT — 2 fail |
| `bash -c` recursion removed | CAUGHT — 1 fail |
| BHF-2: non-404 read failure swallowed | CAUGHT — 1 fail |
| BHF-2: manifest path filter widened to any file | CAUGHT — 1 fail |
| BHF-2: a second repository read added | CAUGHT — 1 fail |

Each was applied to the shipped source, the suite run, the source restored. Each was caught,
and each failed only its own assertions.

One thing this round did NOT establish: comment stripping in the runner check is defensive
rather than load-bearing. Removing it broke no test, because the first resolved command word
already decides `true # tsx --test`. It is kept because it is correct, not because a control
proves it.

## Independent review round 6

Two P1s, both accepted, both defects in the round-5 command resolver rather than in the
structural approach. Both are the same mistake: **a command is not a flat bag of segments —
the shell's control flow decides what actually runs.**

- [x] **Short-circuiting was ignored.** `true || tsx --test scripts/ops/merge-authority.test.ts`
      classified `auto`. POSIX runs the right side of `||` only when the left *fails*, so
      `tsx` never launches — yet splitting on separators found a runner and accepted it. The
      resolver now splits alternation first and proves a command only when **every** `||`
      branch runs work. `exit` and `return` terminate a sequence, so nothing after
      `exit 0 &&` counts either.
- [x] **`--filter` was taken as proof of work.** `pnpm --filter @unit-talk/contracts exec true`
      classified `auto`: it exits 0 having run only `true`. The selector is now stripped and
      resolution continues on what follows, so `... exec true` reserves and
      `... exec tsx --test a.ts` does not.

The second fix has a stated cost. `pnpm --filter <pkg> <script>` names a script in a manifest
the diff does not contain, so nothing available to the classifier can prove what it runs, and
it now reserves. In this repository that shape appears only in the root `dev`,
`dev:command-center` and `dev:smart-form` keys — every other user of it
(`test:command-center`, `verify:commands`, `verify:static`) is already frozen as a CI
entrypoint. A chain is unaffected when its other links run work:
`pnpm lint && pnpm --filter @unit-talk/smart-form verify` still proves.

### A reserved merge had no valid exit

Review of the stacked harness PR surfaced a defect that belongs to RMA/v1 itself, not to the
harness: **the approval artifact this gate demands could not be validly written for a
mission-native PR.** `parseVerdict` required line 3 to match `Issue: (UTV2|UNI)-\d+`, and a
mission-native PR has no Linear issue. So the reserved branch of the gate demanded a
`pm-verdict/v1` that nothing could produce — a merge reserved to a human, with no way for the
human to unreserve it. That is not a strict gate; it is a deadlock, and it is exactly the
class of failure the two-phase bootstrap exists to avoid.

The parser now also accepts a ticketless `Issue: PR-<number>`. The field stays constrained —
`none`, `mission-native`, `PR-` and a bare number are all still refused — so this is a
ticketless FORM, not free text.

One consequence worth stating before it bites: **this PR cannot benefit from its own fix.**
Merge Gate loads the parser from the PR's BASE checkout, and base is `main`, which carries
the old regex. Approving #1491 therefore requires an `Issue:` line matching
`(UTV2|UNI)-\d+`. The old parser only pattern-matches that field — it never checks the
identifier exists — so referencing an existing issue id satisfies it without creating one.
Every PR after this one can use `PR-<number>`.

### Mutation controls (round 6)

| Mutation | Result |
|---|---|
| `\|\|` treated as an ordinary separator | CAUGHT — 1 fail |
| `exit 0` no longer terminates a sequence | CAUGHT — 1 fail |
| `--filter` trusted as proof of work again | CAUGHT — 2 fail |
| ticketless verdict form removed | CAUGHT — 1 fail |

### Live proof of the PHASE 2 path

Round 5 shipped a manifest fetch that **cannot execute on this PR**: PHASE 1 takes the
bootstrap branch, so `analyzeManifests` is never reached here. It is exercised on #1492,
whose base carries the classifier. Merge Gate run `33698016161` on #1492 head `8894a122`
completed and returned a classification —

```
MERGE GATE: BLOCKED
- Reserved surface touched. Requires the "griff-approved" label from a CODEOWNERS member.
- A reserved surface requires a valid pm-verdict/v1 comment from a CODEOWNERS member.
```

— not the bootstrap message and not `Internal error`. #1492's diff includes `package.json`,
so both `readManifestAt` calls ran against the API and `analyzeManifests` returned without
throwing. The gate's PHASE 2 path is therefore proved by execution, not by argument.

### The re-trigger is proved in production too

Two ERV runs fired on `pull_request` at 00:10 from a label toggle on head `922fd4e7` while
`verify` stayed `pass` — the `labeled`/`unlabeled` escape works, and does not restart CI.

That run also surfaced a real defect in this session's own operating: every
`EXECUTOR_RESULT` comment posted during rounds 4-6 was **silently skipped**, because the
validator requires the literal lines `EXECUTOR_RESULT: READY_FOR_REVIEW` and
`schema: executor-result/v1` plus a `Head SHA:` field, and the comments used
`EXECUTOR_RESULT/v1` and `Head:`. A malformed comment is skipped, not failed, so ERV kept
selecting a stale one and reported a SHA mismatch against a commit from hours earlier. The
comment format is fixed; the underlying sharp edge — that malformed input degrades to
*stale* input rather than to an error — is worth its own repair and is not fixed here.

## Independent review round 7

Three P1s, all real, all reproduced:

```
false && tsx --test a.test.ts; true     # unreachable runner, then exits 0 anyway
tsx --test a.test.ts & true             # backgrounded; the status is discarded
tsx() { true; }; tsx --test a.test.ts   # the runner name shadowed by a no-op
```

Each classified `auto`. The `&&` split treated a conditional as a plain separator; `&` was
not a separator at all, so the backgrounded form's first word was still `tsx`; and a function
definition redefines what a word means, which no word-matching rule can see.

### The instrument was the wrong shape

Rounds 4, 5, 6 and 7 each fixed a real evasion and each was followed by another. That is not
four unlucky misses — it is a generator. The shell has more ways to discard a command's
execution or its status than a validator can enumerate, so a rule shaped as "assume work
unless a known trick is present" loses by construction. The number of rounds is the evidence,
not any individual finding.

So the default is inverted. A script value must PROVE it runs work, in a grammar small enough
to reason about: a `&&`-joined chain in which every element is a plain word resolving to a
configured runner. Backgrounding, pipes, subshells, function definitions, redirection,
command substitution, quoting, `;` and `||` are refused WITHOUT being interpreted. That
refusal set is strictly larger than any list of known tricks, and it does not grow when
someone invents a new one.

Every element must resolve, not merely one. In `a && b` the shell runs `b` only when `a`
succeeded, so requiring all of them makes reachability moot instead of something to reason
about — which is precisely what `false && tsx` exploited.

### Two deliberate false positives, kept

- `bash -c "tsx --test x"` really does run tests, and now reserves. Round 6 answered the
  `bash -c "true"` case by parsing the inner string; that is a second language to model, and
  the validator was losing that race one construct at a time.
- `a || b` reserves even when both branches run work. A fallback chain inside a
  required-check entrypoint is worth one human glance.

Both are regressions in permissiveness relative to round 6, stated rather than hidden.

### The strictness is free on real work

The same 40 merged PRs replayed under the round-6 rules and under these rules produce an
IDENTICAL verdict on every single one: 24 `auto` / 16 `human`, with no script rule firing in
either run. Same sample, both rule sets, run back to back — so the tightening is not being
paid for by anyone. Four root scripts (`verify`, `verify:static`, `verify:commands`, `test`)
became unprovable because they delegate across workspaces via `--filter`; all four are
already reserved unconditionally as protected CI entrypoints, so nothing changes for them
either.

### Mutation controls (round 7)

Each applied alone, suite run, restored, and confirmed to fail only its own assertions:

```
== M1 accept a chain when ANY link runs work (round-6 semantics)   -> not ok 64, 65, 70; # fail 3
== M2 drop & (backgrounding) from the refused-syntax set           -> not ok 65;         # fail 1
== M3 drop | (pipes) from the refused-syntax set                   -> not ok 65, 71;     # fail 2
== M4 accept `true` and `false` as runners                         -> not ok 62, 64, 65, 67, 72; # fail 5
== restored                                                        -> # fail 0
```

A fifth mutation — dropping `{` and `}` from the refused set — caught NOTHING, and is
recorded as such rather than counted. A shell function definition necessarily contains `(`,
`)` and `;`, each of which already refuses the value, so the brace characters are defensive
rather than load-bearing. This is the same honesty the round-6 comment-stripping control got.

### A second silent-skip defect, same class as the first

The documented approval procedure in this bundle was itself unusable for a reason worth
recording: an `Issue:` line inside a fenced example block, posted in the same comment as the
executor result, is parsed by ERV as a real field. The comment reddened the required check it
was explaining. Combined with the malformed-`EXECUTOR_RESULT` defect already recorded above
and the invalid PM verdict template found on #1492, that is three parsers in one session that
treat a WRONG artifact as an ABSENT one. The defect class, not the three instances, is what
should be fixed.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1491
Approved PR head: pending merge
Execution SHA: 10abed063743ab076f4aadf70bd6c4e1d961ceb8
