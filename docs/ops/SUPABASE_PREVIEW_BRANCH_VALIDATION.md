# Supabase Preview Branch Validation

> **HISTORICAL — the workflow described here was deleted on 2026-07-30 (UTV2-1629).**
>
> `.github/workflows/supabase-pr-db-branch.yml` no longer exists. It had been
> dormant behind an unset `vars.SUPABASE_BRANCHING_ENABLED`, and once UTV2-1630
> put `ci:assert-staging` in front of `pnpm test:db` it could not have passed
> anyway — a preview branch is its own project ref, which that gate refuses by
> design. Its `teardown` job was not behind the branching gate, so it carried an
> org-wide Supabase management token on every closed migration PR while creating
> nothing to tear down; four preview branches parented on production were still
> live regardless.
>
> Migration validation now runs through `live-schema-parity.yml` (full migration
> replay against a fresh Supabase local stack, diffed against live) and
> `pnpm test:db` against the dedicated staging project. See
> `docs/05_operations/supabase_setup.md`.
>
> This file is kept because `ci-doctor` check `CV6` reads it; `CV1`–`CV6` all
> report `skip` while the workflow is absent.

This workflow is **selective-use** only.

It exists to validate migration changes on an isolated Supabase preview branch when a pull request touches `supabase/migrations/**`. It is not intended as a global always-on validation path for every PR.

## Selective-Use Contract

- Run the preview-branch workflow only for PRs that modify migration files.
- Skip the validation path when no migration files changed.
- Keep the preview-branch workflow scoped to the known churn protections:
  - quoted-value stripping before writing to `$GITHUB_ENV`
  - pooled Supabase DB URL usage for migration validation
  - create/attach/teardown of isolated preview branches for migration PRs only

## Rationale

This selective-use posture prevents unnecessary CI churn on PRs that do not affect database migrations while preserving fail-closed validation for migration-bearing PRs.
