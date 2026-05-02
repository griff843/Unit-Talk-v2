# Required Secrets — Canonical Inventory

**Status:** Canonical, implementation-usable
**Authority:** `docs/05_operations/CI_DOCTOR_SPEC.md` §7.1 (secret existence inventory), `EXECUTION_TRUTH_MODEL.md` §5
**Consumed by:** `scripts/ops/ci-doctor.ts` (checks `CA1`, `CS2`, `CS3`, `CW6`, `CV2`)
**Update policy:** Additions append. Never rename a declared secret without updating both this file and the workflows that reference it in the same commit.

---

## 1. Purpose

This file is the **single source of truth** for which GitHub Actions secrets the Unit Talk V2 repo requires in order for its CI surface to function. `ci-doctor` parses the fenced JSON block below and compares it against:

1. The actual `${{ secrets.NAME }}` references in every `.github/workflows/*.yml` file (`CW6`).
2. The list of secret names configured on the GitHub repo (`CS2`, `CS3`).
3. The secrets referenced by the Supabase preview-branch workflow (`CV2`).

Drift in any direction is a `fail`. This file is therefore a contract: workflows may not reference secrets that are not listed here, and the repo may not be missing any secret listed here.

Secret **values** are never recorded here. Only names, purpose, and scope.

---

## 2. Canonical inventory (machine-readable)

The `ci-doctor` parser reads the first fenced ```json block in this file and expects the shape:

```
{
  "schema_version": 1,
  "secrets": [
    { "name": "<SECRET_NAME>", "environment": "<optional env name>" }
  ]
}
```

Fields beyond `name` and `environment` are tolerated (parser uses `additionalProperties: true`) and are preserved here as human-readable metadata.

```json
{
  "schema_version": 1,
  "secrets": [
    {
      "name": "GITHUB_TOKEN",
      "required": true,
      "source": "github-auto",
      "scope": "repo",
      "used_by": [".github/workflows/ci-doctor.yml"],
      "purpose": "Read-only API access for ci-doctor to list secrets, inspect branch protection, and read workflow run history. Auto-provided by GitHub Actions; never manually configured."
    },
    {
      "name": "LINEAR_API_TOKEN",
      "required": true,
      "source": "manual",
      "scope": "repo",
      "used_by": [".github/workflows/linear-auto-close.yml"],
      "purpose": "Linear API write token used by linear-auto-close to transition referenced UTV2 issues to Done and post merge-SHA comments on push to main."
    },
    {
      "name": "FIBERY_API_URL",
      "required": true,
      "source": "manual",
      "scope": "repo",
      "used_by": [".github/workflows/fibery-sync-on-pr.yml", ".github/workflows/fibery-sync-on-merge.yml", ".github/workflows/ops-daily-digest.yml"],
      "purpose": "Fibery workspace API URL used by PR and merge sync workflows to append GitHub activity to referenced Unit Talk audit entities."
    },
    {
      "name": "FIBERY_API_TOKEN",
      "required": true,
      "source": "manual",
      "scope": "repo",
      "used_by": [".github/workflows/fibery-sync-on-pr.yml", ".github/workflows/fibery-sync-on-merge.yml", ".github/workflows/ops-daily-digest.yml"],
      "purpose": "Fibery API token used by PR and merge sync workflows to update referenced Unit Talk audit entities."
    },
    {
      "name": "UNIT_TALK_OPS_ALERT_WEBHOOK_URL",
      "required": false,
      "source": "manual",
      "scope": "repo",
      "used_by": [".github/workflows/stale-lane-alerter.yml", ".github/workflows/ops-daily-digest.yml"],
      "purpose": "Discord webhook URL for ops alert notifications. Optional — alerter and digest exit 0 and skip Discord post when absent."
    },
    {
      "name": "SUPABASE_ACCESS_TOKEN",
      "required": true,
      "source": "manual",
      "scope": "repo",
      "used_by": [".github/workflows/supabase-pr-db-branch.yml"],
      "purpose": "Supabase management API token used by the preview-branch workflow to create, attach, and tear down per-PR Supabase branches and to apply migrations on isolated branches."
    },
    {
      "name": "SUPABASE_URL",
      "required": false,
      "source": "manual",
      "scope": "repo",
      "used_by": [".github/workflows/proof-regression.yml"],
      "purpose": "Supabase project URL used by proof-regression workflow to run live DB proof scripts. Optional — workflow skips proof runs when absent (HAS_SUPABASE guard)."
    },
    {
      "name": "SUPABASE_SERVICE_ROLE_KEY",
      "required": false,
      "source": "manual",
      "scope": "repo",
      "used_by": [".github/workflows/proof-regression.yml"],
      "purpose": "Supabase service role key for proof-regression workflow. Optional — workflow skips proof runs when absent (HAS_SUPABASE guard)."
    },
    {
      "name": "SUPABASE_ANON_KEY",
      "required": false,
      "source": "manual",
      "scope": "repo",
      "used_by": [".github/workflows/proof-regression.yml", ".github/workflows/deploy.yml"],
      "purpose": "Supabase anon key for proof-regression workflow and deploy gate. Optional — workflow skips proof runs when absent (HAS_SUPABASE guard)."
    },
    {
      "name": "DISCORD_BOT_TOKEN",
      "required": false,
      "source": "manual",
      "scope": "repo",
      "used_by": [".github/workflows/deploy.yml"],
      "purpose": "Discord bot token written into the deploy gate local.env for production validation. Optional for the deploy check step; must be set when the Discord worker is included in the deployment."
    },
    {
      "name": "UNIT_TALK_DEPLOY_HOST",
      "required": false,
      "source": "manual",
      "scope": "repo",
      "used_by": [".github/workflows/deploy.yml"],
      "purpose": "Hostname or IP of the production server. Used by the deploy workflow SSH and SCP steps. Optional — deploy workflow only runs on workflow_dispatch."
    },
    {
      "name": "UNIT_TALK_DEPLOY_USER",
      "required": false,
      "source": "manual",
      "scope": "repo",
      "used_by": [".github/workflows/deploy.yml"],
      "purpose": "SSH username on the production server. Used by the deploy workflow SSH and SCP steps."
    },
    {
      "name": "UNIT_TALK_DEPLOY_PATH",
      "required": false,
      "source": "manual",
      "scope": "repo",
      "used_by": [".github/workflows/deploy.yml"],
      "purpose": "Absolute path to the deployment directory on the production server."
    },
    {
      "name": "UNIT_TALK_DEPLOY_HEALTH_URL",
      "required": false,
      "source": "manual",
      "scope": "repo",
      "used_by": [".github/workflows/deploy.yml"],
      "purpose": "HTTP URL polled after container startup to confirm the deployment is healthy. Must return 2xx."
    },
    {
      "name": "UNIT_TALK_DEPLOY_SSH_KEY",
      "required": false,
      "source": "manual",
      "scope": "repo",
      "used_by": [".github/workflows/deploy.yml"],
      "purpose": "Ed25519 private key for SSH access to the production server. Must match an authorized key on UNIT_TALK_DEPLOY_USER@UNIT_TALK_DEPLOY_HOST."
    }
  ]
}
```

---

## 3. Secret-by-secret detail

### 3.1 `GITHUB_TOKEN`

- **Required:** Yes (auto-provided by GitHub Actions on every workflow run).
- **Scope:** Read-only for `ci-doctor` (`contents: read`, `actions: read`). Never request write scopes.
- **Used by:** `.github/workflows/ci-doctor.yml`.
- **Local vs CI:**
  - **CI:** automatically injected by GitHub Actions; no operator action needed.
  - **Local:** `pnpm ops:ci-doctor` uses the caller's `GITHUB_TOKEN` environment variable. Developers running ci-doctor locally must export a personal access token with `actions:read`, `metadata:read`, and `repo:status` scopes.
- **Fail-closed implications when missing:** `ci-doctor` exits `3` (infra) and cannot report. `CS1`, `CS2`, `CS3`, `CR1`..`CR4`, `CV5`, and `CH1`..`CH4` all return `infra_error`. The daily digest surfaces the stale artifact as a FAIL-equivalent.
- **Scope restrictions:** Must not be used with any write scope. ci-doctor's contract (`CI_DOCTOR_SPEC.md` §4) forbids mutation tokens.

### 3.2 `LINEAR_API_TOKEN`

- **Required:** Yes for the Linear auto-close path to function. The repo merges to `main` will still succeed without it, but referenced UTV2 issues will not auto-transition.
- **Scope:** Repo-level secret. Write scope on Linear (needed to update issue state and post comments).
- **Used by:** `.github/workflows/linear-auto-close.yml` (steps that call the Linear API on `push` to `main`).
- **Local vs CI:**
  - **CI:** required; absence causes the `linear-auto-close` job to fail at runtime.
  - **Local:** not required for normal development. Only required if an operator manually runs the auto-close script locally for replay/recovery.
- **Fail-closed implications when missing:** `linear-auto-close` job fails; the workflow is not in main's required-check set, so this does not block merges. Linear drift accumulates silently until the token is restored, which is a known acceptable degradation (the close intent is derivable from merge SHA at any later point).
- **Rotation:** after rotation, re-run `pnpm ops:ci-doctor -- --scope secrets` locally to confirm the new secret existence.

### 3.3 `FIBERY_API_URL`

- **Required:** Yes for Fibery PR and merge sync workflows.
- **Scope:** Repo-level secret. Stores the Fibery workspace API URL, for example `https://unit-talk.fibery.io`.
- **Used by:** `.github/workflows/fibery-sync-on-pr.yml` and `.github/workflows/fibery-sync-on-merge.yml`.
- **Local vs CI:**
  - **CI:** required when Fibery sync is not bypassed by the `fibery-sync-bypass-approved` label.
  - **Local:** required for live `pnpm ops:fibery-sync`; not required for `--dry-run`.
- **Fail-closed implications when missing:** Fibery sync fails before any entity update is attempted. PR and merge checks remain red until the secret is configured or an approved bypass label is applied.
- **Rotation:** after changing the workspace URL, re-run `pnpm ops:ci-doctor -- --scope secrets` locally with a valid `GITHUB_TOKEN`.

### 3.4 `FIBERY_API_TOKEN`

- **Required:** Yes for Fibery PR and merge sync workflows.
- **Scope:** Repo-level secret. Token must have permission to query and update the configured Unit Talk Fibery databases.
- **Used by:** `.github/workflows/fibery-sync-on-pr.yml` and `.github/workflows/fibery-sync-on-merge.yml`.
- **Local vs CI:**
  - **CI:** required when Fibery sync is not bypassed by the `fibery-sync-bypass-approved` label.
  - **Local:** required for live `pnpm ops:fibery-sync`; not required for `--dry-run`.
- **Fail-closed implications when missing:** Fibery sync cannot resolve or update audit entities, so the PR or merge sync check fails.
- **Rotation:** rotate in Fibery first, update the GitHub secret, then re-run `pnpm ops:ci-doctor -- --scope secrets` locally with a valid `GITHUB_TOKEN`.

### 3.5 `SUPABASE_ACCESS_TOKEN`

- **Required:** Conditionally required — only when a PR modifies files under `supabase/migrations/**`. The preview workflow's `plan` job detects migration changes and skips the `validate` job when no migrations are touched.
- **Scope:** Repo-level secret. Scoped to the Supabase management API (create/delete preview branches, fetch branch credentials, apply migrations via CLI).
- **Used by:** `.github/workflows/supabase-pr-db-branch.yml` (`validate` and `teardown` jobs).
- **Companion variables (not secrets):**
  - `vars.SUPABASE_PROJECT_REF` — repo variable, must be set to `zfzdnfwdarxucxtaojxm`. Not a secret; tracked outside this inventory.
- **Local vs CI:**
  - **CI:** required for PRs that touch migrations. Missing token causes an explicit `::error::` from the workflow's validation step.
  - **Local:** not used by ci-doctor itself. Developers running migrations locally use separate env-loaded credentials from `local.env`, not this CI secret.
- **Fail-closed implications when missing:** any migration PR fails the `Supabase PR DB Branch / validate` job with a clear error. This is intentional: migrations must not merge without preview-branch validation. No silent degradation.
- **Related churn history:**
  - Commit `1212856` — quoted env parsing (fixed by `sed -E 's/^([A-Z][A-Z0-9_]*)="(.*)"$/\1=\2/'`). `ci-doctor` check `CV3` enforces.
  - Commit `36d9f75` — pooled DB URL for migration validation. `ci-doctor` check `CV4` enforces.
  - Commit `af8e403` — selective-use documentation. `ci-doctor` check `CV6` enforces.

---

## 4. What is NOT in the inventory

The following are intentionally excluded and must stay out of the fenced JSON block:

### 4.1 Workflow-local placeholder env vars

The `ci.yml` `verify` job writes a `local.env` file with empty placeholder values for `LINEAR_API_TOKEN`, `NOTION_TOKEN`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_ANNOUNCEMENT_CHANNEL_ID`, and `OPENAI_API_KEY`. These are **not** `${{ secrets.* }}` references; they are empty strings used to satisfy `@unit-talk/config` validation in CI mode. Including them here would cause `CS3` to fail because they are not actually configured as GitHub secrets.

**Note:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` were previously excluded here because `ci.yml` used them as placeholder env vars. They are now included in §2 because `proof-regression.yml` also references them as actual `${{ secrets.* }}` references (guarded by `HAS_SUPABASE`). The `ci.yml` placeholder usage remains excluded per the above rule — those are not `${{ secrets.* }}` references and are not counted by `CW6`.

### 4.2 Repository variables

`SUPABASE_PROJECT_REF` is a `vars.*` reference, not `secrets.*`. Repository variables have a separate surface and are not part of this inventory.

### 4.3 Operator-local secrets

Secrets used only by local development (Supabase service role key loaded from `local.env`, OpenAI keys for local agent runs, etc.) are not GitHub Actions secrets and are out of scope for this file. They live in `local.env` per the `@unit-talk/config` loader order (`local.env` → `.env` → `.env.example`).

### 4.4 Deferred / planned secrets

None at this time. When a future workflow introduces a new secret reference, it must be added here in the same commit that introduces the workflow change, or `CW6` will fail closed.

---

## 5. Change procedure

1. Adding a secret reference to a workflow: in the same PR, add the secret name and full metadata block to the fenced JSON in §2 and provide the detail block in §3. Configure the secret in the GitHub repo before merge.
2. Removing a secret reference from a workflow: in the same PR, remove the entry from §2 and §3. Delete the secret from the GitHub repo in a follow-up, not in the same PR, to avoid transient `CS2` failures on the feature branch.
3. Renaming: treat as add-then-remove across two commits with overlap to keep `ci-doctor` green.

All changes are validated by running `pnpm ops:ci-doctor -- --scope secrets` locally before pushing.

---

## 6. Related documents

| Topic | Document |
|---|---|
| ci-doctor spec | `docs/05_operations/CI_DOCTOR_SPEC.md` |
| Required CI checks (companion inventory) | `docs/05_operations/REQUIRED_CI_CHECKS.md` |
| Supabase preview-branch selective-use policy | `docs/ops/SUPABASE_PREVIEW_BRANCH_VALIDATION.md` |
| Execution truth model | `docs/05_operations/EXECUTION_TRUTH_MODEL.md` |
| Preflight spec | `docs/05_operations/PREFLIGHT_SPEC.md` |
