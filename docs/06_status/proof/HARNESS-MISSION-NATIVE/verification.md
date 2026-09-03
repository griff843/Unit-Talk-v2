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
# tests 2977
# pass 2977
# fail 0

$ pnpm exec tsx --test scripts/ops/mission-native-agents.test.ts
# pass 17
# fail 0

$ pnpm exec tsx --test scripts/ops/codex-packet.test.ts
# pass 32
# fail 0

$ pnpm exec tsx --test scripts/ops/classify-diff.test.ts
# pass 13
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
- [x] `pnpm test:ops`: 2977 tests, 2977 pass, 0 fail
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

## Merge SHA Binding

Bound after merge by `ops:proof-generate --merge-sha`. The `Execution SHA` below is the last
non-proof commit on this branch and is what the assertions above were verified against.

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1492
Approved PR head: pending merge
Execution SHA: 02011e1202d825eadf598ccd7adbc2ea5ba48ef9
