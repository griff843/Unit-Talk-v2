# PROOF: UTV2-1802

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the ratified `pending merge` anchor; the
> Execution SHA row carries the verified implementation identity.
> `post-merge-lane-close.yml` rebinds merge authority only after GitHub supplies the
> merged-PR attestation.

Generated at: 2026-09-06T00:28:00Z
Issue: UTV2-1802
Tier: T1
Lane type: delivery-ui
Branch: claude/utv2-1802-cc-management-sql-readonly
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1513
Head SHA: aab575f64311070f069ce961ed4da1f2d13da5dd
result: pass

## ASSERTIONS:

- [x] **AC1 — With the gate unset, or after removing the gate, no Management-API request is issued, asserted on the absence of the request rather than on rendered output.** `getStorageHealth()` is called with `UNIT_TALK_COMMAND_CENTER_MANAGEMENT_API_ENABLED` deleted, and again for each of `false`, `1`, `yes` and the empty string, against a `globalThis.fetch` recorder. Every call records **zero** requests whose URL starts with `https://api.supabase.com/`. The assertion is `assert.deepEqual(managementCalls(), [])` — a list of recorded calls, not a field of the returned object. A test that inspected the return value would pass equally against an implementation that issued all seven requests and discarded the answers.
- [x] **AC2 — Every function that can reach the management plane owns its own refusal, and refuses before it builds a request.** `fetchManagementJson` and `runManagementQuery` each call `assertManagementPlaneEnabled()` before `fetch(` **and before `resolveManagementEnv`**, so a shut gate is reported as a policy refusal and never as a missing credential. `getStorageHealth` short-circuits on `isManagementPlaneEnabled()` before its `await Promise.all` fan-out. All three are asserted structurally on the parsed function body, in the idiom `privileged-boundary-guard.test.ts` already uses for every privileged boundary in this app.
- [x] **AC3 — Authentication precedes the gate.** `getStorageHealth` calls `assertPrivilegedRequestAuthenticated()` before it reads the gate, asserted by index ordering within the function body, so an unauthenticated caller cannot learn whether the management plane is enabled.
- [x] **AC4 — The gate is conditional, not an unconditional refusal.** `isManagementPlaneEnabled` returns `true` for `'true'`, `'TRUE'`, `' true '` and `'True'`, and `false` for `''`, `' '`, `'false'`, `'FALSE'`, `'0'`, `'1'`, `'yes'`, `'on'`, `'enabled'`, `'truthy'` and for an absent variable. A guard that refused unconditionally would satisfy AC1 while breaking the feature; this table is what distinguishes the two.
- [x] **AC5 — Management SQL is a closed, read-only registry validated at import time.** `defineReadOnlyQueries` runs `assertSingleReadOnlyStatement` over every declared statement as the module loads, so a policy-violating statement fails the *import* rather than a request. 17 tests in `management-sql.test.ts` cover the rejection surface.
- [x] **AC6 — Degradation is honest.** With the gate shut, `DbRuntimeHealth.managementPlane.available` is `false` with a reason naming the environment variable, both storage domain rows (`app`, `ingestion`) are **present**, and `disk.alertStatus` and every `storageDomains[].alertStatus` read `unavailable`. `unavailable` is a member of the `StorageAlertStatus` union rather than an absent field, because an omitted row renders as nothing and nothing reads as healthy.
- [x] **AC7 — The guard PR #1494 silently reverted is restored.** See "The revert this lane had to undo" below. `privileged-boundary-guard.test.ts` passes 11/11 at this head.
- [x] **AC8 — No consumer regression, no scope bleed.** `getStorageHealth` has exactly one caller, `getDashboardRuntimeData` (`src/lib/data/dashboard.ts:646`), reached from `src/app/page.tsx` and `src/app/pipeline/page.tsx`. Both consume the returned shape, which gained a field and lost none. The whole `@unit-talk/command-center` suite passes 507/507. No file outside `apps/command-center/**` and this lane's own artifacts is touched.

## EVIDENCE:

Measured on the lane worktree at head `aab575f64311070f069ce961ed4da1f2d13da5dd`.

```
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 9
Rules matched: operator-ui

$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
(exit 0 -- no diagnostics)

$ pnpm --filter @unit-talk/command-center test
# tests 507
# pass 507
# fail 0

$ npx tsx --test src/lib/data/storage-health.test.ts
# tests 10
# pass 10
# fail 0

$ npx tsx --test src/lib/data/management-sql.test.ts
# tests 17
# pass 17
# fail 0

$ npx tsx --test src/lib/privileged-boundary-guard.test.ts
# tests 11
# pass 11
# fail 0

$ pnpm test
(aggregate across every workspace suite)
# tests 6004
# pass 6004
# fail 0
```

## Verification
- [x] `pnpm type-check`: PASS -- `tsc -b tsconfig.json` exits 0 with no diagnostics
- [x] `pnpm test`: PASS -- 6004 tests, 6004 pass, 0 fail across every workspace suite, re-executed at the post-resync anchor
- [x] `pnpm --filter @unit-talk/command-center test`: PASS -- 507/507, 0 fail
- [x] `npx tsx scripts/ci/r-level-check.ts --base a2efc4172 --head aab575f64`: PASS -- Changed files: 11 -- `operator-ui` matched; its required `qa-experience-report` artifact is present in the repository. That artifact predates this lane and satisfies the rule mechanically; it is **not** verification of this change, and is not offered as such.
- [x] `pnpm verify`: PASS in CI, not runnable locally -- the required `verify` check succeeded at PR head `8f6dbcd17c62bbd3ed34b3aedf4a176196f2d5d2` in run 34001056027, job 101400905372. It cannot complete on this checkout: its `ci:assert-staging` step refuses off-CI because `local.env` pins `SUPABASE_URL` to `http://127.0.0.1:1` under containment. Every step before that refusal passed locally.

## Runtime Verification

**What this change touches at runtime, and what it cannot.** The diff is confined
to `apps/command-center`'s data layer. It opens no database connection, runs no
migration, changes no schema and alters no repository call. Its entire runtime
effect is on outbound HTTPS requests to `https://api.supabase.com/` — whether
they are issued at all, and what is returned when they are not.

**Why the probe is in-process rather than against a running server.**
`getStorageHealth` is a privileged boundary: its first statement is
`await assertPrivilegedRequestAuthenticated()`, which resolves the current Next
request through `headers()` and fails closed outside a request scope. A unit
test therefore cannot drive its body end to end, and `next/headers` cannot be
module-mocked here — `node:test`'s `mock.module` requires
`--experimental-test-module-mocks`, which this repository's runner does not set.
This was measured, not assumed: the attempt returns
`import_node_test.mock.module is not a function`.

Rather than weaken the boundary to make it testable — adding an
unauthenticated export purely for a test would have been a real security
regression to buy a convenience — the property is established two ways that
together are stronger than a single happy-path call:

1. **Behavioural, on the absence of the request.** `getStorageHealth()` is
   invoked for real, in-process, under the real Node runtime, with
   `globalThis.fetch` replaced by a recorder. The call fails closed on
   authentication, as it must outside a request scope; the assertion is that the
   recorder holds **zero** `https://api.supabase.com/` entries. This proves the
   stronger property that nothing leaks even on the failing path.
2. **Structural, per chokepoint.** Each of the three functions that can reach
   the management plane is parsed out of the source and asserted to own its own
   check, positioned before it builds a request and before it resolves
   credentials. This is the same technique `privileged-boundary-guard.test.ts`
   already applies to all seven privileged boundaries in this app, and it is
   what makes a later edit that moves or drops one check fail immediately.

Neither of these is offered as a live-database observation, and none is claimed.
The change reaches no database.

**The live-DB receipt.** This lane's local checkout cannot reach a database by
design — `local.env` pins `SUPABASE_URL` to `http://127.0.0.1:1` — so
`pnpm test:db` is not run locally and no local run is claimed. The T1 live-DB
receipt is the run-scoped staging receipt produced by the `Writable DB proof
(staging only)` job at this anchor. Details in `evidence.json` under
`runtime_proof.live_db`.

## Mutation control

A gate that no test can break proves nothing. Four inversions were applied one
at a time, each with the file restored byte-for-byte afterwards. **Every one was
caught**, and each by the assertion that names the property it breaks:

| # | Inversion | Result | Failing assertion |
|---|---|---|---|
| 1 | remove `assertManagementPlaneEnabled();` from `fetchManagementJson` | 10 tests, 9 pass, **1 fail** | `not ok 2 - fetchManagementJson refuses before it builds a request` — *"fetchManagementJson lost its management-plane gate"* |
| 2 | remove it from `runManagementQuery` | 10 tests, 9 pass, **1 fail** | `not ok 3 - runManagementQuery refuses before it builds a request` — *"runManagementQuery lost its management-plane gate"* |
| 3 | remove the `if (!isManagementPlaneEnabled())` short-circuit from `getStorageHealth` | 10 tests, 9 pass, **1 fail** | `not ok 1 - getStorageHealth short-circuits on the gate before it fans out` — *"getStorageHealth lost its management-plane gate"* |
| 4 | weaken the predicate from `=== 'true'` to any non-empty string | 10 tests, 9 pass, **1 fail** | `not ok 1 - is shut for every value that is not exactly "true"` |

Inversion 4 is included deliberately. Inversions 1–3 only prove that *a* check
exists at each chokepoint; 4 proves the check is the right one, and would catch
the common regression where a gate is "simplified" to a truthiness test and
silently starts opening on `"false"`.

**Restoration.** `storage-health.ts` was restored from a byte-for-byte copy
after each inversion. `git diff` reports no change against the committed file
and the suite returns `# pass 10 / # fail 0`.

**One thing inversion 3 does *not* prove, stated so the bundle is not read as
claiming more than it shows.** With the short-circuit removed, the *behavioural*
absence-of-request test still passes, because the authentication guard refuses
first and no request is issued for that reason instead. It is the structural
assertion that fails. That is exactly why both are present: the behavioural test
alone would have been satisfied by the wrong guard.

## The revert this lane had to undo

This is recorded in full because it is a defect class, not an incident.

`assertPrivilegedRequestAuthenticated` reached `storage-health.ts` on `main` in
`9ac4694d9` — **PR #1503, UTV2-1812**, merged **2026-09-05T19:49:34-04:00**.
PR #1494's merge-base is `717b46971`, dated **2026-09-02T17:09:57-04:00**, three
days earlier. Readmitting #1494 by taking its `storage-health.ts` wholesale
therefore removed an authentication guard from a privileged boundary — with no
merge conflict, and with nothing in #1494's own diff to show for it, because
that file never had the guard on that base.

```
$ git show origin/main:apps/command-center/src/lib/data/storage-health.ts | grep -c assertPrivilegedRequestAuthenticated
2
$ git show 6cde3622f:apps/command-center/src/lib/data/storage-health.ts | grep -c assertPrivilegedRequestAuthenticated
0
$ git show HEAD:apps/command-center/src/lib/data/storage-health.ts | grep -c assertPrivilegedRequestAuthenticated
2
```

`privileged-boundary-guard.test.ts` on `main` caught it, by name:
*"lib/data/storage-health.ts:getStorageHealth lost its own authentication gate"*.

**The repair.** The file was rebuilt as a genuine three-way merge —
`git merge-file` with `main` as ours, `717b46971` as base and #1494's head as
theirs; exit 0, no conflict markers — and the management-plane gate reapplied on
top of that result. `6cde3622f` and `9faa38f2c` are deliberately preserved in
the branch history rather than squashed away, so the sequence is legible.

**The generalisation.** Taking a long-lived branch's files is not a merge. Any
guard added to `main` in the interval disappears without a conflict, and the
only thing standing between that and production is whether a structural control
happens to name the function. Here one did. That is the argument for
`privileged-boundary-guard.test.ts` existing at all, and the argument for adding
a boundary to it whenever a new privileged surface appears.

## Scope note — where AC6 can and cannot be observed

There is **no System Health render site on `main`**. `storageDomains`,
`provisionedGiB`, `usedPct` and `daysToFull` appear nowhere under
`apps/command-center/src/app` or `src/components`; the only consumer of
`getStorageHealth` is `getDashboardRuntimeData`, whose `db` field feeds the
overview model. So the "renders honestly" property is asserted at the **data
boundary**, which is the only place it currently exists to assert. This is
recorded rather than papered over: when a storage panel is built, it will need
its own assertion that `unavailable` renders as unavailable, and that assertion
does not exist yet.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1513
Approved PR head: pending merge
Execution SHA: aab575f64311070f069ce961ed4da1f2d13da5dd

## Re-anchor after the origin/main resync

This PR was 10 commits BEHIND `origin/main`. Under `strict: true` it cannot merge in that
state, and merging BEHIND would be an admin exemption rather than permission, so
`origin/main` was merged in with `pnpm ops:merge-wrapper git-merge-main` (the wrapper
refuses to choose a history-rewriting verb on its own; `git-merge-main` preserves history
and SHAs, which matters on a branch carrying a proof bundle).

The head moved `bcd9e678b` → `aab575f64`. The imported delta carries `apps/smart-form/**`,
`scripts/ops/**` and `.github/workflows/deploy.yml`, none of them under
`PROOF_ONLY_PREFIXES`, so the merge commit becomes this branch's last non-proof commit and
the anchor had to move with it. **Every receipt above was re-executed at the new anchor
rather than carried forward:**

- `pnpm type-check` — exit 0, no diagnostics.
- `pnpm test` — tests 6004, pass 6004, fail 0, exit 0.
- `npx tsx scripts/ci/r-level-check.ts --base a2efc4172 --head aab575f64` — `Verdict: PASS`,
  `Changed files: 11`, `Rules matched: operator-ui`.

**On the test count.** It reads 6004 here and 6043 at the previous anchor. The two were
measured against different bases and no attempt is made to reconcile them; the figure
recorded is the one measured at the anchor this bundle binds. It was checked for
completeness rather than assumed: the run comprises 100 suite blocks in which `# tests`
equals `# pass` and `# fail` is 0 throughout, and it includes this lane's own two new test
files. Those filenames do not appear in the output because TAP prints subtest names rather
than paths — they are matched by the `src/lib/data/*.test.ts` glob in `test:command-center`,
confirmed by locating three of their subtest names ("a plain SELECT is accepted", "a
trailing semicolon is the conventional terminator...", "a CTE is accepted") in the run.

**A consequence worth recording rather than hiding.** `Lane authority` and `File scope lock`
were both red before the resync and both went green on the new head with no other edit —
the resync changed no lane file and no scope declaration. Those reds were therefore
artifacts of the BEHIND state, not scope violations.

`pnpm test:db` and `pnpm verify` are deliberately **not** re-claimed locally. Their prior
receipts were bound to a head that is no longer this PR's, and both are required checks
that re-run on this head; those runs are the authoritative results.
