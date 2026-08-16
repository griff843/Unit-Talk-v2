# PROOF: UTV2-1619 — reconcile candidate filter and scheduled write path

MERGE_SHA: b58a2f3549df247d2c972bb64baf0ddb6251be43

(Pre-merge placeholder: this branch's base commit on `main`. `ops:proof-generate
--merge-sha` substitutes the SHA token in the line above with the authoritative merge
SHA after the merge, per `post-merge-lane-close.yml`. `MERGE_SHA: pending` is accepted
by the close-eligibility preflight but rejected by the Executor Result Validator, which
requires a valid git SHA — see "Gate disagreement" below.)

ASSERTIONS:
- [x] Reconcile candidates are selected from the canonical `ACTIVE_LOCK_STATUSES` allowlist, not a denylist.
- [x] An unrecognised manifest status fails closed — never a candidate, therefore never mutated.
- [x] A `merged` lane stays merged; a `done` lane stays done.
- [x] A legacy `closed` manifest is never rewritten to `blocked`.
- [x] A healthy active lane remains a candidate but is reconciled `clean` and never written.
- [x] `--issue` narrows the candidate set to exactly the named lanes.
- [x] The dry-run set on the live corpus is exactly `UTV2-1627` and `UTV2-1684`.
- [x] Both scheduled reconciler workflows can push to protected `main`.
- [x] No lifecycle state was added, removed, or redefined; no cap or parked semantic changed.
- [x] No product, runtime, migration, delivery, or domain path is touched.

EVIDENCE:

## Verification

### `pnpm verify`

Run on this branch, in this lane's worktree (not the root checkout):

```
> @unit-talk/v2@0.1.0 verify .out/worktrees/claude__utv2-1619-reconcile-filter-and-write-path
VERIFY_EXIT=1
blocks reporting a nonzero '# fail': 0
aggregate pass=4743 fail=0
```

**`pnpm verify` is `pnpm verify:static && pnpm test:live-db`. `verify:static` passed in
full; the exit-1 is `test:live-db` alone**, and it is an environment refusal rather than
a defect in this diff. The first failing line in the entire 31,070-line log is at 31067:

```
> @unit-talk/v2@0.1.0 test:live-db
> pnpm test:db && pnpm test:t1-proof:live
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL
                 (host=127.0.0.1). Writable DB verification requires
                 xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub
                 environment with CI_SUPABASE_* credentials.
```

That is the CI/staging isolation guard working as designed: writable DB verification is
not runnable from a workstation by construction. Everything before it — `ci:db-client-boundary`,
`ops:sync-check`, `ops:system-alignment-check`, `ops:automation-coverage-check`, `env:check`,
`lint`, `type-check`, `build`, all thirteen `test` suites, `@unit-talk/smart-form verify`,
and `verify:commands` — completed green. CI runs `pnpm verify` with staging credentials and
that run is authoritative.

This lane is **T2** and touches no DB path, so live-DB proof is not a tier requirement here.

### `pnpm build` then `pnpm test`, standalone

```
BUILD=0
TEST_EXIT=0
blocks reporting a nonzero '# fail': 0
aggregate pass=4629 fail=0
```

Build precedes test deliberately: an un-built worktree fails fast in `test:apps` on a
missing `packages/config/dist/env.js` and never reaches `test:ops`, which is where this
lane's tests live. Without building first the aggregate would not mean what it appears to.

### The changed unit under test

```
$ pnpm exec tsx --test scripts/ops/reconcile.test.ts
# tests 22
# pass 22
# fail 0
# skipped 0
```

15 pre-existing plus the 7 added here. The seven cover each case named in the
authorization: merged stays merged, done stays done, active untouched, legacy `closed`
never becomes `blocked`, unrecognised status fails closed, `--issue` narrows correctly,
and the dry-run set matches expectation.

One of them asserts the *consequence* rather than only the guard: it calls
`reconcileManifest` directly on a `closed` manifest and asserts that it **would** write
`blocked`. The guard is what prevents that manifest from ever reaching it. If a future
change makes the filter permissive again, that test fails loudly instead of the corruption
reappearing silently — a control is only proven by making it fail on the condition it names.

### Behavioural proof on the live corpus — before and after

Same 674 manifests, same command, dry-run, measured 2026-08-11. The "before" run is
`main`'s own unfixed `reconcile.ts` executed from the root checkout; the "after" is this
branch's worktree:

```
BEFORE (main, unfixed):   active_count=31   planned_mutations=16
AFTER  (this branch):     active_count=3    planned_mutations=2
```

The complete mutation set after the fix:

```
UTV2-1627   ghost_merged   status -> merged, commit_sha bound, locks released
UTV2-1684   ghost_merged   status -> merged, commit_sha bound, locks released
UTV2-1619   orphaned       branch deleted on remote but manifest still active  [log only]
```

Exactly the two lanes this lane is authorized to reconcile. Zero `stranded` verdicts,
zero legacy-`closed` rewrites. The `UTV2-1619` entry is this lane's own manifest observed
before its branch was pushed; `orphaned` is log-only and mutates nothing, which is why
`planned_mutations` is 2 and not 3.

The 14 mutations that disappeared were all long-terminal manifests headed for `blocked`.
`blocked` belongs to both `TOTAL_CAPACITY_STATUSES` and `TYPE_CAPACITY_STATUSES`, so the
first successful apply would have manufactured 14 live capacity consumers out of dead
history and pushed the board past its cap of 10 without a single new lane being admitted.
The write path being broken is the only reason that never happened — the two defects were
mutually concealing, and fixing the transport alone would have caused the corruption.

### R-level check (`scripts/ci/r-level-check.ts`)

```
Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff
```

### Workflow validation

Both reconciler workflows parse, and both now carry the write credential:

```
reconcile-stale-lanes.yml   YAML OK   token: ${{ secrets.SYNC_BOT_TOKEN || secrets.GITHUB_TOKEN }}
ops-reconcile.yml           YAML OK   token: ${{ secrets.SYNC_BOT_TOKEN || secrets.GITHUB_TOKEN }}
```

`ops-reconcile.yml` previously passed no `token:` at all, so its checkout used the default
`GITHUB_TOKEN` and its push died on `GH006` against protected `main` on every scheduled run.

### Coverage statement

`scripts/` is not covered by `pnpm type-check` — the root tsconfig declares project
references for `packages/` and `apps/` only. Evidence for `reconcile.ts` is `pnpm test`
(runtime, via tsx) plus lint. No static type coverage is claimed for the changed file.

### Gate disagreement found while validating this lane

Two gates evaluate the same `MERGE_SHA:` anchor on the same artifact and disagree:

- `evaluateCloseEligibilityPreflight` (CEP-E5) calls `hasBindableShaAnchor`, which tests
  only that the line is labelled. `proof-generate` separately accepts `pending` as an
  explicit provisional value — see its placeholder-value pattern — and rebinds it cleanly.
- `executor-result-validator.yml` requires the value to be a valid git SHA and rejects
  `pending` outright: `Proof MERGE_SHA is not a valid git SHA: "pending"`.

A third reader, `proof-auditor-gate.ts`, takes yet another position: it treats a
merge-SHA that does not match the audited head as an **advisory warning only**,
because "circular dependency makes exact-SHA embedding impossible at commit time".

So a proof bundle can be simultaneously "close-eligible", "not a valid executor
result", and "audited clean". This is the same duplicated-authority drift class already recorded for this
issue as capabilities 11, 15 and 19: two implementations of one rule, drifting apart.
Resolved here by using the branch base SHA — the convention prior milestones used — which
satisfies both. The underlying disagreement is **not** fixed by this lane and is out of
its declared scope; it is reported rather than silently worked around.

Observed the same way: `File scope lock` fails structurally on every milestone of a
multi-milestone issue after the first. `resolveTrustedManifests` prefers the base-branch
copy of any manifest path that exists on base, and a closed milestone leaves
`docs/06_status/lanes/UTV2-1619.json` terminal on `main`, so the next milestone's branch
resolves to "no active lane manifest". PRs #1388, #1389 and #1390 each merged with this
check red for the same reason; it is advisory, not a required context.

## Not claimed

- **Branch protection is preserved but not strengthened.** `SYNC_BOT_TOKEN` satisfies the
  "existing sanctioned pattern" requirement because `post-merge-lane-close.yml` already
  uses it. It works, however, *because* it is a repo-owner PAT that bypasses classic branch
  protection. Required checks still run on `main`; nothing was removed. But a reconciler
  that truly wrote *through* protection would open a PR rather than push. That is a larger
  design change than this authorization covers and is deliberately not attempted here.
- **The two reconciler workflows are redundant.** Both run `ops:reconcile --apply` and push
  to `main` on overlapping schedules (`0 */6 * * *` and `0 6 * * *`). Consolidating them is
  out of scope for this lane and is not done.
- No claim is made about the 12 merged-but-unclosed historical manifests. They are not
  candidates under the new filter and this lane does not touch them.
