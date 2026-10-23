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

3d913d88631c193efc56a7ee29d7a51e13d4bfe1
fix(ops): WORK-2026102205 accept governed work ids
2 files changed, 8 insertions(+), 4 deletions(-)
```

Focused combined suite (re-measured at the anchor):

```text
pnpm exec tsx --test scripts/ci/migration-precondition-drill.test.ts scripts/ci/privilege-only-view-drill.test.ts scripts/ci/participant-catalog-seed-drill.test.ts
tests 85; pass 68; fail 0; skipped 17
```

The 17 local skips are the real-Postgres fixtures because this worktree has no
`psql` or scratch server. They are not represented as runtime passes. The
workflow supplies the scratch admin URLs and runs them against its PostgreSQL
service.

Implementation anchor (last non-proof commit):

```text
4c5a8e5f4da67a69c0a66976b6775387c9d45ec9
fix(ci): policy rows with extra fields fail (ninth review finding)
```

## Control review log

Seven independent read-only reviewers attacked the classifier. Each true bypass
was fixed and given a regression test that fails without the fix:

1. `--` inside a double-quoted identifier hid SQL in the DO body.
2. A nested `$$..$$` string under a tagged outer quote hid SQL.
3. An EXECUTE operand concatenated with `|| '; DROP ...'` or an adjacent literal.
4. A bare CR ended a PostgreSQL comment but not the lexers; extra role in the
   FOREACH array; role_name reassignment; GRANT to PUBLIC.
5. Environment-conditional grants behind `IF EXISTS (... rolname = 'x')`, PUBLIC
   via a declared-variable default, a neutralised RAISE, an unbounded LOOP. This
   replaced the token allowlist with an exact canonical DO-template match.
6. Case-folded role literals, block comments gluing tokens, case-insensitive
   closing tag, statement ordering.
7. Down-script meta-commands on the same line, mid-file COMMIT/BEGIN, marker
   postures such as `anon=all`, a PUBLIC or third-role ACL entry invisible to
   `has_table_privilege` on the three roles, ReDoS size cap, ALTER ... RESET.

Round 8: a second independent reviewer, shown only the round-7 fix and the
wrong-security_invoker test change, found no way to classify a non-privilege-only
migration as valid and pass the drill. It reported seven low or informational
items. Four were fixed here, each with a test: the down script is now classified
with an allowlist (`classifyPrivilegeOnlyViewDownScript`, including an exact
rollback DO template and tampering tests for COPY PROGRAM, ALTER SYSTEM, event
trigger, function and extra statements); the policy matrix requires exactly 21
distinct valid rows (`evaluatePolicyRows`, empty output fails); a present but
malformed PRIVILEGE-ONLY-VIEW marker is invalid, not ordinary; and the size cap
counts bytes. Items 3, 5 and 7 are accepted with rationale (the drill or the
server is the backstop).

Round 9: a third independent reviewer, shown only the round-8 diff, found no
down-script input accepted that does more than restore privileges on the declared
view. It reported one low item (policy rows with extra `|` fields were tolerated),
fixed with a test that fails without the fix, and two fail-safe notes (near-miss
marker spellings still classify ordinary and take the stricter ordinary drill; a
marker-looking line inside a dollar-quoted body is invalid). The final one-line
fix after round 9 has not been separately re-reviewed.

Local tests cannot exercise the Postgres-backed ACL query or the down-script
drill path; they run for the first time in CI.

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

| Command                                                                                                                                                               | Result                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `pnpm exec tsx --test scripts/ci/migration-precondition-drill.test.ts scripts/ci/privilege-only-view-drill.test.ts scripts/ci/participant-catalog-seed-drill.test.ts` | PASS: 68 pass, 0 fail, 17 real-Postgres tests skipped locally (85 total) and wired to workflow PostgreSQL |
| `pnpm type-check`                                                                                                                                                     | PASS                                                                                                      |
| `pnpm lint`                                                                                                                                                           | PASS                                                                                                      |
| `pnpm verify:static`                                                                                                                                                  | PASS                                                                                                      |
| `pnpm verify`                                                                                                                                                         | STATIC PASS, then BLOCKED/DEFERRED at the live-DB staging identity guard; no DB write attempted           |
| `pnpm test:db`                                                                                                                                                        | BLOCKED/DEFERRED at staging identity guard; no DB write attempted                                         |
| `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`                                                                                            | PASS: 11 changed files, no R-level rules matched (re-run at the anchor)                                   |
| Exact-head protected CI                                                                                                                                               | Read from the PR checks at the final head; not asserted here                                              |

## Remaining authority

Independent control review, the PM T1 verdict, merge, lane finalization, and
post-merge reconciliation remain pending for their authorized paths. This bundle
is an executor review candidate, not approval or merge authority.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1776
Execution SHA: 4c5a8e5f4da67a69c0a66976b6775387c9d45ec9
