# UTV2-1827 — diff summary

**Issue:** UTV2-1827 — governed staging proof runner
**Branch:** `claude/utv2-1827-governed-staging-proof-runner`
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1505
**Anchor (`verified_source_sha`):** `2d34269ffe6a74a934bf68ea4d6433ea68932bd1`
MERGE_SHA: pending merge

## Files changed

| File | Δ | What it is |
|---|---|---|
| `scripts/ci/staging-proof-commands.ts` | +108 | the allowlist registry: two admitted keys, a frozen table, and an exact-match resolver |
| `scripts/ci/run-staging-proof-command.ts` | +287 | the runner: `admit()` and `admitRef()` (both pure) separated from the spawn, refusal exit 78, receipt + dispatch-identity emission |
| `scripts/ci/staging-proof-commands.test.ts` | +129 | 22 registry-boundary tests, including a 14-entry rejected-key table |
| `scripts/ci/run-staging-proof-command.test.ts` | +217 | 22 tests: `admit()` and `admitRef()` refusal paths with no DB/network/credential, plus workflow-shape assertions |
| `.github/workflows/staging-proof-runner.yml` | +204 | `workflow_dispatch` job bound to `staging-ci`; `command_key` a closed `type: choice` list; full-history checkout for the ancestry check |
| `docs/06_status/lanes/UTV2-1827.json` | +44 | lane manifest (created by `ops:lane-start`) |
| `.ops/sync/UTV2-1827.yml` | +108 | lane sync metadata (created by `ops:lane-start`) |
| `package.json` | +1/-1 | appends the two lane suites to `test:ops`, so `verify` reaches them |

One existing file is modified — `package.json`, and only its `test:ops` line. Every other path in
this PR is new. `package.json` is outside this lane's `file_scope_lock`, which is pinned to the
lane-start commit and cannot be widened by an agent, so this PR requires an authorized
`scope-override/v1` for that single path. It is requested against a head that already contains the
change, so one human action binds a head that will not move.

Without the wiring, `executable-wiring` fails `verify` with `WIRING_TEST_UNWIRED_NEW` for both
suites. With it: `[executable-wiring] verdict=PASS required_roots=verify`, required-reachable
326 -> 327, new-unwired 2 -> 0.

## What behaviour changes

Nothing that runs today changes. `ci.yml`, `staging-db-proof.yml`, `proof-gate.yml` and
`t1-proof-gate.yml` are untouched, and the new workflow is `workflow_dispatch`-only, so no
existing trigger reaches it. The diff adds a capability; it removes and alters none.

## What it adds

A lane whose proof is a lane-owned script previously had two options: get its command added to a
shared Tier C workflow, or go without a receipt. This PR adds a third — dispatch a key that the
repository already admits.

The security-relevant property is that the dispatch input is a **key**, not a command.
`resolveStagingProofCommand()` matches the key exactly against a frozen table and throws otherwise;
`main()` then spawns *the registry's* argv with `shell: false`. Nothing supplied at dispatch time is
interpolated into a command line, so there is no injection point that a filter would have to catch.

## The ref gate

The registry is only as trustworthy as the commit it is read from. Without a ref restriction, a
dispatcher who can push a branch could rewrite `staging-proof-commands.ts` on that branch and
dispatch it — the registry would still be consulted, it would just be theirs. `admitRef()` therefore
refuses unless the checked-out commit is reachable from the default branch, and refuses "cannot
tell" (shallow clone, missing remote ref, git failure) rather than assuming it. `readRefFacts()`
treats only git exit 0 and 1 as answers; anything else is indeterminate. This is what the issue's
requirement 6 calls an unapproved ref.

## Dispatch identity

`staging-proof-dispatch/v1` is written beside the receipt and uploaded with it: command key and
argv, declared `writes`, requested ref, resolved commit, ancestry verdict, actor and triggering
actor, run id and attempt, observed project ref, timings, exit status, and the receipt's own
`receipt_sha256`. The shared `ci-db-proof-receipt/v2` schema carries all of that except the actor,
and widening a structure four other workflows already verify was the wrong way to add one field.

## Reused rather than reimplemented

`assertStagingTarget` (`scripts/ci/assert-staging-target.ts`), `collectEffectiveEnv`
(`scripts/ci/required-db-smoke.ts`) and `buildCiProofReceipt`
(`scripts/ci/isolated-proof-attestation.ts`) are imported, not copied. The staging refusal and the
receipt format are therefore the same ones `staging-db-proof.yml` already relies on, and a future
correction to either lands in one place.

## Deliberate exclusion

UTV2-1771 is **not** admitted to the registry. Its partition-preservation command requires a
superuser `SUPABASE_DB_URL`, which is strictly broader than the project-scoped `CI_SUPABASE_*` keys
this runner releases. `staging-proof-commands.test.ts` asserts that no admitted command carries
`issue: 'UTV2-1771'`, so admitting it later is a deliberate reviewed act rather than an unnoticed
widening of secret authority.
