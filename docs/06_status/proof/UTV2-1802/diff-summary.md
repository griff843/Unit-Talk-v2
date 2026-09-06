# Diff summary — UTV2-1802

Issue: UTV2-1802
PR: https://github.com/griff843/Unit-Talk-v2/pull/1513
Branch: `claude/utv2-1802-cc-management-sql-readonly`
Execution SHA: ef38423dc0c9650db928ee2ea55d5d97063b9590
Tier: T1
Lane type: delivery-ui

Readmission of PR #1494 through the lane system. #1494 was opened outside
`ops:lane-start`, so `Merge Gate` could not resolve an authoritative tier for it
and reported *"No issue ID found in PR branch or title"*. Renaming an open PR's
head branch closes it permanently, so readmission is a replacement PR carrying
the same work under the canonical issue. #1494 is closed in favour of this PR.

## Files changed

| File | +/- | What |
|---|---|---|
| `apps/command-center/src/lib/data/management-sql.ts` | +230 / -0 | New. Read-only statement registry, validated at import time. Taken verbatim from #1494. |
| `apps/command-center/src/lib/data/management-sql.test.ts` | +178 / -0 | New. 17 tests over the policy. Taken verbatim from #1494. |
| `apps/command-center/src/lib/data/storage-health.ts` | +213 / -61 | Interpolated SQL replaced by registry lookups; fail-closed management-plane gate; honest degradation. Rebuilt as a three-way merge (see below). |
| `apps/command-center/src/lib/data/storage-health.test.ts` | +229 / -0 | New. 10 tests: gate value table, absence-of-request, per-chokepoint structure, honest degradation. |
| `apps/command-center/src/lib/types.ts` | +21 / -2 | `StorageAlertStatus` union gains `unavailable`; `DbRuntimeHealth` gains `managementPlane`. |
| `apps/command-center/src/lib/overview-model.test.ts` | +1 / -0 | Fixture gains the new required `managementPlane` field. |
| `.ops/sync/UTV2-1802.yml`, `docs/06_status/lanes/UTV2-1802.json`, `docs/06_status/proof/UTV2-1802/**` | — | Lane artifacts. |

No file outside `apps/command-center/**` and this lane's own artifacts is touched.
No package boundary, dependency, migration, workflow or policy input changes.

## The three commits

| SHA | What |
|---|---|
| `6cde3622f` | Readmit #1494's `management-sql.ts` + tests unchanged, and #1494's `storage-health.ts` unchanged. |
| `9faa38f2c` | Add the fail-closed management-plane gate and honest degradation. |
| `ef38423dc` | Restore the authentication guard `6cde3622f` silently reverted; rework the tests to assert the absence of the request; mutation-test the gate. |

The middle commit is preserved rather than squashed away because the third one
is the interesting one: it records a defect introduced by taking a long-lived
branch's file wholesale, and the record is worth more than a tidy history.

## What #1494 reverted, and how it was caught

`assertPrivilegedRequestAuthenticated` reached `storage-health.ts` on `main` in
`9ac4694d9` (**#1503, UTV2-1812**, merged 2026-09-05T19:49:34-04:00). #1494's
merge-base is `717b46971`, dated **2026-09-02T17:09:57-04:00** — three days
earlier. Taking that branch's `storage-health.ts` wholesale therefore removed
the guard with no conflict and nothing in #1494's own diff to show for it:

```
$ git show origin/main:apps/command-center/src/lib/data/storage-health.ts | grep -c assertPrivilegedRequestAuthenticated
2
$ git show 6cde3622f:apps/command-center/src/lib/data/storage-health.ts | grep -c assertPrivilegedRequestAuthenticated
0
$ git show HEAD:apps/command-center/src/lib/data/storage-health.ts | grep -c assertPrivilegedRequestAuthenticated
2
```

`privileged-boundary-guard.test.ts` on `main` caught it: *"lib/data/storage-health.ts:getStorageHealth
lost its own authentication gate"*. The file was then rebuilt as a genuine
three-way merge — `git merge-file` with `main` as ours, `717b46971` as base and
#1494's head as theirs, exit 0, no conflict markers — and the gate reapplied on
top of that result.

## Behavioural change

1. **Management SQL is a closed registry.** Every statement is declared once and
   validated by `assertSingleReadOnlyStatement` at *import* time, so a policy
   violation fails the module load rather than a request. The validator strips
   line comments, nested block comments, dollar-quoted bodies and quoted
   literals before checking, then rejects: empty input, more than one statement,
   an opener that is not `select`/`with`/`table`/`values`/`explain`, any of 35
   forbidden keywords, `SELECT ... INTO`, and
   `pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export|dblink|pg_sleep`.

2. **The management plane is off unless explicitly enabled.**
   `UNIT_TALK_COMMAND_CENTER_MANAGEMENT_API_ENABLED` must be exactly `"true"`
   (trimmed, case-insensitive). `getStorageHealth`, `fetchManagementJson` and
   `runManagementQuery` each own their own check, and each performs it before it
   builds a request and before it resolves credentials — so a shut gate is
   reported as a policy refusal, never as a missing secret.

3. **Order matters and is asserted.** `getStorageHealth` authenticates first and
   checks the gate second, so an unauthenticated caller cannot learn the gate's
   state.

4. **Degradation is honest.** With the gate shut, `DbRuntimeHealth` carries
   `managementPlane: { available: false, reason }`, both storage domain rows are
   present, and every `alertStatus` reads `unavailable`. `unavailable` is a
   member of the `StorageAlertStatus` union rather than an absent field, because
   an omitted row renders as nothing and nothing reads as healthy.

## Risk

Low, and bounded to one app. The gate defaults shut, so a deployment that does
not set the variable loses the storage panel's management-sourced numbers and
gains an explicit `unavailable` reading — it does not lose the page. Nothing
outside `apps/command-center` imports any of these symbols.
