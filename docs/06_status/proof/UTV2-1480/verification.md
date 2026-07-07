# UTV2-1480 Verification

## Verification

Commands run from `/home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1480-fix-workflow-config-drift`:

Commit SHA binding: `841eae77b25f5a7e29b63a7a9c4556d696e79c93`

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm type-check` | PASS | TypeScript project references check completed successfully. |
| `pnpm test` | PASS | Root aggregate test suite completed successfully. |
| Issue-specific workflow assertion | PASS | Parsed all four scoped workflow YAML files and asserted db-health pooler selection plus live-schema parity secret wording. |
| `pnpm test:db` | PASS | Live Supabase smoke tests completed as part of `pnpm verify`'s live DB phase. |
| `pnpm verify` | PASS | Static gate, `test:db`, and live T1 proof bundle completed successfully. |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | Changed files: 7; no R-level rules matched; no R-level artifacts required. |

Issue-specific assertion:

```text
UTV2-1480 issue-specific workflow config assertions: PASS
```

`pnpm verify` final live proof tail:

```text
pnpm test:db (live Supabase, project zfzdnfwdarxucxtaojxm)
# tests 7
# pass 7
# fail 0
# skipped 0

# Subtest: UTV2-1327 live-DB: picks table is accessible via listByLifecycleStates
ok 5 - UTV2-1327 live-DB: picks table is accessible via listByLifecycleStates
# Subtest: UTV2-1327 live-DB: enrichPickAtPromotionTime is stable against real pick schema from DB
ok 6 - UTV2-1327 live-DB: enrichPickAtPromotionTime is stable against real pick schema from DB
1..6
# tests 6
# pass 6
# fail 0
```

Live DB note: `test:t1-proof:live` included one skipped bounded-dedup window-content assertion because the most recent `provider_offer_history` row was older than the 72h lookback window; the test classifies this as stale provider data, not a code regression. The command exited 0.

## Post-review fix (Claude, pre-merge diff review)

Codex's execution pass fixed CW5 (invalid `uses:` refs — confirmed genuinely resolved, `.github/actions/supabase-pooler-url/action.yml` exists) but did not resolve 3 of 4 CW6 findings: it left `db-health-tripwire.yml`'s `LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}` untouched (referencing a secret that was never configured — every other workflow in the repo uses `LINEAR_API_TOKEN`), did not touch `deploy.yml` at all (dismissed as "no edit required"), and did not update `docs/05_operations/REQUIRED_SECRETS.md` — the actual file `ci-doctor.ts`'s CW6 check reads to determine "declared" secrets.

Fixed directly:
- `db-health-tripwire.yml`: `LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}` → `${{ secrets.LINEAR_API_TOKEN }}` (root-cause fix — the tripwire's Linear-alert feature was silently no-op'ing on every run).
- `docs/05_operations/REQUIRED_SECRETS.md`: added `SUPABASE_DB_POOLER_URL` and `SYNDICATE_MACHINE_ENABLED` entries (the actual missing declarations), updated `SUPABASE_DB_URL`'s `used_by` list.

Re-ran the CW6 check logic locally (parse inventory, diff against every `secrets.NAME` reference across all workflow files): confirmed all 4 originally-reported findings resolved. Found one pre-existing, out-of-scope gap (`SYNC_BOT_TOKEN` in `post-merge-lane-close.yml`, not one of this issue's 4 declared files) — left untouched, noted as a follow-up finding.

Re-ran `pnpm verify` (full suite green) and the R-level check (PASS, 7 changed files, no artifacts required) after these fixes.

### CS5 triage (required before any other change per acceptance criteria)

Manually inspected every matching line across the 4 in-scope workflow files. All references are proper `${{ secrets.X }}` interpolation or legitimate shell-variable reuse (e.g. re-passing an already-injected secret's value to a remote command, or referencing the secret's *name* in an error message). Confirmed false positive — no plaintext secret value found. Not escalated.
