# PROOF: UTV2-1840

MERGE_SHA: pending merge
Execution SHA: 0f78f3284bba06fd672f0d04fa9dec24c5d05f4f

Derive branch-discipline identifiers from one shared namespace list, so a repo-minted `WORK-###`
work identity can open a lane without a tracker.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1518

`sha_binding.merge_sha` is `null` pre-merge. `verified_source_sha` is
`0f78f3284bba06fd672f0d04fa9dec24c5d05f4f`, the last non-proof commit on the branch; everything
after it touches only `docs/06_status/proof/UTV2-1840/` and `docs/06_status/lanes/UTV2-1840.json`.
The binding is written after merge by `ops:proof-generate --merge-sha`; no manual append is made
here.

## Summary

`scripts/ops/branch-discipline-guard.ts` kept a private copy of the work-identifier alternation that
was never widened when `WORK-###` was minted. `ops:preflight` runs that guard as **PX2**, and
`ops:lane-start` refuses without a validated preflight token — so a repo-minted identifier could not
open a lane at all, even though every Linear check correctly reported `skip`. The tracker was
optional; its *identifier* was still mandatory.

Both patterns now derive from a single exported `ISSUE_ID_NAMESPACES` list in `shared.ts`, with
eight tests and a mutation control. Lane type governance, tier T2, executor claude.

## Verification

`pnpm verify` was run in the lane worktree at the execution SHA. `pnpm type-check` and `pnpm test`
both run inside it, so the figures below come from that single run.

ASSERTIONS:

- [x] **A1 — The defect is real and was measured, not inferred.** On unpatched `main` (`fd18b486c`),
  a credential-free `ops:preflight` for a repo-minted `WORK-902` reported `PE2 skip`, `PL1 skip` —
  every tracker check correctly optional — and then **`PX2 fail`**, refusing the branch. Because
  `lane-start` refuses without a validated preflight token, that is a hard block on opening the lane.
- [x] **A2 — The same command, same environment, with only this lane's patch applied, passes**:
  `PE2 skip`, `PL1 skip`, **`PX2 pass — branch and commit issue references are disciplined`**.
- [x] **A3 — The probe environment was genuinely credential-free, not merely `env -u`-stripped.**
  `loadEnvironment(rootDir)` (`packages/config/src/env.ts:175-178`) reads `local.env` from the repo
  root, so unsetting `LINEAR_API_KEY`/`LINEAR_API_TOKEN` in the parent process does not remove the
  credential. The probe ran from a git worktree, which does not carry `local.env` (gitignored), with
  both variables also unset.
- [x] **A4 — The `INFRA` verdict in both runs is the probe's own artifact and is disclosed, not
  hidden.** It comes from `PE1 infra_error :: Neither local.env nor .env exists at repo root`,
  cascading to `PX1`/`PB1`/`PB2` on `Missing env file: local.env`, plus `PG2` on the deliberately
  dirty A/B tree. **No claim is made that a lane can be opened from a fully credential-free
  environment** — `local.env` carries Supabase and other non-tracker credentials, out of scope for
  the ratified tracker correction. What A1/A2 isolate is the *tracker* dependency: identical
  environment, identical failures elsewhere, `PX2` the only check whose result changes.
- [x] **A5 — The new tests genuinely constrain the repair.** Reverting the guard to its own
  pre-`WORK` alternation fails 5 of the 8; restoring it returns 101/101. Full output under EVIDENCE.
- [x] **A5b — The tests live in `shared.test.ts` for a mechanical reason, not a stylistic one.** A
  separate `branch-discipline-guard.test.ts` was written first and `pnpm verify` failed closed on it
  with `WIRING_TEST_UNWIRED_NEW`. The only wiring point is `package.json`'s `test:ops`, outside this
  lane's `file_scope_lock`, which is pinned at lane-start and not widenable by an agent. The check's
  other option — a reviewed wiring baseline entry — would have meant the tests never run in CI. The
  mutation control was re-run in the new location rather than assumed to transfer.
- [x] **A6 — Widening the namespace weakened no protection the guard actually provides.** A branch
  with no identifier, a cross-issue reference, and a branch naming two identifiers are each still
  refused; `dependabot/` still takes the exempt path. Outputs under EVIDENCE.
- [x] **A7 — Regression.** `scripts/ops/shared.test.ts` (101 tests, including the eight added here)
  and `scripts/ops/workflow-hardening.test.ts` both report `# fail 0`.
- [x] **A8 — The duplication is removed on the lane-open path, and 22 other sites remain — measured,
  not assumed.** `grep -rn "UTV2|UNI" scripts/ .github/` returns 22. One is deliberately narrow and
  correct (`shared.ts:415` `TRACKER_REF_PATTERN` — a tracker key *is* a Linear id). **Two would
  hard-refuse a `WORK-###` lane after it opens**: `executor-result-validate.ts:109` (`Invalid Issue
  ID … Must match UTV2-NNN or UNI-NNN`, and ERV is a required check) and `proof-rebind.ts:1652`
  (`proof_rebind_refused` — a path-traversal guard on a value used as a directory segment, so widen
  it carefully rather than relax it). Two degrade softly (`proof-schema.ts:326` → `unverified`;
  `proof-binding-validator.ts:150` → null binding context). Five are non-blocking discovery. Seven
  are RESERVED workflow surfaces (`merge-gate.yml`, `executor-result-validator.yml`,
  `p0-protocol.yml`, `tier-label-check.yml`, `tier-label-apply.yml`, `merge-gate-verdict.cjs`),
  cutover items 8–11, deliberately untouched.
- [x] **A9 — No reserved surface was touched.** `git diff origin/main --name-only -- .github/` is
  empty. No change to merge authority, the merge gate, its policy inputs, CODEOWNERS, branch
  protection, tiers, or approval policy.
- [x] **A10 — This lane does not close the cutover, and says so.** It moves a `WORK-###` task from
  *cannot start* to *cannot finish*: exit condition 1 is **advanced, not closed**. Exit conditions 4
  and 5 remain undemonstrated, and `truth-check` L1/L3/L4/C1/C7 still hard-depend on the tracker for
  any lane that carries a tracker ref. `docs/mission/plan.md` records all five in those terms.

EVIDENCE:

r-level-check: `scripts/ci/r-level-check.ts` was run locally at this anchor and also runs in CI on
this branch as `R-Level Compliance Check` (reported `pass`). Local output:

```text
Verdict: PASS
Changed files: 10
Rules matched: (none) — no R-level artifacts required for this diff
```

This diff touches ops scripts, their tests, and docs only, so no R-level artifact beyond the diff
summary and this verification log is required, and none is claimed.

**`pnpm verify` — exit 1, and not because anything failed.** Every stage passed:
`ci:db-client-boundary`, `ops:sync-check`, `ops:system-alignment-check`,
`ops:automation-coverage-check`, `env:check`, `lint`, `type-check`, `build`, `test`, the smart-form
filter, and `verify:commands`. The run then reached `test:live-db` → `test:db` →
`ci:assert-staging`, which refused:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub
environment with CI_SUPABASE_* credentials.
```

This is structural — `pnpm verify` cannot exit 0 on any developer machine. **No local PASS is
claimed.** The required `verify` check on this PR, which runs inside staging-ci, is the
authoritative result. Test totals from that run:

```text
101 suite blocks
# tests 6091
# fail  0
`not ok` lines: 0
```

`pnpm type-check` (`tsc -b tsconfig.json`) exits 0.

**`ops:automation-coverage-check` — PASS, and it did not start that way.**

```text
[automation-coverage] verdict=PASS fail=0 warn=1 classified=15
[executable-wiring] verdict=PASS required_roots=verify
[executable-wiring] tests total=500 required-reachable=341 unwired=119 (baselined=119, new=0)
```

The first run failed here with
`[FAIL] WIRING_TEST_UNWIRED_NEW scripts/ops/branch-discipline-guard.test.ts`; see A5b.

**Defect reproduction, A/B.** Same command, same credential-free worktree:

```text
$ env -u LINEAR_API_KEY -u LINEAR_API_TOKEN pnpm ops:preflight WORK-902 --tier T3 \
    --branch claude/work-902-tracker-independence-proof \
    --files 'docs/06_status/CURRENT_STATE.md' --json

# unpatched main fd18b486c
PE2 skip :: no tracker credential; tracker checks are optional and non-blocking.
            Declared --tier T3 satisfies the mechanical floor T3.
PL1 skip :: PL1 skipped: no tracker credential
PX2 fail :: Branch discipline FAILED: PR branch "claude/work-902-tracker-i…"

# with this lane's patch applied
PE2 skip :: no tracker credential; tracker checks are optional and non-blocking.
            Declared --tier T3 satisfies the mechanical floor T3.
PL1 skip :: PL1 skipped: no tracker credential
PX2 pass :: branch and commit issue references are disciplined
```

**Mutation control.** Revert `branch-discipline-guard.ts:19` to `/\b(?:UTV2|UNI)-\d+\b/gi`, run the
owning suite, restore byte-for-byte:

```text
not ok 94  - UTV2-1840: the guard scans for exactly the namespaces shared.ts mints
not ok 95  - UTV2-1840: WORK-### is admitted end to end, the case tracker independence exists for
not ok 97  - UTV2-1840: a cross-issue reference is still refused on a WORK-### branch
not ok 98  - UTV2-1840: a branch naming two work identifiers is still refused
not ok 100 - UTV2-1840: evaluateIssueReferences still rejects text naming two issues
# tests 101 / # pass 96 / # fail 5

# restored
# tests 101 / # pass 101 / # fail 0
```

The two controls the mutation does not kill (the no-identifier refusal and the `dependabot/`
exemption) are not weakened by it and are not expected to fail; they exist to catch the opposite
error, a widening that stops refusing.

**Controls, run against the patched CLI.**

```text
Branch discipline FAILED: PR branch "claude/no-id-here" must include exactly one UTV2-###,
                          UNI-### or WORK-### issue ID
Branch discipline FAILED: All PR issue references must match branch issue WORK-901;
                          found UTV2-1224, WORK-901
Branch discipline FAILED: PR branch "claude/work-901-and-utv2-1838" references multiple
                          issue IDs: UTV2-1838, WORK-901
Branch discipline OK: single_issue_reference      (claude/work-901-demo, WORK-901)
Branch discipline OK: single_issue_reference      (claude/utv2-1838-x, UTV2-1838)
```

## Commands run

```bash
pnpm verify
pnpm type-check
pnpm test
pnpm exec tsx --test scripts/ops/shared.test.ts scripts/ops/workflow-hardening.test.ts
env -u LINEAR_API_KEY -u LINEAR_API_TOKEN pnpm ops:preflight WORK-902 --tier T3 \
  --branch claude/work-902-tracker-independence-proof \
  --files 'docs/06_status/CURRENT_STATE.md' --json
pnpm ops:branch-discipline -- --branch <branch> --title <title> --commits <commits>
grep -rn "UTV2|UNI" scripts/ .github/
git diff origin/main --name-only -- .github/
pnpm exec tsx scripts/ci/r-level-check.ts
```
