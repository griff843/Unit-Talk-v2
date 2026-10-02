# PROOF: UTV2-1966

MERGE_SHA: 2c4e754652830967bf006db6dff3f96f55c9f9a1

Measured on implementation source b56870d86a69a54aad7796c9d075d3810debade5.

Issue: UTV2-1966
Tier: T2
result: pass

Aggregate PASS is bound to authoritative CI source 6e0c2257e7741749893df664853c083e08d14b71.
Local static success does not override the local live-DB refusal. CI independently
satisfied the required staging and static gates; any later proof-only PR head must
still pass its own required checks before merge.

## ASSERTIONS:

- [x] Canonical identity validation remains unchanged and precedes psql execution.
- [x] Explicit libpq fields preserve reader/pooler/database identity, secure SSL and mandatory read-only PGOPTIONS.
- [x] Credentials remain out of argv; management token, original DSN and inherited libpq overrides do not cross the psql boundary.
- [x] Exact numeric repository/local/remote ledger alignment remains mandatory; one backtick pair and surrounding whitespace are accepted.
- [x] Existing membership, trigger, privilege, transaction and immutable receipt assertions remain intact.

## EVIDENCE:

```text
Focused verifier + credential guard: tests 51, pass 51, fail 0
Staging enforcement: tests 38, pass 38, fail 0
Full operations suite: tests 3564, pass 3564, fail 0
pnpm verify: static chain passed (lint, type-check, build, all test suites,
dedicated production-verifier suite, Smart Form verification, command verification).
Final local live-DB phase: REFUSED before connection; host=127.0.0.1,
expected staging=xskgrzbteyqdufktjrjx. Full command exit=1, not a live-DB PASS.
Authoritative CI run 37013552841, attempt 1, source 6e0c2257e7741749893df664853c083e08d14b71:
verify job 110862716787: completed / success
staging producer job 110859100024: completed / success
staging smoke: 7/7; all live proof suites: success
artifact 11229955764: utv2-1630-db-proof-receipt-37013552841-1
receipt SHA256: 38bdc05830e2167a2b344837c746746febe9e0602502ae1d8787059b204ea295
R-level: PASS; no matching rules.
```

## Verification

- `pnpm type-check`: PASS as executed by the full static verification chain.
- `pnpm test`: PASS as executed by the full static verification chain, including operations suite 3564/3564.
- `pnpm exec tsx --test scripts/ci/production-post-migration-verify.test.ts scripts/ci/workflow-production-credential-guard.test.ts`: PASS 51/51.
- `pnpm exec tsx --test scripts/ci/staging-path-enforcement.test.ts`: PASS 38/38.
- `pnpm verify`: static PASS; local live-DB fail-closed refusal as documented above. Full log: `.out/utv2-1966-verify.log` (local ignored).
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS.
- `git diff --check`: PASS.

No production PASS, mutation or closeout is claimed by this static repair proof.
Fresh trusted-main production read-only verification and separate Live Schema Parity remain mandatory after merge.

## Merge SHA Binding

Merge SHA: 2c4e754652830967bf006db6dff3f96f55c9f9a1
PR: pending
Execution SHA: 6e0c2257e7741749893df664853c083e08d14b71
