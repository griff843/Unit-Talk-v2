# Supabase Preview Branch Validation

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
