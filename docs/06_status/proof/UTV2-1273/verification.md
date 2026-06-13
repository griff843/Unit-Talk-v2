# UTV2-1273 — Verification

**Issue:** UTV2-1273 — Infra gap: provision `SUPABASE_DB_URL` for Live Schema Parity CI.
**Branch:** `claude/utv2-1273-schema-parity-scratch-ssl` · **Lane type:** runtime · **Tier:** T2
**Base SHA:** `3ec71b27` · **Merge SHA:** _(rebound post-merge)_

## Verification

- **Secret provisioned:** `gh secret set SUPABASE_DB_URL` succeeded; `gh secret list` shows `SUPABASE_DB_URL`
  (set 2026-06-13T17:08:33Z). Value validated as a direct `postgresql://` connection to the prod project
  ref, never printed.
- **Missing-secret failure resolved:** dispatched run `27473400905` — the `Check DB configuration` job now
  passes (`db-configured=true`); the fail-closed `enforce-parity-required` gate no longer fires. This was
  the exact UTV2-1273 problem.
- **Remaining failure diagnosed + fixed:** the now-running `schema-parity` job failed at
  `supabase db push` with `tls error (server refused TLS connection)` against the local scratch Postgres —
  a latent workflow bug unmasked by provisioning the secret, not a missing-secret or schema issue.
  Fix: `?sslmode=disable` on the scratch `EXPECTED_DATABASE_URL`.
- **YAML validity:** `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/live-schema-parity.yml'))"` → valid.
- **CI proof:** the live-schema-parity workflow runs on this PR (path-triggered). Expectation: the run gets
  past the TLS error and produces a **real schema-parity result** (pass, or a true schema mismatch) — i.e.
  acceptance criterion "any remaining failure is a true schema issue, not configuration absence." See PR checks.

`pnpm type-check` / `pnpm test` are not affected by this CI-only YAML change; no app/package code touched.

## Acceptance criteria (UTV2-1273)

| Criterion | Result |
|---|---|
| Live Schema Parity no longer fails because `SUPABASE_DB_URL` is missing | PASS — `db-configured=true` |
| Secret value never printed in logs/comments/artifacts | PASS — piped, never echoed |
| CI result attached/linked | PASS — runs `27473400905` (pre-fix) + this PR's path-triggered run |
| Any remaining failure is a true schema issue, not configuration absence | Addressed by the `sslmode=disable` fix; confirmed on this PR's parity run |

## Guardrails honored
No production data mutation · no schema migration · no P3 cert · UTV2-1042 not Done · no CLV/ROI/edge claims · no public Discord change.
