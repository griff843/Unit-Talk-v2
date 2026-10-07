# PROOF: UTV2-1970

MERGE_SHA: pending merge

Issue: UTV2-1970
Tier: T1
result: READY_FOR_REVIEW_WITH_STAGING_DB_DEFERRED

## ASSERTIONS:

- [x] A valid pinned human-capper destination is fetched and must be the exact expected
      guild/channel, Discord public-thread type 11, structurally valid, and locked.
- [x] Active locked threads post without a channel mutation.
- [x] Archived locked threads receive only `{ archived: false, locked: true }` with an
      attributable bounded audit reason, are re-read, and post only when active and locked.
- [x] Missing/malformed metadata, mismatched identity/type, unlocked state, and every
      GET/PATCH/re-read failure or timeout stop before message POST with no shared-map fallback.
- [x] No request sends `locked: false`; message payload, nonce, physical receipt channel,
      idempotency, dispatch, kill-before-adapter, and terminal containment remain unchanged.

## EVIDENCE:

```text
pnpm exec tsx --test apps/worker/src/delivery-adapters.test.ts apps/worker/src/official-picks-exactly-once.test.ts
tests 47; pass 47; fail 0

pnpm exec tsx --test apps/worker/src/worker-runtime.test.ts
tests 86; pass 86; fail 0

pnpm type-check
exit 0

pnpm verify:static
PASS
```

## Verification

- `pnpm verify:static`: PASS, including lint, type-check, build, full test matrix,
  command-manifest validation, and migration checks.
- `pnpm verify`: all static stages PASS; exit 1 only when `test:live-db` invoked the
  staging guard. The guard identified `host=127.0.0.1 ref=unidentified`, required
  `xskgrzbteyqdufktjrjx`, and refused before `database-smoke.test.ts` or any write.
- `pnpm test:db`: same safe refusal before tests or writes. Writable live-DB proof is
  blocked/deferred: target identity could not be resolved from its URL
  (`host=unparseable`). Writable DB verification requires `xskgrzbteyqdufktjrjx` and
  must run through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials.
- Exact-head CI and R-level results are recorded on the draft PR without changing the
  source SHA. No live Discord request or deployment was made during verification.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1722
Execution SHA: b9d5e698a84b7fae3411a6a8a3d7d12a49768acf
