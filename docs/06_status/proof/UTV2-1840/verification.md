# UTV2-1840 — Verification

**Lane type:** governance · **Tier:** T2 · **Executor:** claude
**Branch:** `claude/utv2-1840-work-id-branch-discipline`

## Merge SHA Binding

| Field | Value |
|---|---|
| Issue | UTV2-1840 |
| PR: | https://github.com/griff843/Unit-Talk-v2/pull/1518 |
| Execution SHA: | 0f78f3284bba06fd672f0d04fa9dec24c5d05f4f |
| Base branch | main |
| MERGE_SHA: | pending merge |

`0f78f3284` is the last non-proof commit on this branch. Everything after it touches only
`docs/06_status/proof/UTV2-1840/` and `docs/06_status/lanes/UTV2-1840.json`.

## Summary

`scripts/ops/branch-discipline-guard.ts` kept a private copy of the work-identifier alternation
that was never widened when `WORK-###` was minted, so `ops:preflight` PX2 refused a repo-minted
identifier and no `WORK-###` lane could open. Both patterns now derive from a single exported
`ISSUE_ID_NAMESPACES` list in `shared.ts`, with eight tests and a mutation control.

## Verification

`pnpm verify` was run in the lane worktree at the execution SHA. `pnpm type-check` and `pnpm test`
both run inside it, so the figures below are from that single run.

### `pnpm verify` — exit 1, and not because anything failed

Every stage passed — `ci:db-client-boundary`, `ops:sync-check`, `ops:system-alignment-check`,
`ops:automation-coverage-check`, `env:check`, `lint`, `type-check`, `build`, `test`, the smart-form
filter, and `verify:commands`. The run then reached `test:live-db` → `test:db` →
`ci:assert-staging`, which refused:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub
environment with CI_SUPABASE_* credentials.
```

This is structural: `pnpm verify` cannot exit 0 on any developer machine, because its last stage
demands the staging-ci Supabase target by project ref. **No local PASS is claimed.** The required
`verify` check on this PR, which runs inside staging-ci, is the authoritative result.

Test totals from that run:

```text
101 suite blocks
# tests 6091
# fail  0
`not ok` lines: 0
```

`pnpm type-check` (`tsc -b tsconfig.json`) exits 0.

### `ops:automation-coverage-check` — PASS, and it did not start that way

```text
[automation-coverage] verdict=PASS fail=0 warn=1 classified=15
[executable-wiring] verdict=PASS required_roots=verify
[executable-wiring] tests total=500 required-reachable=341 unwired=119 (baselined=119, new=0)
```

The first run of this lane's `pnpm verify` failed here with `WIRING_TEST_UNWIRED_NEW`; see A5b.

## Assertions

**A1 — The defect is real and was measured, not inferred.** On unpatched `main` (`fd18b486c`), a
credential-free `ops:preflight` for a repo-minted `WORK-902` identifier reported:

```text
verdict: INFRA
PE2 skip :: no tracker credential; tracker checks are optional and non-blocking.
            Declared --tier T3 satisfies the mechanical floor T3.
PL1 skip :: PL1 skipped: no tracker credential
PX2 fail :: pnpm ops:branch-discipline -- --branch claude/work-902-tracker-independence-proof
            --title WORK-902 --commits  failed: Branch discipline FAILED: PR branch
            "claude/work-902-tracker-i…
```

Every tracker check correctly skipped. `PX2` — the branch-discipline guard — refused. `ops:lane-start`
refuses without a validated preflight token, so this is a hard block on opening the lane.

**A2 — The same command, same environment, with only this lane's patch applied, passes.**

```text
verdict: INFRA
PE2 skip :: no tracker credential; tracker checks are optional and non-blocking.
            Declared --tier T3 satisfies the mechanical floor T3.
PL1 skip :: PL1 skipped: no tracker credential
PX2 pass :: branch and commit issue references are disciplined
```

**A3 — The probe environment was genuinely credential-free, not merely `env -u`-stripped.**
`loadEnvironment(rootDir)` (`packages/config/src/env.ts:175-178`) reads `local.env` from the repo
root, so unsetting `LINEAR_API_KEY`/`LINEAR_API_TOKEN` in the parent process does **not** remove the
credential. The probe ran from a git worktree, which does not carry `local.env` (it is gitignored),
with both variables also unset.

**A4 — The `INFRA` verdict in both runs is the probe's own artifact and is honestly reported here.**
It is caused by `PE1 infra_error :: Neither local.env nor .env exists at repo root`, which cascades
to `PX1`, `PB1` and `PB2` failing on `Missing env file: local.env`, plus `PG2 fail` because the
patch was applied to a dirty tree in the A/B run. **No claim is made that a lane can be opened from
a fully credential-free environment** — `local.env` carries Supabase and other non-tracker
credentials, and that dependency is out of scope for the ratified tracker correction. What A1/A2
isolate is the *tracker* dependency: identical environment, identical failures elsewhere, `PX2` the
only check whose result changes.

**A5 — The new tests genuinely constrain the repair (mutation).** Reverting
`branch-discipline-guard.ts:19` to its own pre-`WORK` alternation
(`/\b(?:UTV2|UNI)-\d+\b/gi`) and rerunning `scripts/ops/shared.test.ts` in place:

```text
# Mutation — restore the guard's private pre-WORK alternation
not ok 94  - UTV2-1840: the guard scans for exactly the namespaces shared.ts mints
not ok 95  - UTV2-1840: WORK-### is admitted end to end, the case tracker independence exists for
not ok 97  - UTV2-1840: a cross-issue reference is still refused on a WORK-### branch
not ok 98  - UTV2-1840: a branch naming two work identifiers is still refused
not ok 100 - UTV2-1840: evaluateIssueReferences still rejects text naming two issues
# tests 101 / # pass 96 / # fail 5

# Restored
# tests 101 / # pass 101 / # fail 0
```

**A5b — Why the tests live in `shared.test.ts` rather than a `branch-discipline-guard.test.ts`.**
They were written as a separate file first. `pnpm verify` then failed closed:

```text
[FAIL] WIRING_TEST_UNWIRED_NEW scripts/ops/branch-discipline-guard.test.ts - test file is not
reachable from any package script or workflow command and is not in the reviewed wiring baseline
```

The only wiring point is the `test:ops` script in `package.json`, which is **outside this lane's
`file_scope_lock`** — and a lock is pinned at lane-start and cannot be widened by an agent. The
alternative offered by the check, a reviewed baseline entry, would have meant the new tests never
run in CI, which defeats their purpose. They were therefore moved into the already-wired
`scripts/ops/shared.test.ts`, where the contract under test — that module's exported namespace list
— actually lives. The mutation above was re-run in the new location; it still kills five tests.
The underlying trap is recorded in `docs/mission/plan.md`.

**A6 — Widening the namespace weakened no protection the guard actually provides.** Run against the
patched CLI:

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

A branch with no identifier, a cross-issue reference, and a branch naming two identifiers are each
still refused. `dependabot/` branches still take the exempt path (test 6).

**A7 — Regression.** `scripts/ops/shared.test.ts` (now 101 tests, including the eight added here)
and `scripts/ops/workflow-hardening.test.ts`, the two suites covering the changed export surface,
run `# fail 0`. The full `pnpm test` result is above.

**A8 — The duplication on the lane-open path is removed, not copied — and 22 other sites remain.**
`branch-discipline-guard.ts` now imports `issueIdScanPattern()` from `shared.ts`, and both patterns
are built from the single exported `ISSUE_ID_NAMESPACES` list. It is **not** true that no other copy
exists: `grep -rn "UTV2|UNI" scripts/ .github/` still returns 22 sites. They were read rather than
counted, and they are not equivalent:

| Class | Count | Sites |
|---|---|---|
| Deliberately narrow and correct | 1 | `shared.ts:415` `TRACKER_REF_PATTERN` — a tracker key *is* a Linear id; `WORK-###` is documented as deliberately not one |
| Hard refusal of a `WORK-###` lane after it opens | 2 | `executor-result-validate.ts:109` (`Invalid Issue ID … Must match UTV2-NNN or UNI-NNN`, and ERV is a required check); `proof-rebind.ts:1652` (`proof_rebind_refused` — a path-traversal guard on a directory segment) |
| Soft degradation | 2 | `proof-schema.ts:326` → `unverified`; `proof-binding-validator.ts:150` → null binding context |
| Discovery / reconciliation, non-blocking | 5 | `queue-lib.mjs:20,139`, `lane-maximizer.ts:787,845`, `orchestration-reconciler.ts:1023,1785`, `truth-check-lib.ts:2078,2613` |
| **RESERVED — deliberately untouched** | 7 | `merge-gate.yml:244`, `executor-result-validator.yml:206`, `p0-protocol.yml:53`, `tier-label-check.yml:38,119`, `tier-label-apply.yml:90`, `merge-gate-verdict.cjs:30` |

This lane moves a `WORK-###` task from *cannot start* to *cannot finish*. That is the accurate
claim, and `docs/mission/plan.md` records it in those terms.

**A9 — No reserved surface was touched.** No change to `.github/workflows/merge-gate.yml`,
`p0-protocol.yml`, `executor-result-validator.yml`, CODEOWNERS, branch protection, or any tier or
approval policy. Items 8–11 of the cutover change set remain RESERVED and unimplemented.

**A10 — This lane does not close the cutover.** It closes exit condition 1 only. Exit conditions 4
and 5 remain undemonstrated, and `truth-check` L1/L3/L4/C1/C7 still hard-depend on the tracker for
any lane that carries a tracker ref. `docs/mission/plan.md` records the measured state of all five.

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
```
