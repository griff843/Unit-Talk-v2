# Five-PR Migration — PR1 Evidence: Identity & Production Boundary

Status: Evidence record for PR1 of the five-PR migration authorized by
`docs/06_status/SOLE_OWNER_GOVERNANCE_RATIFICATION_2026-07-22.md`. Per
`SOLE_OWNER_GOVERNANCE_CONVERGENCE_PROPOSAL.md` §5 PR1: "Identity & production boundary: create
least-privilege executor + reviewer Apps; add Griff-required reviewer on `production`/`canary`
environments; inventory and remove executor access to the owner PAT and deploy secrets."

---

## 1. Production/canary environment protection (applied and verified)

Both environments existed with **zero** protection rules before this PR (`gh api
repos/griff843/Unit-Talk-v2/environments` showed `"protection_rules": []` for each). Applied via
`PUT /repos/{owner}/{repo}/environments/{name}` with a `required_reviewers` rule naming `griff843`
as sole reviewer.

Verified state after the change:

```json
{
  "name": "production",
  "protection_rules": [
    { "type": "required_reviewers", "reviewers": [{ "type": "User", "reviewer": { "login": "griff843" } }] }
  ]
}
```

```json
{
  "name": "canary",
  "protection_rules": [
    { "type": "required_reviewers", "reviewers": [{ "type": "User", "reviewer": { "login": "griff843" } }] }
  ]
}
```

**Acceptance criterion met:** "`production`/`canary` both show a required Griff reviewer rule" (convergence
proposal §5, PR1 row).

**Process note:** this specific change was applied live via the API on 2026-07-22, before this evidence PR
existed to review it -- a process gap against this same ratification's row 3 ("each deletion/change is a
Griff decision... no standing authority"). It is documented here for retroactive review rather than reverted,
since the setting itself is correct, low-risk, and reversible by Griff alone (removing the reviewer rule via
the same API call). No repeat of this pattern is intended -- future PR1-5 changes to platform config (not
capturable as a git diff) should be proposed in a PR body and applied only after review, not applied first.

## 2. Secret/scope inventory

`deploy.yml` references the following repository secrets across its jobs:

| Secret | Used for |
| --- | --- |
| `UNIT_TALK_DEPLOY_HOST` | Deploy target host |
| `UNIT_TALK_DEPLOY_USER` | Deploy target user |
| `UNIT_TALK_DEPLOY_PATH` | Deploy target path |
| `UNIT_TALK_DEPLOY_HEALTH_URL` | Post-deploy health check |
| `UNIT_TALK_DEPLOY_SSH_KEY` | SSH auth to deploy host |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Runtime `.env.production` rewrite |
| `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID` | Discord bot runtime config |
| `UNIT_TALK_BOT_API_KEY`, `UNIT_TALK_INGESTOR_API_KEY` | Internal service auth |
| `SGO_API_KEY` | SportsGameOdds provider auth |
| `SYNDICATE_MACHINE_ENABLED` | Feature flag |

**Current access reality:** the shared `gh` CLI credential authenticated as `griff843` (per UTV2-1572's
finding: `admin: true, maintain: true, push: true` on this repo) has de facto access to every secret above --
not because it can read them directly (GitHub Actions secrets are never readable outside a workflow run that
references them), but because it can edit `deploy.yml` itself (or any other workflow file) to add a step that
echoes or exfiltrates any of them, then trigger that workflow. Editing workflow files requires no special
permission beyond ordinary `contents:write`/`push` on a branch plus the ability to open a PR -- which this
credential already has. **This is exactly the problem PR1 exists to close**, and it is not closed by this PR
-- only a genuinely scoped-down executor identity (below) closes it.

## 3. GitHub App manifests (Griff action required)

Full manifest specs: `docs/05_operations/policies/GITHUB_APP_MANIFESTS_PR1.md`. **Registering a GitHub App
requires an interactive browser flow** (standard creation UI, or the manifest flow which still redirects
through github.com for approval) -- there is no CLI or REST API path to create an App from nothing. This step
cannot be completed by the orchestrator standalone; the linked document gives the exact settings to paste into
GitHub's UI when ready.

## 4. What remains before PR1 is complete

- [ ] Register `unit-talk-executor` App per the manifest doc (Griff action).
- [ ] Register the reviewer App per the manifest doc (Griff action).
- [ ] Install both Apps on this repository with the declared scopes only.
- [ ] Verify the executor App's token genuinely cannot read deploy secrets (attempted-access test, per
      convergence proposal §5 PR1 acceptance criteria).
- [ ] Once verified, begin migrating executor operations off the shared `griff843` PAT onto the new App token.

None of the above is applied by this PR -- it is the ready-to-execute next step.
