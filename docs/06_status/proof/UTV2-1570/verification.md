# PROOF: UTV2-1570

Head SHA at proof-authoring time (pre-push local head; superseded by the
actual PR head SHA / merge SHA per standard post-merge proof-SHA-binding
automation): 824ce007fbdba04782b2cdaf2100701bd5e8e939

## Verification

## Summary

Implements the concrete Tier C authorization gate and singleton approval
record designed by the parent design lane (which reviewed and corrected the
`PreToolUse` hook-output mechanism before this child was unblocked). Closes
two self-authorization loopholes:

1. **Tier C**: `.claude/hooks/tier-c-path-guard.sh`'s manifest-authorized
   bypass previously exited 0 silently — a lane could pre-authorize its own
   Tier C writes by declaring the path in its own scope, with no warning
   surfaced anywhere. The hook now emits a structured `PreToolUse` JSON
   payload on that same `exit 0` path (never moved to `exit 2`, which would
   re-block every legitimate T1 Tier C lane). A new required CI check,
   `tier-c-authorization-gate.ts`, closes the actual mechanical gap: it
   fails closed for non-T1 lanes touching a Tier C path with no valid
   `tier-c-approval/v1` approval comment.
2. **Singleton approval**: `--singleton-approved` was a bare, unverified
   CLI flag. `scripts/ops/singleton-approval.ts` validates a new
   `--singleton-approval-ref <Linear comment URL>` flag against the
   referenced comment's schema, full path coverage, and author identity
   matched against the issue's own creator, fetched live via the Linear
   GraphQL API.

## ASSERTIONS

- [x] Manifest-authorized Tier C write still exits 0 (not re-blocked)
- [x] Manifest-authorized Tier C write now emits valid JSON on stdout with `hookSpecificOutput.permissionDecision === "allow"`, non-empty `hookSpecificOutput.additionalContext`, non-empty top-level `systemMessage`, and `hookSpecificOutput.hookEventName === "PreToolUse"` — captured by direct invocation of the hook binary, not asserted from documentation alone
- [x] Un-authorized Tier C write still blocks (exit 2) with its stderr warning intact — the notice fix did not weaken this path
- [x] Ordinary non-Tier-C write still exits 0 with no fabricated notice
- [x] `tier-c-authorization-gate.ts` imports `isTierCPath` directly from `scripts/ops/merge-risk.ts` — no second Tier C path list
- [x] T1 lanes pass this gate with no additional artifact (already covered by `t1-approved` + `pm-verdict/v1` via `merge-gate.yml`)
- [x] Non-T1 lanes touching a Tier C path fail closed with no approval, partial-coverage approval, wrong-PR-bound approval, or stale-head-SHA-bound approval
- [x] A `/**` directory-glob `Paths:` entry covers every file under that prefix
- [x] `singleton-approval.ts` fails closed on: malformed ref URL, issue-ID mismatch, unresolvable issue, no matching comment, bot-authored comment, wrong-author comment, schema-mismatched body, incomplete path coverage
- [x] `singleton-approval.ts` matches the referenced comment by exact `url` equality (verified against a real Linear comment URL on this issue — the URL fragment is a truncated 8-char prefix of the full comment UUID, confirmed via live GraphQL introspection, not assumed)
- [x] `singleton-approval.ts` passes for a valid, fully-covering, owner-authored approval
- [x] 37 new unit tests (8 + 10 + 19) across three new `.test.ts` files, all green
- [x] `.claude/hooks/tier-c-path-guard.test.sh` (11 assertions) wired into a new `pnpm test:hooks` script, itself wired into the `pnpm test` chain reached by `pnpm verify`
- [x] `pnpm verify` PASS (full local run, exit code 0)
- [x] `pnpm test:db` PASS (7/7, live Supabase)
- [x] `lane-start.ts` integration deliberately deferred — documented gap, not silently dropped (see `known_gaps` in `evidence.json`)

## EVIDENCE

### New unit tests

```text
$ npx tsx --test scripts/ci/tier-c-approval-comment-parser.test.ts
1..8
# tests 8
# pass 8
# fail 0
```

```text
$ npx tsx --test scripts/ci/tier-c-authorization-gate.test.ts
1..10
# tests 10
# pass 10
# fail 0
```

```text
$ npx tsx --test scripts/ops/singleton-approval.test.ts
1..19
# tests 19
# pass 19
# fail 0
```

### Hook integration test / captured-behavior proof (the acceptance-criteria requirement)

```text
$ pnpm test:hooks
> bash .claude/hooks/tier-c-path-guard.test.sh

PASS: manifest-authorized write exits 0 (allow, not block)
PASS: manifest-authorized stdout is valid JSON
PASS: hookSpecificOutput.permissionDecision is 'allow'
PASS: hookSpecificOutput.additionalContext carries the Tier C notice
PASS: additionalContext identifies the authorizing lane (UTV2-9999998)
PASS: top-level systemMessage carries the Tier C notice
PASS: hookSpecificOutput.hookEventName is 'PreToolUse'
PASS: un-authorized Tier C write still blocks (exit 2) -- manifest bypass fix did not weaken this path
PASS: un-authorized Tier C write still emits its stderr warning
PASS: ordinary non-Tier-C path exits 0
PASS: ordinary non-Tier-C path produces no fabricated notice

tier-c-path-guard.test.sh: all assertions passed
```

### Full local verification

```text
$ pnpm verify
(env:check / lint / type-check / build / discord command-manifest check / test / test:db)
exit code: 0
```

`pnpm test` (the full suite reached by `pnpm verify`) includes `test:ops`
(1135 tests, 0 failures — includes the 37 new tests above) and the new
`test:hooks` script (11/11 assertions passing), in addition to every
pre-existing suite.

### Live database smoke test (`pnpm test:db`)

```text
$ pnpm test:db
> tsx --test apps/api/src/database-smoke.test.ts

TAP version 13
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 104747.334305
```

This lane changes only a local Claude Code hook, CI gate scripts, and a
pure Linear-GraphQL validator module (its schema is documented in that
module's own header comment) — no production code path or migration
touched. Live smoke run regardless per T1 policy (same reasoning as a
prior lane's proof for an equally out-of-domain CI/governance change).

## Live GraphQL introspection used to design `singleton-approval.ts`

Queried Linear's live GraphQL schema directly (not assumed from docs, which
did not document these fields) to confirm `Issue.creator` and
`Comment.{id,url,body,user,botActor}` field names, and queried this actual
issue (UTV2-1570) to confirm the real comment URL format
(`https://linear.app/<workspace>/issue/<ID>/<slug>#comment-<8-char-prefix>`)
— the fragment is a **truncated 8-character prefix** of the full comment
UUID, not the full ID, which is why the validator matches by exact `url`
equality against the comment's own canonical field rather than
reconstructing an ID from the URL.

## Known gap (see `evidence.json.known_gaps` for full detail)

`scripts/ops/lane-start.ts` is not wired to call the new
`singleton-approval.ts` validator in this PR. That file (and its test file)
are currently held by another active, unrelated concurrent T1 lane's
declared `file_scope_lock` (UTV2-1569's Fable-pilot-routing lane, PR #1292,
still open awaiting its own PM review). Touching it here would create a
hard file-scope-lock conflict, mechanically enforced by both
`ops:lane-start`'s own concurrency check at lane-creation time and CI's
`file-scope-lock-check.yml` at PR-diff time. This means the bare
`--singleton-approved` flag remains the only mechanism actually reachable
from `lane-start.ts` today — the singleton self-authorization loophole is
not yet mechanically closed end-to-end, only the validator half of it. The
validator itself, its schema doc, and its full test suite are complete and
ready to wire in with a small, mechanical change (replacing the flag check
around `scripts/ops/lane-start.ts`'s current
`flags.has('singleton-approved') || bools.has('singleton-approved')` line)
once the conflicting lane merges or closes.

## Owner boundary

T1 governance/security enforcement. Requires exact-head independent review,
`t1-approved`, and a Griff-authored `pm-verdict/v1`. This proof supplies
neither.
