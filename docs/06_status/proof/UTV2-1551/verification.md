# PROOF: UTV2-1551

MERGE_SHA: 09f08701848f21cb7949b912134868bb3a5d88b5

The SHA above is `09f08701848f21cb7949b912134868bb3a5d88b5` — the actual
merge commit of PR #1264 on `main`, which shipped this proof's reviewed
implementation (`merge-gate.yml`'s `opened` trigger fix, the
`tier-label-check.yml`/`tier-label-apply.yml` token-boundary split, and
`REQUIRED_SECRETS.md`). This branch's own diff (`claude/utv2-1551-t1-runtime-
proof-repair`, PR #1285) carries no further implementation changes — it
reconciles the lane manifest and binds real T1 runtime evidence
(`docs/06_status/proof/UTV2-1551/evidence.json`) against that already-shipped
commit, which the Executor Result Validator confirms is a genuine ancestor of
this branch's head. The prior value here (`86132abd...`, a pre-merge commit
on the earlier, now-superseded `claude/utv2-1551-merge-gate-continuation`
branch) predated the rename/rebase onto current `main` and was never an
ancestor of this branch's actual head — corrected as part of this PR's own
governed continuation fix.

## Verification

## Summary

Continuation lane for the "Merge Gate never evaluates on fresh PRs" root
cause, opened fresh from current `main` per instruction after the prior
attempt (PR #1247) hit its T1 bounce cap and went conflicting. Closes both
compounding gaps: (1) `tier-label-check.yml`'s label sync used the default
`GITHUB_TOKEN`, whose `labeled` events don't cascade to trigger other
workflows, so it could never fire Merge Gate's own `pull_request: labeled`
trigger; (2) `merge-gate.yml`'s own `pull_request` trigger omitted `opened`
entirely, so a brand-new PR got zero Merge Gate evaluation from PR creation
itself either.

## ASSERTIONS:

- [x] `tier-label-check.yml`'s tier-label sync step authenticates with
  `secrets.SYNC_BOT_TOKEN`, fail-closed with **no** `GITHUB_TOKEN` fallback
- [x] A `Require SYNC_BOT_TOKEN` guard step fails the job with a clear
  `::error::` message if the secret is unset, before the sync step runs
- [x] `SYNC_BOT_TOKEN` is documented in `docs/05_operations/REQUIRED_SECRETS.md`,
  listing both `post-merge-lane-close.yml` and `tier-label-check.yml` as
  consumers (it was previously used by the former without ever being
  inventoried there)
- [x] `merge-gate.yml`'s `pull_request.types` now includes `opened`
  (`[opened, synchronize, reopened, labeled, unlabeled, ready_for_review]`)
- [x] The gate job's `if:` condition already runs unconditionally for every
  `pull_request` event, so no separate `if:` change was required for `opened`
  evaluation to take effect
- [x] Reviewed the full gate job body: tier resolution reads the lane
  manifest via the Contents API (not GitHub labels), and T1/T2 verdict
  checks already fail closed with a clear BLOCKED status when no tier
  label / manifest / PM verdict exists yet — a fresh `opened` PR gets an
  immediate, visible BLOCKED status, never a premature approval
- [x] Updated the now-superseded regression test (`required PR check
  workflows do not create stale merge-gate contexts on opened events`,
  originally added under an earlier lane) to assert the opposite, with
  commentary on why the original "labels must settle first" premise did not
  hold
- [x] Added a new regression test asserting `merge-gate.yml`'s
  `pull_request.types` includes `opened` and that the gate job's own `if:`
  has no narrower per-type restriction
- [x] No branch-protection setting, required-status-check context, or
  repository ruleset touched
- [x] `pnpm verify:parallel` PASS (full local run, exit code 0)
- [x] `pnpm test:db` PASS (7/7, live Supabase)
- [x] `pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts` PASS (34/34 -- see the P1 addendum below; `docs/05_operations/REQUIRED_CI_CHECKS.md`'s stale Merge Gate trigger-list prose is a known, separate, out-of-scope gap, not corrected by this PR (see addendum's "Known gap" note))
- [x] `r-level-check` PASS, no artifacts required for this diff

## EVIDENCE:

```text
$ pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts
1..33
# tests 33
# suites 0
# pass 33
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 753.058911
```

```text
$ pnpm test:db
> @unit-talk/v2@0.1.0 test:db
> tsx --test apps/api/src/database-smoke.test.ts

TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 108075.744855
```

```text
$ pnpm verify:parallel
...
[verify:parallel] all checks passed
```

```text
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff
```

## Sequencing note

This supersedes PR #1247, which implemented root cause #1 only and
explicitly deferred root cause #2 (this PR's `opened` trigger addition)
because `merge-gate.yml` was held in a concurrent lane's file-scope lock at
the time. That prior PR is now stuck at its T1 bounce cap and `CONFLICTING`
against current `main`; per instruction this lane reimplements both fixes
cleanly from current `main` rather than resolving those conflicts. PR
#1247's CHANGES_REQUIRED verdict history is prior review record for the
carried-forward part-1 content and should be considered alongside this PR's
own review.

## Addendum: P1 privilege-boundary correction (2026-07-20)

Addendum parent SHA (ancestor of this addendum's own commit, per this repo's
proof-binding convention -- a commit cannot embed its own hash):
0b3fe1cdcaa8e8a00d99186cf604e337f36f5d16.

A P1 finding on this PR's earlier revision: `tier-label-check.yml` (as it
stood before this addendum) added `github-token: ${{ secrets.SYNC_BOT_TOKEN
}}` to the same `actions/github-script@v7` step whose `script:` content is
PR-influenced under the `pull_request` trigger. GitHub Actions executes a
`pull_request`-triggered job using the PR's OWN copy of the workflow file --
not main's -- so a malicious same-repo PR could rewrite that script to
exfiltrate or misuse the PAT before any review happened.

### Fix

Split `tier-label-check.yml` into two workflows:

- **`tier-label-check.yml`** (unchanged trigger, `pull_request`): now holds
  only the default `GITHUB_TOKEN`. It computes the label plan (read-only
  manifest lookup + diff against current labels), strictly validates every
  field against an allowlist regex (`^tier:T[123]$` for labels,
  `^(?:UTV2|UNI)-\d+$` for issue IDs), and uploads it as an artifact. It
  never mutates labels itself.
- **`tier-label-apply.yml`** (new, `workflow_run` on Tier Label Check
  completion): holds `SYNC_BOT_TOKEN`. `workflow_run` is always evaluated
  using the base branch's own copy of the workflow file, never the
  triggering PR's. This job has **no checkout step at all** -- it downloads
  only the label-plan artifact, re-validates every field independently
  (schema, PR number, head SHA, and label shape, cross-checked against
  `github.event.workflow_run.pull_requests[0]`, which GitHub populates
  server-side and a PR cannot forge), and only then calls
  `addLabels`/`removeLabel`.

`docs/05_operations/REQUIRED_SECRETS.md`'s `SYNC_BOT_TOKEN` entry updated:
`used_by` now points at `tier-label-apply.yml` (not `tier-label-check.yml`),
with the boundary rationale spelled out in the `purpose` field.

### New assertions

- [x] `tier-label-check.yml` (pull_request-triggered) never references
  `secrets.SYNC_BOT_TOKEN` anywhere, and no step in its job sets an explicit
  `github-token`
- [x] `tier-label-apply.yml` triggers only on `workflow_run` completion of
  Tier Label Check, never also on `pull_request`
- [x] `tier-label-apply.yml` has no `actions/checkout` step and never
  references `pull_request.head.sha` as a trust decision
- [x] `tier-label-apply.yml`'s label-apply step fails closed if
  `SYNC_BOT_TOKEN` is unset, and uses it with no `GITHUB_TOKEN` fallback
- [x] The apply step validates the artifact's schema, cross-checks
  `pr_number`/`head_sha` against the workflow_run event's own PR record, and
  re-validates every label against the strict tier-label allowlist
  independently of what the artifact claims
- [x] `pnpm verify` PASS (full suite, including `pnpm test:db`)
- [x] `pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts` PASS (34/34 -- 1 new net test file addition net +1 from the prior 33: one stale SYNC_BOT_TOKEN-in-pull_request assertion replaced with two new tests covering the safe split)

### Addendum evidence

```text
$ pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts
1..34
# tests 34
# suites 0
# pass 34
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 553.401392
```

```text
$ pnpm test:db
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 105780.948601
```

```text
$ pnpm verify
[verify:parallel] all checks passed
(test:live-db suites all pass, included above)
```

The live P1 thread on this PR should be resolved only after this addendum's
commit is visible on the PR and CI confirms green -- not before.

### Known gap (out of scope, not fixed by this PR)

`docs/05_operations/REQUIRED_CI_CHECKS.md`'s Merge Gate trigger prose is
still stale (missing `opened`) as of this update. An earlier commit on this
branch's history (`0b3fe1cdcaa8e8a00d99186cf604e337f36f5d16`) intended to
correct it but its diff inverted the change instead of applying it, so the
file's content is now byte-identical to current `main` and produces no diff
at all against it. Per instruction, this PR does not broaden its scope to
re-attempt that doc correction -- it is tracked here as a known, separate
follow-up rather than silently dropped.

## Update onto current main (2026-07-20)

This PR was updated once onto current protected `main` at commit
`b1a8cebdb8d268d6d26d3a47096e0d4ecc7e6e36` (merge commit of #1273, itself
downstream of #1265/#1266/#1269). The merge was clean (no conflicts) and
did not touch, broaden, or redesign the accepted P1 implementation --
`tier-label-check.yml`, `tier-label-apply.yml`, `REQUIRED_SECRETS.md`, and
`workflow-hardening.test.ts` are unchanged in substance from the addendum
above. `docs/05_operations/REQUIRED_CI_CHECKS.md` was reconciled out of
this PR's declared scope (lane manifest `files_changed`/`file_scope_lock`
and this evidence bundle's `scope.implementation_paths`), since it is
genuinely absent from `git diff origin/main...HEAD` -- it was never
actually part of this PR's real diff once corrected against current main's
own copy of the file.

New exact head after this update: see the accompanying executor-result/v1
comment's `Head SHA:` line, bound to this exact commit. Full governed
packet (verify, test:db, workflow-hardening tests) rerun and green on this
head. Any scope override or PM verdict bound to the prior head
(`da38e5099ca19b922fb9b80443035970ddfeee23`) is stale and must not be
reused -- a fresh scope override and PM verdict are required against the
new head.

## Owner boundary

T1 — merge authority and CI policy-engine configuration. Requires the
`t1-approved` label and a valid Griff-authored `pm-verdict/v1` APPROVED
comment bound to the reviewed head. This proof supplies neither; it is
implementer-side mechanical verification only.
