# UTV2-1480 Diff Summary

## Summary

UTV2-1480 fixes workflow configuration drift in the live database operations workflows.

## Files changed

- `.github/workflows/db-health-tripwire.yml` — pins `pnpm/action-setup` to the repo package manager version (`10.29.3`), names setup steps consistently, routes the live DB connection through the `supabase-pooler-url` composite action (confirmed to already exist at `.github/actions/supabase-pooler-url/action.yml` — CW5 genuinely resolved), and **fixes the actual root cause of the CW6 finding for this file**: `LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}` referenced a secret that was never configured under that name — changed to `${{ secrets.LINEAR_API_TOKEN }}` (the secret every other workflow in the repo already uses), preserving the `LINEAR_API_KEY` env var name the underlying script (`scripts/ops/db-health-tripwire.ts`) reads. Before this fix, the tripwire's Linear-alert-posting feature silently no-op'd on every run because the secret resolved to empty.
- `.github/workflows/live-schema-parity.yml` — fail-closed comment/error-text wording updated for the pooler-or-direct secret contract (Codex's change, verified correct).
- `.github/workflows/schema-baseline-dump.yml` — commentary updated to name the preferred pooler secret (Codex's change, verified correct).
- `docs/05_operations/REQUIRED_SECRETS.md` — **added the two entries actually missing from the inventory** (this is the real fix for the remaining CW6 findings, not a workflow-file edit): `SUPABASE_DB_POOLER_URL` (used by `live-schema-parity.yml`, `schema-baseline-dump.yml`, `db-health-tripwire.yml`) and `SYNDICATE_MACHINE_ENABLED` (used by `deploy.yml`). `SUPABASE_DB_URL`'s `used_by` list also updated to include `db-health-tripwire.yml`.
- `.github/workflows/deploy.yml` — **not edited**: its `SYNDICATE_MACHINE_ENABLED` references were already correct `${{ secrets.SYNDICATE_MACHINE_ENABLED }}` usage; the CW6 finding there was purely a missing inventory entry, now fixed in `REQUIRED_SECRETS.md` above.

## Verification of fix completeness

Re-ran the CW6 check logic locally (parse `REQUIRED_SECRETS.md`'s inventory, diff against every `secrets.NAME` reference across all `.github/workflows/*.yml` files): all 4 originally-reported undeclared-secret references (`LINEAR_API_KEY` ×1, `SYNDICATE_MACHINE_ENABLED` ×1, `SUPABASE_DB_POOLER_URL` ×2) are now resolved. One additional pre-existing undeclared secret was found during this check — `SYNC_BOT_TOKEN` in `.github/workflows/post-merge-lane-close.yml` — which is **outside this issue's declared file scope** and was not touched; noted here as a follow-up finding rather than expanding scope.

## CS5 triage (per acceptance criteria — must be resolved before any other change)

Manually inspected every line matching `LINEAR_API_KEY`, `SYNDICATE_MACHINE_ENABLED`, and `SUPABASE_DB_POOLER_URL` across the 4 in-scope workflow files before making any change. All references are either proper `${{ secrets.X }}` interpolation or legitimate shell-variable reuse of an already-injected secret's value (e.g. `SYNDICATE_MACHINE_ENABLED=$SYNDICATE_MACHINE_ENABLED` passed to a remote deploy command, `echo "::error::...must be exactly 'true'"` referencing the secret's *name* in an error message, never its value). **Confirmed false positive — no plaintext secret value found.** Not escalated as an incident.

## Scope

No application code, package code, migrations, generated DB types, or runtime delivery paths were changed.
