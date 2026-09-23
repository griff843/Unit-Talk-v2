# PROOF: WORK-2026092304

MERGE_SHA: 2eee84802e3aaff01c89b7cdd27f45f0141004a4

Generated at: 2026-09-23T13:12:27.000Z
Issue: WORK-2026092304
Tier: T2
Lane type: delivery-ui
Branch: claude/work-2026092304-cc-settle-error-message
Head SHA: 2eee84802e3aaff01c89b7cdd27f45f0141004a4
result: pass

## ASSERTIONS:

- [x] The settle server action returns the API's refusal message. The API answers every
      error as `{ ok: false, error: { code, message } }` (`apps/api/src/http.ts`
      `errorResponse`). `settle.ts` read a top-level `message` that the API never sets,
      so every refused settlement reached the operator as `API error <status>`.
- [x] `readApiErrorMessage` (`apps/command-center/src/lib/api-error.ts`) reads
      `error.message` first, then a top-level `message`. It falls back to
      `API error <status>` only when neither is a non-empty string.
- [x] Why it matters now: PR #1589 makes the API refuse a settlement race with
      `409 SETTLEMENT_ALREADY_RECORDED` and tells the operator to re-read and resubmit.
      Without this change that instruction was discarded.
- [x] Scope: 3 files, all in `apps/command-center`. Other actions (`review.ts`,
      `board.ts`) already read `error.message` and are unchanged. There is no API,
      domain, DB, delivery or containment change, and no production write.
- [x] Mutation drill: each of 2 mutations turns a distinct test red. The restored tree
      passes 4/4.

## EVIDENCE:

### 1. Mutation drill — `apps/command-center/src/lib/api-error.ts`

Each mutation was applied alone, and the file was restored from a copy before the next.

```
== M1 nested read removed (main's behaviour)
not ok 1 - reads the message the API nests under error
not ok 3 - the nested message wins over a top-level one
# pass 2
# fail 2
== M2 empty-string guard removed
not ok 4 - an unreadable body falls back to the status, never to an empty string
# pass 3
# fail 1
== restored
# pass 4
# fail 0
```

### R-level

```
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: operator-ui
```

## Verification
- [x] `pnpm type-check`: exit 0
- [x] Command Center `tsc --noEmit`: exit 0
- [x] `pnpm exec eslint` on the 3 changed files: exit 0
- [x] Command Center `pnpm test`: 663 pass, 0 fail
- [x] `ops:preflight` (PB2 runs the full `pnpm test`): PASS, 38 checks
- [x] Mutation drill: each of the 2 mutations turns a distinct test red
- [ ] `pnpm verify`: cannot exit 0 from a containment-isolated checkout.
      `ci:assert-staging` refuses because `local.env` pins `SUPABASE_URL` to loopback.
      CI runs `verify` on the PR.

## Runtime Verification

This lane is T2. The change is a pure response-body parser in a server action, with no
new write path and no runtime configuration change. No live-DB proof is claimed. The
staging browser suite `e2e/staging/operator-writes.spec.ts` covers the settle action
end to end. It depends on the API half in #1589, and it is not run here.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1632
Execution SHA: 2eee84802e3aaff01c89b7cdd27f45f0141004a4
