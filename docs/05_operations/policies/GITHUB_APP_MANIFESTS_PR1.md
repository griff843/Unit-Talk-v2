# GitHub App Manifests — PR1 (Least-Privilege Executor + Reviewer Identity)

Ready-to-register settings for the two Apps required by PR1 of the five-PR migration
(`SOLE_OWNER_GOVERNANCE_CONVERGENCE_PROPOSAL.md` §4/§5, ratified by
`docs/06_status/SOLE_OWNER_GOVERNANCE_RATIFICATION_2026-07-22.md`). **Registration requires the GitHub UI or
the manifest-flow browser redirect — there is no CLI/API path to create an App from scratch.** Griff must
perform this step; everything below is the exact spec to use when doing so.

Path: **github.com → Settings → Developer settings → GitHub Apps → New GitHub App** (owner-account-level App,
since this repo is under a personal account, not an org).

---

## App 1: `unit-talk-executor`

**Purpose:** the identity Claude/Codex use to open branches, push commits, and open PRs — replacing the
shared `griff843` PAT for these operations.

| Field | Value |
| --- | --- |
| GitHub App name | `unit-talk-executor` |
| Homepage URL | `https://github.com/griff843/Unit-Talk-v2` |
| Webhook | Inactive (not needed — this App only issues installation tokens for git/PR operations, no event-driven automation) |

**Repository permissions:**

| Permission | Level | Why |
| --- | --- | --- |
| Contents | Read & write | Push commits to lane branches |
| Pull requests | Read & write | Open/update/comment on PRs |
| Checks | Read-only | Read CI status before declaring executor-result ready |
| Metadata | Read-only | Mandatory baseline permission, always included |

**Explicitly NOT granted (do not enable):**

- Administration — no branch-protection or repo-settings changes
- Actions — no workflow-file write, no workflow-run dispatch/re-run/cancel
- Secrets — Apps never get secret-read access via permissions (GitHub Actions secrets are workflow-scoped,
  not App-scoped) — this row exists to confirm the App grants no path around that
- Environments — no deployment-approval or environment-secret access
- Deployments — no deploy-dispatch capability

**Where the "non-`main`" restriction actually lives:** App permissions are repo-wide, not branch-scoped —
`contents: write` applies to every branch the token can reach. The **non-`main`** restriction comes from
existing branch protection on `main` (this repo already has `allow_force_pushes: false` and requires PRs to
land changes) plus this App holding no `Administration` permission, so it cannot alter or bypass that
protection. Confirm before first use: attempt a direct push to `main` with the App's installation token and
verify GitHub rejects it.

**Installation:** install only on `griff843/Unit-Talk-v2` (not "all repositories").

---

## App 2: `unit-talk-reviewer`

**Purpose:** the independent cross-model review identity (opposite model from whichever implemented the
change) — posts review verdicts as check runs, distinct from the executor's own identity, so a single
compromised/colluding credential cannot both author and approve the same change.

| Field | Value |
| --- | --- |
| GitHub App name | `unit-talk-reviewer` |
| Homepage URL | `https://github.com/griff843/Unit-Talk-v2` |
| Webhook | Inactive |

**Repository permissions:**

| Permission | Level | Why |
| --- | --- | --- |
| Contents | Read-only | Read the diff under review — never write |
| Pull requests | Read & write | Post review comments/verdicts |
| Checks | Read & write | Create the independent-review check-run artifact |
| Metadata | Read-only | Mandatory baseline permission |

**Explicitly NOT granted:** Administration, Actions, Contents:write, Secrets, Environments, Deployments — same
list as the executor App, plus **no Contents write at all** (this identity reviews, it never pushes).

**Installation:** install only on `griff843/Unit-Talk-v2`.

---

## After registration

1. Generate a private key for each App (App settings → "Generate a private key").
2. Store both private keys + App IDs somewhere Griff controls exclusively (not accessible to the executor's
   own token) — e.g. as repository secrets only the workflow files that need them reference, or an external
   secret store.
3. Confirm via the attempted-access test in PR1's evidence doc
   (`docs/06_status/FIVE_PR_MIGRATION_PR1_EVIDENCE.md` §4) that the executor App's installation token cannot
   read `deploy.yml`'s secrets and cannot push to `main`.
4. Only after that verification should any workflow or executor tooling begin using the new App token instead
   of the shared PAT.
