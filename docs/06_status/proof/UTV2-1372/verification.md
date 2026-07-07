# UTV2-1372 Verification

## Verification

Run date: 2026-07-07

Commands executed from:

`/home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1372-supabase-egress-query-diet`

### Required Checks

| Command | Result | Notes |
|---|---:|---|
| `pnpm type-check` | PASS | TypeScript project references completed successfully. |
| `pnpm test` | PASS | Root aggregate test command completed successfully. |
| `pnpm test:db` | PASS on rerun | First `pnpm verify` attempt hit one transient Supabase `TypeError: fetch failed`; direct rerun passed 7/7. |
| `pnpm verify` | PASS on rerun | Static gate, root tests, Smart Form verify, command checks, live DB smoke, and live T1 proof completed. |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | Final committed diff has 4 changed files and no matched R-level rules. |

### `pnpm verify` Evidence

The first `pnpm verify` run reached live DB smoke and failed one live Supabase call:

```text
not ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
error: 'Failed to find pick by idempotency key: TypeError: fetch failed'
1..7
# tests 7
# pass 6
# fail 1
```

`pnpm test:db` was rerun immediately and passed:

```text
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

The full `pnpm verify` command was then rerun and passed. Final live proof tail:

```text
# Subtest: UTV2-1327 live-DB: picks table is accessible via listByLifecycleStates
ok 5 - UTV2-1327 live-DB: picks table is accessible via listByLifecycleStates
# Subtest: UTV2-1327 live-DB: enrichPickAtPromotionTime is stable against real pick schema from DB
ok 6 - UTV2-1327 live-DB: enrichPickAtPromotionTime is stable against real pick schema from DB
1..6
# tests 6
# suites 0
# pass 6
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### R-Level Check

Final R-level output after proof-file addition and commit:

```text
Verdict: PASS
Changed files: 4
Rules matched: (none) — no R-level artifacts required for this diff
```

### Issue-Specific Verification

This lane is proof/governance only. Issue-specific verification consisted of:

- Confirming no runtime code or DB schema files changed.
- Confirming the two required proof artifacts exist as Markdown files.
- Confirming this file contains the required `## Verification` header and explicitly mentions `pnpm type-check` and `pnpm test`.
- Running the full closeout gate (`pnpm verify`) including live DB smoke and live T1 proof.

### Known Live-DB Note

During the successful `pnpm verify` rerun, `t1-proof-utv2-1018-stranded-picks` reported the known stranded-row warning from live Supabase and still passed. No stranded rows were mutated by this lane.

### Audit deliverable added post-Codex-execution (Claude, pre-merge review)

The initial Codex pass produced only proof/lane bookkeeping without the audit document required by the issue's acceptance criteria. Completed `docs/06_status/audits/supabase-egress-query-diet-audit.md` directly via static code search (`grep` for `select('*')`, `.limit(`, `.range(`, live-DB test file usage) cross-referenced against the Supabase Performance Advisor — no queries executed against production data beyond what UTV2-1369's audit already captured (read-only row counts/sizes). Findings: 90 `select('*')` sites (concentrated in `runtime-repositories.ts`), 41/178 select calls paired with `.limit(` at the file level, 46 test files hitting live Supabase on every CI run.
