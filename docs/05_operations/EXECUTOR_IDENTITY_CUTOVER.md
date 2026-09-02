# Executor Identity Cutover — UTV2-1572

Dated record of the executor GitHub-identity separation. Phase A is the only phase this
document currently records; later phases append their own dated sections and never rewrite
earlier ones.

Related: `docs/05_operations/policies/GITHUB_APP_MANIFESTS_PR1.md` (App spec),
`.github/workflows/merge-gate.yml` (authority gate), `scripts/ops/executor-app-token.ts`
(token minting), `scripts/ops/merge-gate-verdict.cjs` (authority rules).

---

## Phase A — 2026-09-02

**Status:** cut over on the merge date of the UTV2-1572 Phase A PR (see the proof bundle under
`docs/06_status/proof/UTV2-1572/` for the merge SHA). Everything before that merge is
**presumptively ambiguous**: any GitHub activity attributed to `griff843` before the cutover
may have been performed by a human or by an executor, and no historical record may be
reinterpreted as one or the other.

### Identity

| Item | Value |
| --- | --- |
| GitHub App | `unit-talk-executor` |
| App ID | 4806091 |
| Installation ID | 158513661 (installed on `griff843/Unit-Talk-v2` only) |
| Attribution login | `unit-talk-executor[bot]` (`user.type: "Bot"`) |
| Private key location (local) | operator-held file, mode 0600, referenced by `EXECUTOR_APP_PRIVATE_KEY_PATH`; never in the repo, env files, proof, or model output |
| Private key location (CI) | repository secret `EXECUTOR_APP_PRIVATE_KEY` (with `EXECUTOR_APP_ID`); no workflow consumes it yet in Phase A |
| Token lifetime | GitHub installation tokens: 1 hour. Cached at `EXECUTOR_APP_TOKEN_CACHE_PATH` (default `~/.config/unit-talk/secrets/unit-talk-executor.token.json`, mode 0600) and re-minted when fewer than 5 minutes remain |

### What Phase A changed

1. **Token minting** — `pnpm ops:executor-app-token {status|mint|exec}` mints short-lived
   installation tokens from an RS256 App JWT signed in-process. `status` never prints
   secrets; `mint` prints the token only with the explicit `--print-token` flag; `exec` runs
   one command with `GH_TOKEN`/`GITHUB_TOKEN` set to a fresh token and never falls back to the
   ambient identity.
2. **One executor write path migrated** — the merge-train's EXECUTOR_RESULT re-post
   (`defaultRepostExecutorResult` in `scripts/ops/ops-merge-wrapper.ts`) now posts as
   `unit-talk-executor[bot]` when the App is configured. Its outcome text states which
   identity was used. A configured App whose mint fails is an error, never a silent fallback
   to the human identity.
3. **Mechanical rejection of executor-authored PM authority artifacts** (`merge-gate.yml` via
   `merge-gate-verdict.cjs`):
   - `t1-approved` carries authority only if its most recent `labeled` event was performed
     by a human (non-Bot) CODEOWNERS member. An App/automation-applied label fails the gate.
   - `pm-verdict/v1` comments from any Bot account (the executor App included) were already
     rejected for T1; this is now covered by explicit tests naming `unit-talk-executor[bot]`.
   - T2 GitHub review approvals from Bot accounts are ignored.
   - T2 EXECUTOR_RESULT self-attestation is accepted from exactly `unit-talk-executor[bot]`
     (the migrated path) or, until Phase B, a human CODEOWNERS member. Never any other bot.
4. **Configuration** — `EXECUTOR_APP_ID`, `EXECUTOR_APP_INSTALLATION_ID`,
   `EXECUTOR_APP_PRIVATE_KEY_PATH` (local) / `EXECUTOR_APP_PRIVATE_KEY` (CI), optional
   `EXECUTOR_APP_TOKEN_CACHE_PATH`, and the rollback switch `EXECUTOR_APP_DISABLED`.

### What Phase A deliberately did NOT change

- The `griff843` credential (`gh` login and `SYNC_BOT_TOKEN`) remains in executor runtime
  and is still used by every other executor write path (branch push, PR open, lane
  closeout, ledger refresh, reconcile). Removing it is Phase B work, gated on every path
  being migrated with rollback tested.
- `SYNC_BOT_TOKEN` is unchanged.
- `enforce_admins` stays off; no protected-main bypass is granted to the App; protected-main
  persistence is unchanged.
- UTV2-1525 / UTV2-1818 scope is untouched.

### Rollback

Unset `EXECUTOR_APP_ID` or set `EXECUTOR_APP_DISABLED=1` in the executor's environment
(`local.env` locally). Effects, all verified in the Phase A proof:

- `ops:executor-app-token status` reports `configured: false` with the reason.
- `ops:executor-app-token mint|exec` exit non-zero with `executor_app_disabled` /
  `executor_app_not_configured` instead of running under any other identity.
- The merge-train re-post uses the pre-Phase-A ambient `gh` identity and its outcome text
  says `executor App not used: …`.
- Merge Gate rules are identity-based, not switch-based, so they are unaffected by rollback;
  they only ever reject Bot-authored authority artifacts, which is safe in both states.

No data migration is involved; rollback is instantaneous and reversible.

### Findings recorded at cutover

- **App permission drift.** The live installation token reported permissions
  `actions: write`, `checks: read`, `contents: write`, `issues: write`, `metadata: read`,
  `pull_requests: write`, `workflows: write`. The ratified manifest
  (`GITHUB_APP_MANIFESTS_PR1.md`) specifies only Contents RW, Pull requests RW, Checks RO,
  Metadata RO. `actions: write` and `workflows: write` exceed least privilege and must be
  removed in the App settings by the owner (UI-only action). Phase A does not depend on
  them; `issues: write` is what allows the App to comment on and label PRs, so tightening
  it must be tested against the migrated re-post path first.
- **Live rejection drill is post-merge.** Merge Gate evaluates each PR with the workflow
  and helper as they exist on `main`, so the label-actor rule cannot be exercised live on
  the PR that introduces it. The drill (executor App applies `t1-approved` under PM
  supervision → gate fails; PM re-applies → gate passes) is the first action of Phase B
  and must be recorded here with its PR number and check-run URL.

### Phase B preconditions (not started)

Migrate the remaining executor write paths one at a time with the same rollback discipline;
retire the human-CODEOWNERS branch of T2 self-attestation; then remove the `griff843`
credential from executor runtime. `enforce_admins` and `SYNC_BOT_TOKEN` retirement remain
gated on UTV2-1525 and UTV2-1818.
