# PROOF: WORK-2026102205

MERGE_SHA: pending merge

Issue: WORK-2026102205
Tier: T1
Result: static implementation verified; writable staging proof deferred to protected CI

## ASSERTIONS

- [x] The alternate path is selected only by one anchored
      `PRIVILEGE-ONLY-VIEW` declaration and only after the classifier passes.
- [x] Every executable statement is mechanically limited to transaction control,
      one view's `security_invoker`, its GRANT/REVOKE statements, or the strict
      role-existence/checking `DO` allowlist.
- [x] A marker with forbidden SQL, a second relation, contradictory declaration,
      or unknown `DO` content fails closed; an ordinary migration remains on the
      pre-existing drill path.
- [x] The inline PR #1775 migration text classifies as privilege-only when the
      required marker is prepended. PR #1775 itself is not changed.
- [x] The runtime drill asserts `relkind = 'v'`, all seven table privileges for
      each declared role, `security_invoker=true`, exact rollback restoration, and
      first-apply/reapply parity.
- [x] The workflow runs real scratch-Postgres positive and negative fixtures for
      omitted revocation, residual anon SELECT, wrong `security_invoker`, incomplete
      rollback, unresolved target, and non-view target.
- [x] Existing relation/routine precondition and participant-catalog seed drills
      remain unchanged and pass.
- [x] No production DDL, deployment, merge, kill-switch, or Discord action ran.

## EVIDENCE

Implementation anchor:

```text
ed93caf31b7d196d8fde86cd1f22aef7315a9908
feat(ops): WORK-2026102205 add privilege-only view drill
4 files changed, 1193 insertions(+)
```

Focused combined suite:

```text
pnpm exec tsx --test scripts/ci/migration-precondition-drill.test.ts scripts/ci/privilege-only-view-drill.test.ts scripts/ci/participant-catalog-seed-drill.test.ts
tests 40; pass 23; fail 0; skipped 17
```

The 17 local skips are the existing and new real-Postgres fixtures because this
worktree has no `psql` or scratch server. They are not represented as runtime
passes. The workflow supplies both explicit scratch admin URLs and executes those
fixtures against its PostgreSQL service.

Required writable DB command:

```text
pnpm test:db
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
exit 1 before database tests or writes
```

Writable live-DB proof is blocked/deferred: target identity could not be resolved
from its URL (the packet's portable disposition names this `host=unparseable`; the
measured local guard reported `host=127.0.0.1`, `ref=unidentified`). Writable DB
verification requires `xskgrzbteyqdufktjrjx`. Run it through the `staging-ci`
GitHub environment with `CI_SUPABASE_*` credentials.

## Verification

| Command                                                                                                                                                               | Result                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm exec tsx --test scripts/ci/migration-precondition-drill.test.ts scripts/ci/privilege-only-view-drill.test.ts scripts/ci/participant-catalog-seed-drill.test.ts` | PASS: 23 pass, 0 fail, 17 real-Postgres tests skipped locally and wired to workflow PostgreSQL |
| `pnpm type-check`                                                                                                                                                     | PASS                                                                                           |
| `pnpm lint`                                                                                                                                                           | PASS                                                                                           |
| `pnpm verify:static`                                                                                                                                                  | PASS                                                                                           |
| `pnpm verify`                                                                                                                                                         | STATIC PASS, then BLOCKED/DEFERRED at the live-DB staging identity guard; no DB write attempted |
| `pnpm test:db`                                                                                                                                                        | BLOCKED/DEFERRED at staging identity guard; no DB write attempted                              |
| `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`                                                                                            | PASS: 11 changed files, no R-level rules matched                                               |
| Exact-head protected CI                                                                                                                                               | Required before PM review verdict; not yet claimed                                             |

## Remaining authority

Independent control review, the PM T1 verdict, merge, lane finalization, and
post-merge reconciliation remain pending for their authorized paths. This bundle
is an executor review candidate, not approval or merge authority.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1776
