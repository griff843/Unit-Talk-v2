# UTV2-1292 — Verification

**Lane:** UTV2-1292 — Implement live-DB verify isolation and infra-unavailable status
**Tier:** T2 · **Lane type:** governance · **Executor:** Claude
CI/test-harness change only — no runtime/data/migration behavior change. Implements the UTV2-1291 proposal.

## Summary
Splits `verify` into `verify:static` (gates every PR; no live DB) and `test:live-db` (test:db + the live
t1-proof subset), and adds a verdict classifier that reports transient Supabase degradation as
`infra_unavailable` rather than a code failure. T1 strictness is preserved by the separate fail-closed
`T1 Proof Gate`.

## Evidence (offline / Supabase-independent)

### `pnpm verify:static` — PASS (exit 0)
The full static pipeline (sync/alignment/automation checks, env, lint, type-check, build, local + non-DB
tests incl. the new classifier test, smart-form verify, command verify) — **0 failures** across all suites.
```
VERIFY_STATIC_EXIT=0   (no "not ok", no ELIFECYCLE; final blocks e.g. # tests 113 # pass 113 # fail 0)
```

### `scripts/ci/live-db-verdict.test.ts` — PASS 8/8 (deterministic, offline, no DB)
```
ok 1 - UTV2-1292: exit 0 → passed
ok 2 - UTV2-1292: schema-cache error → infra_unavailable (not code_failed)
ok 3 - UTV2-1292: statement timeout → infra_unavailable
ok 4 - UTV2-1292: HTTP 520/521 → infra_unavailable
ok 5 - UTV2-1292: connection terminated / fetch failed → infra_unavailable
ok 6 - UTV2-1292: assertion failure with no infra signature → code_failed (BLOCK)
ok 7 - UTV2-1292: missing Supabase credentials → proof_skipped
ok 8 - UTV2-1292: passed takes precedence over an infra-looking string in healthy output
# tests 8  # pass 8  # fail 0
```

## Verification — live DB
This lane is the mechanism that isolates live-DB pressure; the live suite (`test:live-db`) is exercised by
the new `Live DB proof (classified)` CI step. Note: a PR's CI runs the **base branch's** workflow, so this
PR's own CI still runs main's `pnpm verify` and will flake on the active Supabase degradation until the
change merges — the very condition this lane fixes. No `test:db` output is fabricated here; T1 lanes' live
proof remains enforced by the unchanged `T1 Proof Gate`.

## Guardrails
No weakening of T1 runtime gates. No PM-gate bypass. No Discord. No P3 certification. No CLV/ROI/edge
claims. No live backfill. No secrets.

## Verdict
Implementation complete; static + classifier proof green offline. Ready for PM review (T2 governance/CI).

---

# PROOF: UTV2-1292
MERGE_SHA: 3b071f9788a10efa6c372af511e7d650b941c1a7

ASSERTIONS:
- [x] `verify` split into `verify:static` (no live DB) + `test:live-db`; root `test` is local-only; `verify` = static + live (full local-dev behavior preserved).
- [x] `live-db-verdict.ts` classifier emits passed/code_failed/infra_unavailable/proof_skipped; exits non-zero only on code_failed; 8/8 offline tests pass.
- [x] `ci.yml` Verify step → `verify:static`; live DB runs in a classified step that does not fail on infra degradation.
- [x] T1 strictness preserved via the unchanged fail-closed `T1 Proof Gate`; UTV2-1288 still needs real `test:db`.
- [x] `pnpm verify:static` PASS (exit 0) offline; branch-protection recommendation documented.

EVIDENCE:
```text
$ pnpm verify:static            → exit 0   (0 failures; e.g. # tests 113 # pass 113 # fail 0)
$ pnpm exec tsx --test scripts/ci/live-db-verdict.test.ts
# tests 8  # pass 8  # fail 0  # skipped 0
# live-DB classification: schema-cache / statement-timeout / 520-521 / connection → infra_unavailable; assertion → code_failed
```
