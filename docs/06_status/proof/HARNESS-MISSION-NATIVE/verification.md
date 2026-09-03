# PROOF: Mission-Native Harness Recalibration

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the ratified pre-merge value; the Execution SHA
> row carries the verified implementation identity. This is a mission-native change: there
> is no lane manifest and no Linear issue, so nothing rebinds this row automatically. It is
> bound after merge by the same `ops:proof-generate --merge-sha` path any bundle uses.

Tier: reserved (control-plane-harness)
Lane type: governance
Proof profile: static
Branch: harness/mission-native-recalibration
PR: https://github.com/griff843/Unit-Talk-v2/pull/1492
result: pass

## Summary

The harness assumed a Linear-issue-per-unit-of-work world: agents read a lane manifest to
learn a tier, skills demanded an issue ID before they would run, hooks blocked commits whose
message lacked a `UTV2-###`, and routing docs sent work to `/dispatch`. None of that
describes how work is actually admitted now. The assumptions did not merely add noise — they
produced wrong answers, because a tier read from a manifest that no longer exists degrades
to a default rather than to a refusal.

This PR removes those assumptions and replaces them with policy-based, patch-based
equivalents. The hard safety controls are preserved and, in two places, tightened.

It is stacked on RMA/v1 (#1491) and carries that PR's commits; only the harness commits
belong to this review.

## ASSERTIONS:

- [x] No ACTIVE agent, skill, or command carries a Linear-era invocation inside a fenced
      command block. Legacy copies are retained under `.claude/commands/legacy/` as history
      and are excluded by path, not by pretending they were deleted.
- [x] `runtime-verifier` and `pr-risk-reviewer` classify a PR from its real patch via
      `pnpm ops:classify-diff --base origin/main --head pr-N`. Neither reads a lane manifest,
      an issue, a tier label, or an R-level to reach its verdict.
- [x] `pnpm ops:classify-diff` is a real, wired, executable command — not a documented
      module invocation. It is exercised by `scripts/ops/classify-diff.test.ts` (13 tests).
- [x] `ops:codex-packet` REFUSES to run against the control checkout or `main`, and requires
      an isolated non-main worktree and branch.
- [x] `codex-packet` resolves model profiles through the canonical fail-closed resolver. The
      permissive fork is gone; an unknown profile refuses rather than defaulting.
- [x] `codex-return-reviewer` no longer demands an issue, a manifest, a tier label, or an
      R-level. Its risk judgement comes from the reserved-surface policy.
- [x] A directory scope is reserved by what it CONTAINS, not only by exact-path match: a
      scope of `apps/smart-form/lib` is reserved because that directory holds `auth-*.ts`.
      An ordinary directory scope stays unreserved.
- [x] `runtime-verifier`'s DB-evidence trigger covers where writes actually live —
      `packages/db/**`, `supabase/**`, the lifecycle repositories, `apps/api/src/*-service.ts`
      and `apps/worker/**`.
- [x] Reserved work is not stopped before implementation. Approval gates the MERGE, not the
      keyboard; the pre-implementation halt was a Linear-era artifact that spent a full cycle
      to learn nothing.
- [x] The PM verdict template publishes all five lines `validateT1Verdicts()` requires
      (`PM_VERDICT`, `schema`, `Issue`, `PR`, `Head SHA`). The previous three-line template
      produced a verdict the parser silently did not count.
- [x] The `reserved-surface-guard` hook replaces `tier-c-path-guard` and reads the same
      `RESERVED_RISK_SURFACES.json` the merge gate reads — one policy, two consumers, no
      second list to drift.

## EVIDENCE:

```
$ pnpm lint
(silent)

$ pnpm type-check
(silent)

$ pnpm test:ops
# tests 2998
# pass 2998
# fail 0

$ pnpm exec tsx --test scripts/ops/mission-native-agents.test.ts
# pass 28
# fail 0

$ pnpm exec tsx --test scripts/ops/codex-packet.test.ts
# pass 34
# fail 0

$ pnpm exec tsx --test scripts/ops/classify-diff.test.ts
# pass 15
# fail 0

$ pnpm exec tsx --test scripts/ops/branch-discipline-guard.test.ts
# pass 7
# fail 0

$ pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts
# pass 78
# fail 0

$ pnpm exec tsx --test scripts/ci/concurrency-doc-drift-guard.test.ts
# pass 19
# fail 0

$ pnpm exec tsx --test scripts/codex-dispatch.test.ts
# pass 15
# fail 0
```

## Verification

- [x] `pnpm lint`: pass (silent)
- [x] `pnpm type-check`: pass (silent)
- [x] `pnpm test:ops`: 3008 tests, 3008 pass, 0 fail (round 8 head)
- [x] Seven targeted suites green, as listed above
- [ ] `pnpm verify` end-to-end: not obtainable off-CI — the final `test:live-db` step is
      refused by the fail-closed staging guard on a host with no staging identity. The
      authoritative receipt is the required `verify` context on this PR head.

### One unreproduced test failure, recorded rather than hidden

The first `pnpm test:ops` run after the round-6 edits reported `2960/2961` with one failure.
Five subsequent full runs — three before the rebase and two after — reported `0 fail`, and
the failing test's identity was not captured before the buffer was lost. I am not able to
name it, so I am not claiming it was unrelated or benign. What is verifiable: the suite is
green on this head across five consecutive runs, and the authoritative receipt is the
required `verify` context on the PR head, not this local run.

## Runtime Verification

Not applicable. This PR changes the control-plane harness only: agent definitions, skills,
commands, hooks, and the scripts that serve them. It touches no product code, no schema, no
migration, and nothing in the ingestion, scoring, or delivery paths. No process reads or
writes a database as a result of this change.

## Containment

- Production DDL: none
- Database mutation: none
- Deployment: none
- Ingestion: unchanged (parked)
- Delivery: unchanged (parked)
- Branch protection: unchanged
- Gates loosened: none. `tier-c-path-guard` is replaced by `reserved-surface-guard`, which
  reads the ratified surface policy rather than a hand-maintained path list; the
  `commit-msg-linear-check` hook is removed because a mission-native commit has no Linear ID
  to check, which makes it a guard that could only ever produce false refusals.

## Independent review round 5

Five findings, all real, all resolved:

1. **`/dispatch` routing survived in an ACTIVE doc.** `three-brain.md` still routed work to
   a command that had been moved to `legacy/`. Removed.
2. **The diff classifier was documented, not runnable.** The docs told an agent to invoke a
   module. There was no command. `pnpm ops:classify-diff` is now wired in `package.json`
   with its own test suite.
3. **`ops:codex-packet` would run in the control checkout.** It now refuses `main` and the
   control checkout and requires an isolated worktree and branch.
4. **A permissive model-profile fork.** `codex-packet` maintained its own resolver that
   defaulted on an unknown profile. It now calls the canonical fail-closed resolver.
5. **`codex-return-reviewer` still assumed issue/manifest/tier/R-level.** Fully migrated to
   policy-based review.

## Independent review round 6

Four findings:

1. **The agents still read a tier.** `runtime-verifier` and `pr-risk-reviewer` derived risk
   from a lane manifest. Both now classify the real patch.
2. **The DB-evidence trigger missed the writers.** `apps/api/src/*-service.ts` and
   `apps/worker/**` are where the writes are, and neither was listed.
3. **Rule 9 stopped reserved work before implementation.** Approval gates the merge, not the
   keyboard.
4. **The documented PM verdict template was invalid.** Three lines where the parser needs
   five. Anyone following the doc produced a verdict that was silently ignored — the same
   defect class as the malformed `EXECUTOR_RESULT` comments recorded on #1491.

### Mutation controls (round 6)

Each mutation applied alone, suite run, mutation restored, and confirmed to fail only its
own assertions:

```
== M1 empty-patch classification restored     -> not ok 13, # fail 1
== M2 api-service DB trigger dropped          -> not ok 14, # fail 1
== M3 pre-implementation stop restored        -> not ok 15, # fail 1
== M4 three-line verdict template restored    -> not ok 16, # fail 1
== restored                                   -> # fail 0
```

## Independent review round 7

One P1 and six P2s, all real.

**P1 — the operator runbook gated rollback on a Linear credential.** Promoting
`/operator-runbook` as mission-native exposed a universal preflight that exits 1 without
`LINEAR_API_TOKEN`, plus a health-check that ran `pnpm linear:work`. Rollback and restore do
not read Linear, so the operations most likely to be run under pressure stopped on a
credential they never use. That is worse than a stale doc: it is a working blocker introduced
by advertising the file as ready.

**The deprecated Linear skill still mutated Linear.** Its description said read-only and
deprecated; its body listed `linear:update`, `linear:comment` and `linear:close` as default
commands and declared Linear to be queue truth. Routing reads the description, so a body that
contradicts it is worse than no deprecation at all. Rewritten read-only, with the three
mutating commands explicitly refused rather than merely absent.

**The agent brief attached lane-era requirements to every packet.** It is prepended to every
dispatch, and section 18 still instructed executors to choose a lane type and update proof
path lists in a lane manifest and a per-issue sync file. Mission-native work has none of
those, so the instruction could only stop work to satisfy something nothing enforces.

**Rule 8 ran post-merge QA only "after a T2 or T3 PR".** A mission-native PR carries no tier,
so the predicate is unsatisfiable and the router silently skipped the QA it advertises. Now
triggered by the changed path.

**codex-return-reviewer fell back to a filename list.** `--name-only` cannot evaluate the
policy's CONTENT rules, so an ordinary `.ts` file adding `DELETE FROM` read as unreserved
there while Merge Gate correctly classified it `human`. A reviewer that disagrees with the
gate in the PERMISSIVE direction is worse than one that declines to answer, so it now stops
rather than guessing when the ref cannot be fetched.

**`ops:classify-diff` never passed `manifests`.** The mandated pre-PR preview therefore
returned `human` / `unclassifiable` for every diff touching any `package.json` — including
adding a test script, which Merge Gate accepts. Wrong in the RESTRICTIVE direction is still
wrong: it routes ordinary work to a human who did not need to see it, which is the cost RMA
exists to remove.

**A wildcard packet scope escaped reserved classification.** `apps/**` was compared verbatim,
so `**` read as a literal directory component and `apps/worker/**` did not appear to live
under it. A packet covering the whole of `apps/` reported unreserved and took the permissive
default profile. Containment is now tested between literal prefixes in both directions, and
there is a test that a wildcard over unreserved ground stays unreserved — so the fix is not
"any wildcard reserves", which would be a different way of reserving everything.

### Mutation controls (round 7)

Each applied alone, suite run, restored, and confirmed to fail only its own assertions:

```
== M1 Linear credential hard-fail restored in the runbook   -> not ok 73;     # fail 1
== M2 linear:close restored to the deprecated skill         -> not ok 74;     # fail 1
== M3 tier predicate restored in Rule 8                     -> not ok 76;     # fail 1
== M4 --name-only classification fallback restored          -> not ok 77;     # fail 1
== M5 manifests withheld from the classify-diff CLI         -> not ok 14, 15; # fail 2
== M6 verbatim wildcard scope comparison restored           -> not ok 48;     # fail 1
== restored                                                 -> # fail 0
```

## Independent review round 8

Round 7's head (`bbca9017`) drew four findings — two P1, two P2. All four are resolved here.
Each fix carries a control, and each control was proven by applying the mutation alone,
running the suite, and restoring.

### P1 — the operator runbook gated every operation on credentials three of them never use

Round 7 removed the Linear hard-fail from the universal preflight. That was not enough. The
same block still exited on `GITHUB_TOKEN`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`,
and line 11 of the runbook forbids skipping it. So an emergency `rollback` — which connects
over `SUPABASE_DB_URL` and nothing else — a `restore-verify`, which uses its own
`BACKUP_RESTORE_VERIFY_*` set, and an in-memory `replay`, which needs repo defaults only,
were all unusable on a host without GitHub and Supabase REST credentials. Those are exactly
the operations most likely to be run under pressure on a degraded host, so this was the
expensive direction to be wrong in.

The universal preflight now asserts only what is genuinely universal: env layering,
`git`/`node`/`pnpm`, and `git status`. `pnpm ops:health` and `pnpm ops:brief` leave it as
well — both reach GitHub, so a universal invocation fails on the same offline hosts. Two
helpers (`require_env`, `require_tool`) are defined once, and each operation carries its own
**Preflight assertions** block naming its real inputs. `psql`, `pg_restore` and `gzip` are
asserted only by `restore-verify`, the one operation that invokes them.

The helpers were checked by execution, not by reading: `require_env` uses bash indirect
expansion (`${!v:-}`) and was run against a set variable, an unset variable, a present tool
and an absent tool, confirming pass/fail in all four cases.

### P1 — pr-unblock demanded a human verdict for an ordinary auto diff

`CLAUDE.md` promotes `/pr-unblock` in the mission-native skill table. Its Step 3
re-authorization procedure ended with an unconditional "Only then request PM verdict /
`t1-approved`". Under risk-scoped authority only a `human` diff needs one; on an ordinary
`auto` PR that step invents a human dependency the policy does not impose, and the wait is
pure cost — the precise failure RMA/v1 exists to remove.

Step 3 now reclassifies at the new head and branches on the answer. The invocation is real
and was verified by running it against PR #1492 rather than written from memory: an earlier
draft of this section documented a `--pr` flag that `classify-diff` does not have, and a
`.decision` field it does not emit. The shipped text uses `--base`/`--head`/`--json` and
reads `.authority`, and takes the base from `gh pr view --json baseRefName` because a
stacked PR is not based on `main`.

`pr-unblock.md` also joins the ACTIVE guard list, since a file promoted as an execution path
should be held to the same standard as the rest.

### P2 — codex-packet and suffix-only reserved globs

The finding: `literalDir('**/.env')` yields `/`, which compares unequal to every scope, so a
packet scoped at `packages/config` reads unreserved even though `packages/config/.env` is
reserved. The same holds for `**/.npmrc` and `**/.pnpmfile.cjs`.

The first fix I wrote was wrong, and the way it was caught is worth recording. I added a glob
matcher for suffix-only patterns. A probe of the actual classifier output — run before
trusting the passing tests — showed that scopes naming those files were ALREADY reserved
without it: `classifyScope` first calls `classifyDiff`, the same code the merge gate runs,
which handles the file case correctly and honours the surface's `excludePaths`. The only
behaviour my matcher changed was to make `**/.env.example` reserved, which the secrets
surface excludes on purpose. It made this function STRICTER than the gate it exists to
mirror — a divergence, not extra safety, and precisely the failure the `excludeNote` was
written to prevent. It was reverted.

The tempting alternative — return an empty prefix so `startsWith('')` always holds — is also
wrong, for a reason worth stating plainly: every directory in the repo can contain a `.env`,
so it reserves every scope unconditionally. A control that returns the same answer for every
input is not a control.

What is left is the genuine gap: a DIRECTORY scope cannot be answered from its path. That is
carried by an explicit prohibition in the packet prompt — `.env`, `.env.*`, `.npmrc`,
`.pnpmfile.cjs` are refused anywhere in the diff, including inside the declared scope — and
enforced at the two places that see the actual diff, the reserved-surface hook and the merge
classifier. The profile is a prior; the gate is at merge.

A test records the divergence that is NOT fixed: `classifyScope` and the merge gate agree on
`.env.example` today, and the test asserts that agreement so a future "coverage" patch cannot
reintroduce the stricter answer silently.

### P2 — the proof-closeout skill advertised itself for ordinary work

The body was correctly marked legacy. The selector was not. `description` still ended with
"Use when verifying implementation, preparing closeout evidence, checking runtime health",
and `trigger` repeated it verbatim. Selection happens on those two fields, so an ordinary
verification task still landed here, and the body then routed into `pnpm ops:brief`,
`pnpm proof:t1 -- --issue <UTV2-ID>` and `ops:lane-close` — reintroducing exactly the
ticket-and-lane workflow a mission-native packet does not have. A legacy label on the body is
worth nothing while the selector volunteers for the common case.

Both fields are now conditioned on a bundle that already exists under
`docs/06_status/proof/`. The body opens with an explicit selection rule and sends ordinary
verification to `pnpm verify` plus the PR-body template. The legacy commands are documented
with their REAL flags, checked against the sources: `ops:proof-check` takes the issue ID as a
positional, `ops:proof-rebind` requires `--issue` and previews unless given `--apply`, and
refuses `--pr-url` by design. Documenting that they are keyed by a `UTV2-###` ID is the point
— that dependency is what makes them legacy, not a rough edge to route around. Three broken
`C:/Dev/Unit-Talk-v2-main/...` references were replaced with repo-relative paths.

### Mutation controls (round 8)

Each mutation was applied alone, the suite run, and the file restored.

```
== MUTATION A packet prohibition text removed        -> not ok 38 "the packet prompt prohibits reserved filename shapes outright"; # fail 1
== MUTATION B classifyDiff answer discarded          -> not ok 35 "a scope naming a reserved-by-filename file is reserved";        # fail 1
== MUTATION C anchored=true (pre-fix glob handling)  -> not ok 37 "this function does not disagree with the gate it mirrors";      # fail 1
== MUTATION D proof-closeout SKILL.md reverted       -> not ok 29 "the legacy proof-closeout skill does not advertise itself";     # fail 1
== MUTATION E runbook + pr-unblock reverted          -> not ok 30, not ok 31;                                                       # fail 2
== restored                                          -> # fail 0
```

Mutation C is the control on the reverted first fix: with the pre-fix glob handling restored,
the `.env.example` agreement test fails, which is what pins this function to the gate's
answer rather than to a stricter one.

### Verification at this head

```
$ pnpm lint         -> pass (silent)
$ pnpm type-check   -> pass (silent)
$ pnpm test:ops     -> # tests 3008  # pass 3008  # fail 0
```

### The required Executor Result Validation context is red here, and will stay red until #1491 lands

Traced rather than assumed, because a red required check that is expected must be
distinguishable from one that is not.

`executor-result-validator.yml` chooses its checkout ref by event:

- `pull_request` -> the PR's **base** SHA. Deliberate, and it is the fix for a `pwn_request`:
  this job holds `checks: write` and executes `executor-result-validate.ts` from whatever is
  checked out, so pinning to the base means it always runs trusted code.
- `issue_comment` / `workflow_dispatch` -> `github.sha`, which for those events is the
  **default branch** HEAD, i.e. `main`.

And it chooses its check NAME by whether the checked-out base carries
`scripts/ops/merge-authority.cjs`. Absent (RMA/v1 phase 1) the `pull_request` run creates the
required `Executor Result Validation` context itself; present, it creates only the
non-required `Executor Result Preflight`, and the required context comes solely from
`issue_comment`.

This PR is based on #1491's branch, which carries the classifier. So it is NOT in phase 1:
its `pull_request` run publishes `Executor Result Preflight` (green at every recent head),
while the required `Executor Result Validation` is produced by an `issue_comment` run
executing **main's pre-RMA validator**, which rejects it for exactly the assumptions this PR
removes:

```
- Invalid Issue ID: "<missing>". Must match UTV2-NNN or UNI-NNN.
- Invalid branch: "harness/mission-native-recalibration". Must match claude/utv2-NNN-*, ...
```

That is unclearable from this PR by any comment, label or verdict, and it is not a defect
introduced here. It resolves mechanically when #1491 merges: this PR then retargets to
`main`, and main's validator is the corrected one. Recorded so that a reviewer does not read
a structurally expected red as an unresolved failure, and so that no one is tempted to
"fix" it by renaming the branch — which would close the PR.

## Merge SHA Binding

Bound after merge by `ops:proof-generate --merge-sha`. The `Execution SHA` below is the last
non-proof commit on this branch and is what the assertions above were verified against.

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1492
Approved PR head: pending merge
Execution SHA: 5265aba228a167d9bf14dc7500f3678aba2120ed
