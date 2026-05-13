# Claude Critique — UTV2-921

**Issue:** UT-P0-008 Enforce Audit Immutability
**Branch:** codex/utv2-921-audit-immutability
**Merge SHA:** (pending merge)
**Critic:** Claude Sonnet 4.6 (orchestrator)
**Date:** 2026-05-13

---

## Invariant Correctness

The diff enforces audit_log immutability at two layers — the migration linter prevents future violations, and corrective migrations remove existing ones.

- **A1 rule is absolute.** The new A1 rule pattern (`/\b(?:DELETE\s+FROM|UPDATE|TRUNCATE(?:\s+TABLE)?)\s+(?:ONLY\s+)?(?:public\.)?audit_log\b/i`) has no `override` key, unlike D1/D2/D3 rules. No `-- lint-override: A1` escape is possible. Correct.
- **Comment lines are excluded.** Lines starting with `--` are skipped by the linter (confirmed by the test case: a comment containing `DELETE FROM public.audit_log` produces no finding). Prevents false-positives on SQL documentation.
- **Trigger definitions are not caught.** `BEFORE UPDATE OR DELETE ON public.audit_log` does not match A1 because the UPDATE/DELETE keywords are not immediately followed by `audit_log`. Trigger DDL remains allowed.
- **D3/A1 interaction.** `TRUNCATE TABLE public.audit_log` would otherwise match both D3 and A1. The D3 rule's new `check: (_match, _fileContent, line) => !/\baudit_log\b/i.test(line)` guard returns false for that line, suppressing D3 while A1 fires. No double-flagging.
- **Four existing violations removed.** `202604080016`, `202604291001`, `202605030002`, `202605090001` all had audit_log pruning in their cron body strings. The destructive statements are removed in-place; the corrective migration `202605130001` reschedules the retention cron without any audit mutation.
- **Linter passes 105/105.** Including all four patched files and the new corrective migration.

## Regression Risk

- **`lintMigrationContent` export.** Previously inlined in `lintFile`; now a named export. Purely additive — no behavior change for callers of `node scripts/lint-migrations.mjs`.
- **`main()` async refactor.** Entry point uses `process.exitCode = await main()` and the `fileURLToPath(import.meta.url) === process.argv[1]` ESM guard — the correct idiom. CI and local invocations are unaffected.
- **`changedOnly` moved inside `main()`.** The `--changed-only` argv flag still works; it's parsed inside `main(argv)`. No regression.
- **`snippet` → `statement`.** Internal field name change in `lintMigrationContent` return value. No downstream consumers depend on the field name beyond the script's own console output and the new tests.

## Scope Drift

None. Changed files: `scripts/lint-migrations.mjs`, `scripts/ops/workflow-hardening.test.ts`, four existing migration files, one new migration. All within the declared file scope lock (`supabase/migrations/**`, `scripts/**`).

## Hidden Coupling

None found. `lintMigrationContent` is a new export; no existing public interface is modified.

## Verdict

**APPROVE**

Minimal, correct, and precisely scoped. Linter enforcement is absolute (no override mechanism for A1), comment handling prevents false positives, trigger definitions remain allowable, and all four existing violations are corrected. `pnpm verify` 113/0, `pnpm test:db` 2/0, `node scripts/lint-migrations.mjs` 105/105 clean.

Runtime verification is still required before merge per T1 policy.
