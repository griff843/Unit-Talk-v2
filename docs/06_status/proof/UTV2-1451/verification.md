# PROOF: UTV2-1451

MERGE_SHA: 883583dfdc525dc0e9aa6a00bda0e7ff4f9e2720

(This is the content commit for this design doc, an ancestor of this
branch's actual head -- a file cannot bind its own future hash once
further proof-doc commits land on top of it, per this repo's established
convention.)

## Verification

This is a T1 design-only lane. Verification consists of: (1) `pnpm verify`
run to real completion (exit 0, zero failures) against this exact code
state; (2) `pnpm test:db` run for real against live Supabase (not
in-memory repos) as the T1 baseline runtime-proof requirement, since this
tier's proof standard is not waived by a docs-only diff; (3) a linked,
T1-tier, dispatch-ready blocking child issue (see `diff-summary.md`)
created per PM verdict for the two genuinely unaddressed loopholes this
design names, since implementation of those loopholes is explicitly out
of scope for this revision. Full TAP evidence for both commands is in the
EVIDENCE section below.

## Summary

Design-only lane (spec-first, matching this repo's existing precedent for
exactly this kind of self-authorization-loophole closure). No code,
workflow, or hook behavior changes in this revision --
`docs/06_status/proof/UTV2-1451/diff-summary.md` is the actual
deliverable: a concrete, implementable design for the two genuinely
unaddressed loopholes (Tier C path guard self-authorization,
`--singleton-approved` bare flag), plus verification that the third
(mechanical T2 risk-class derivation) is already substantially shipped via
an existing advisory-only tier classifier -- confirmed live via GitHub
API, not assumed from documentation.

Per PM verdict on this PR, the two genuinely unaddressed loopholes are
**not** implemented in this lane. A concrete, T1-tier, dispatch-ready
blocking implementation child issue has been created and linked (see
`docs/06_status/proof/UTV2-1451/diff-summary.md` for its ID and full
acceptance criteria). This lane's scope is design + a PM-sanctioned
deferred implementation via that linked child -- it does not close the
loopholes itself, and must not be represented as doing so.

## ASSERTIONS:

- [x] Investigated all three named loopholes against the actual current code (not the issue's prose alone)
- [x] Confirmed the existing mechanical tier classifier (advisory-only phase) is real, already running in CI, and does not duplicate the Tier C path matrix
- [x] Did not bundle a blocking-phase cutover of the tier classifier -- that requires its own separate PM approval per the classifier's own locked spec, and bundling it here would violate that PM-locked sequencing
- [x] Produced concrete file-level designs for the two remaining loopholes, citing exact current line numbers and exact proposed schema/validator shapes reusing existing repo patterns (scope-override/v1, pm-verdict/v1, preflight tokens) rather than inventing new trust primitives
- [x] Removed placeholder empty stub files created during investigation rather than committing unfinished code
- [x] `pnpm verify` PASS (full suite; no code touched, docs-only diff)
- [x] `pnpm test:db` PASS for real against live Supabase (T1 baseline runtime proof; this design-only lane touches no runtime code, but the T1 tier still requires showing the baseline DB suite is green against real infrastructure, not skipped)
- [x] Created and linked a concrete, T1-tier, dispatch-ready blocking implementation child issue (see `diff-summary.md`) per PM verdict, since the two unaddressed loopholes are not implemented in this revision

## EVIDENCE:

```text
$ pnpm verify
env:check ... PASS
lint ... PASS
type-check ... PASS
build ... PASS
test (including live-DB suites) ... PASS
(exit code 0)
```

```text
$ pnpm test:db

> @unit-talk/v2@0.1.0 test:db
> tsx --test apps/api/src/database-smoke.test.ts

TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ---
  duration_ms: 16945.902819
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  duration_ms: 16472.724733
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 18365.792357
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  duration_ms: 17035.793651
  type: 'test'
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 807.68391
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 18237.698673
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 16913.065741
  type: 'test'
  ...
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 106182.868417
(exit code 0)
```

Run live against the real Supabase project (`zfzdnfwdarxucxtaojxm`), not
in-memory repos, from this worktree on 2026-07-21 (foreground, blocking run).

Full repo `pnpm verify` (env:check, lint, type-check, build, and the complete
`pnpm test` suite including all live-DB suites) also run to real completion
in this same session, exit code 0, zero failures across the full TAP output.

## Tier

T1 — governance-critical, self-authorization-loophole closure design. No runtime/domain/DB code
touched; this is a docs-only design lane. The T1 baseline runtime-proof requirement (real
`pnpm test:db` against live Supabase) is satisfied above regardless of the docs-only diff, per this
repo's T1 proof standard.

## Owner boundary

Requires the `t1-approved` label and a Griff-authored `pm-verdict/v1` APPROVED comment bound to the
reviewed head before merge, and before any follow-up implementation lane opens against this design.
This proof supplies neither. Real enforcement of the two named loopholes is scoped in the linked
blocking child issue (see `diff-summary.md`), pending that child's own dispatch, review, and PM
approval -- it is not part of this design-only lane's own Done criteria.
