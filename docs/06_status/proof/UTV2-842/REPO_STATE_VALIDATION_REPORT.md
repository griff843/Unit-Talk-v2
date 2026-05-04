# UTV2-842 Repo State Validation Report

## Run Metadata

| Field | Value |
|---|---|
| Commit SHA | `16f1d128dff1d4e4ac03771d71e782a041b66986` |
| Branch | `codex/utv2-842-repo-state-validation` from current `origin/main` |
| Node version | `v24.14.1` |
| pnpm version | `10.29.3` |
| OS | Microsoft Windows 11 Pro `10.0.26200`, build `26200`, 64-bit |
| Start time | `2026-05-04T17:08:38.7402867-04:00` |
| Clean checkout confirmation | `git status --short` returned no tracked or untracked repo changes before validation |
| Validation matrix source | `docs/06_status/repo_state_validation_matrix.md` was not present on clean `main`; commands were read from the Claude handoff copy in the original dirty workspace and classified below |
| Environment setup | First `pnpm verify` failed because clean checkout had no gitignored `local.env`; copied `.env.example` to gitignored `local.env` and reran. `git status --short --ignored local.env` showed `!! local.env`. |

## Summary Verdict

**PASS-with-known-blockers**

The clean current `main` checkout composes for static repo health: install, lint, type-check, build, aggregate verify, app/domain/ops/QA suites, command-manifest checks, and fixture-backed replay tests all pass. No static product regression was found. The remaining non-green items are known environment/live-data blockers: `proof:settlement-clv` requires Supabase credentials and fresh settlement/CLV data, and `test:db` skipped its smoke test because Supabase credentials were intentionally unavailable. The excluded blockers UTV2-780, UTV2-433, UTV2-652, and UTV2-770 are not counted as repo failures.

## Command Results

| Cluster | Command | Result | Classification | Notes |
|---|---|---|---|---|
| Starting state | `git status --short` | PASS | Static validation | Clean before validation. |
| Starting state | `git rev-parse HEAD` | PASS | Static validation | `16f1d128dff1d4e4ac03771d71e782a041b66986`. |
| Starting state | `node --version` | PASS | Static validation | `v24.14.1`. |
| Starting state | `pnpm --version` | PASS | Static validation | `10.29.3`. |
| Starting state | OS/date metadata commands | PASS | Static validation | Windows 11 Pro; run started `2026-05-04T17:08:38.7402867-04:00`. |
| Setup | `pnpm install --frozen-lockfile` | PASS | Static validation | Lockfile frozen; packages installed. |
| Gate | `pnpm verify` | FAIL then PASS | Environment setup, then static pass | First run failed on missing gitignored `local.env`; after local scaffold, full verify passed. |
| Gate | `pnpm lint` | PASS | Static validation | ESLint passed. |
| Gate | `pnpm type-check` | PASS | Static validation | TypeScript project references passed. |
| Gate | `pnpm build` | PASS | Static validation | Project references build passed. |
| API/Domain Lifecycle | `pnpm test:apps-api-core` | PASS | Static validation | All API core lifecycle/domain tests passed. |
| Settlement/Grading/CLV | `pnpm test:apps-api-core` | PASS | Static validation | Settlement, grading, CLV unit coverage passed inside API core. |
| Settlement/Grading/CLV | `pnpm proof:settlement-clv` | FAIL | Live-data blocker | Requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`; no credentials in clean validation env. |
| Ingestion/Provider Freshness | `pnpm test:apps-rest` | PASS | Static validation | Ingestor, worker, Discord bot, config, db contract suites passed. |
| Ingestion/Provider Freshness | `tsx --test scripts/utv2-796-slate-replay.test.ts` | FAIL | Tooling environment gap | Direct `tsx` binary not on PowerShell PATH; repo-local rerun passed via `pnpm exec tsx`. |
| Ingestion/Provider Freshness | `pnpm exec tsx --test scripts/utv2-796-slate-replay.test.ts` | PASS | Static validation | Fixture-backed slate replay passed: 3 tests, 0 failures. |
| Command-Center/Smart-Form | `pnpm test:smart-form` | PASS | Static validation | Smart Form schema, client, auth config, boundary tests passed. |
| Command-Center/Smart-Form | `pnpm test:apps-api-core` | PASS | Static validation | Canonical write contract included and passed. |
| Discord Bot/QA Agent | `pnpm test:apps-rest` | PASS | Static validation | Discord bot foundation and manifest tests passed inside apps-rest. |
| Discord Bot/QA Agent | `pnpm test:qa-agent` | PASS | Static validation | QA agent suite passed: 15 tests, 0 failures. |
| CI/Governance/Tooling | `pnpm test:ops` | PASS | Static validation | Ops/CI/tooling suite passed: 125 tests, 0 failures. |
| CI/Governance/Tooling | `pnpm test:verification` | PASS | Static validation | Verification package passed: 27 tests, 0 failures. |
| CI/Governance/Tooling | `pnpm test:ut-cli` | PASS | Static validation | UT CLI suite passed: 9 tests, 0 failures. |
| CI/Governance/Tooling | `pnpm verify:commands` | PASS | Static validation | Discord command manifest, migration versions, migration lint passed. |
| Domain Coverage | `pnpm test:domain-probability` | PASS | Static validation | 89 tests, 0 failures. |
| Domain Coverage | `pnpm test:domain-features` | PASS | Static validation | 99 tests, 0 failures. |
| Domain Coverage | `pnpm test:domain-signals` | PASS | Static validation | 78 tests, 0 failures. |
| Domain Coverage | `pnpm test:domain-hedge` | PASS | Static validation | Hedge, consensus, CLV tuner, member lifecycle passed. |
| Domain Coverage | `pnpm test:domain-shadow` | PASS | Static validation | 19 tests, 0 failures. |
| Domain Coverage | `pnpm test:domain-analytics` | PASS | Static validation | 207 tests, 0 failures. |
| Domain Coverage | `pnpm test:domain-portfolio` | PASS | Static validation | 44 tests, 0 failures. |
| Hetzner/Security/Readiness Docs | `pnpm test:ops` | PASS | Static validation | Backup alert and DB role validator tests included and passed. |
| DB smoke | `pnpm test:db` | SKIP | known-environment-skip: no DB credentials | Exited 0 with one skipped test because Supabase credentials were blank. |

## Cluster Verdicts

### API/Domain Lifecycle

- Tested commands: `pnpm test:apps-api-core`, plus `pnpm verify`.
- Result: PASS.
- Uncovered Done-issue risks: live system-pick scanner execution, real board construction with live picks, alert-to-universe adapter outside unit harness.
- CI/test protection: protected by API core suite, golden regression tests, and aggregate `pnpm verify`.

### Settlement/Grading/CLV

- Tested commands: `pnpm test:apps-api-core`, `pnpm proof:settlement-clv`.
- Result: PASS-with-known-blockers.
- Uncovered Done-issue risks: UTV2-433 fresh MLB CLV gate; market-universe closing/null coverage; `stake_units` completeness for ROI/P&L.
- CI/test protection: settlement, grading, CLV, recap, and grading-cron unit tests pass. Live settlement/CLV proof requires credentials and fresh data.

### Ingestion/Provider Freshness

- Tested commands: `pnpm test:apps-rest`, `pnpm exec tsx --test scripts/utv2-796-slate-replay.test.ts`, `pnpm test:ops`.
- Result: PASS-with-known-blockers.
- Uncovered Done-issue risks: live SGO freshness, provider disk growth, structured network failure drills, UTV2-652 provider execution sample volume.
- CI/test protection: ingestor tests, slate replay, provider-offer partition/prune tests, and ops tests passed.

### Command-Center/Smart-Form

- Tested commands: `pnpm test:smart-form`, `pnpm test:apps-api-core`, `pnpm verify`.
- Result: PASS.
- Uncovered Done-issue risks: command-center page browser QA, Line-Shopper and Matchup Card browser proof, residual UI/manual validation.
- CI/test protection: smart-form tests, canonical API write contract, type-check, build, and verify passed.

### Discord Bot/QA Agent

- Tested commands: `pnpm test:apps-rest`, `pnpm test:qa-agent`.
- Result: PASS-with-known-blockers.
- Uncovered Done-issue risks: live Discord API/channel proof, staging pick-delivery proof, ops bot cooldown live drill, PR #490 governance drift risk.
- CI/test protection: Discord bot tests, command manifest checks, QA agent tests, and `verify:commands` passed.

### CI/Governance/Tooling

- Tested commands: `pnpm test:ops`, `pnpm test:verification`, `pnpm test:ut-cli`, `pnpm verify:commands`, `pnpm lint`, `pnpm type-check`, `pnpm build`.
- Result: PASS.
- Uncovered Done-issue risks: live PR label enforcement depends on GitHub CI context; full lane close drill not executed.
- CI/test protection: ops, verification, UT CLI, command manifest, migration version, and migration lint checks all passed.

### Hetzner/Security/Readiness Docs

- Tested commands: `pnpm test:ops`, `pnpm test:db`.
- Result: PASS-with-known-blockers.
- Uncovered Done-issue risks: Hetzner procurement/provisioning, live WAL/PITR restore, second-provider backup, private DB networking proof, security hardening drills.
- CI/test protection: static role-validator, backup-alert, deploy-check, and ops tests passed; live infra proof remains blocked by UTV2-780/manual PM decision.

## Known Blockers

### Live-Data Blockers

- UTV2-433: MLB production-readiness gate requires fresh post-fix settlement/CLV evidence.
- UTV2-652: provider execution quality requires sufficient settlement/provider sample volume.
- Score provenance remains below target: 2.6% market-backed vs. 20% needed.
- Worker DOWN/runtime-health claims require live process and DB evidence, not static test proof.
- `pnpm proof:settlement-clv` requires Supabase credentials and fresh settlement/CLV data.

### Hetzner/Provisioning Blockers

- UTV2-780: Hetzner EX44 purchase/no-purchase PM decision.
- Real Storage Box / second-provider backup proof requires provisioned infra.
- Real private DB networking and restore rehearsal require provisioned infra.

### Manual PM Blockers

- UTV2-780 final purchase/no-purchase decision.
- UTV2-770 parent gate remains open.
- Production cutover and deferred production-readiness claims remain PM/governance decisions.
- PR #490 QA trust-layer governance drift risk requires governance disposition.

## Repo Regressions

No static repo regressions found.

## Coverage Gaps

- Clean `main` did not contain `docs/06_status/repo_state_validation_matrix.md`; the matrix was available only as a Claude handoff file outside the clean checkout.
- Direct `tsx --test ...` was not available on PowerShell PATH; repo-local `pnpm exec tsx --test ...` passed.
- Settlement/CLV live proof needs credentials and fresh settlement windows.
- Command-center UI, Line-Shopper, and Matchup Card lack browser automation proof in this validation lane.
- Discord real-channel and staging pick-delivery paths remain unproved without live bot/staging infra.
- Hetzner/security docs are static-tested, but not operationally exercised.

## Recommended Next Actions

### Immediate Code/Test Fixes

- None required for product code.
- Consider committing or otherwise attaching the validation matrix artifact so future clean checkouts can reproduce the command source without relying on an untracked handoff.

### CI Hardening

- Prefer `pnpm exec tsx --test <file>` in matrix/runbook commands for Windows/repo-local reproducibility.
- Consider an explicit clean-checkout validation workflow that scaffolds `local.env` from `.env.example` before `pnpm verify`.

### Live-Data Validation

- Rerun `pnpm proof:settlement-clv` with Supabase credentials and fresh post-fix settlement/CLV samples.
- Collect fresh MLB CLV evidence for UTV2-433.
- Collect provider execution-quality evidence once sample volume is sufficient for UTV2-652.

### Hetzner/Provisioning Decisions

- Resolve UTV2-780 purchase/no-purchase decision.
- After infra exists, execute WAL/PITR restore, private DB networking, and second-provider backup proofs.

### PM/Governance Decisions

- Keep UTV2-770 open as parent gate until known blockers are resolved or explicitly accepted.
- Decide PR #490 QA trust-layer governance drift risk.
- Confirm whether PASS-with-known-blockers is sufficient for UTV2-842 closeout.

## Linear Closeout Comment Draft

Final verdict: PASS-with-known-blockers.

Report path: `docs/06_status/proof/UTV2-842/REPO_STATE_VALIDATION_REPORT.md`.

Commands run:

```bash
git status --short
git rev-parse HEAD
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm verify
pnpm lint
pnpm type-check
pnpm build
pnpm test:apps-api-core
pnpm test:apps-api-agent
pnpm test:apps-rest
pnpm test:smart-form
pnpm test:verification
pnpm test:domain-probability
pnpm test:domain-features
pnpm test:domain-signals
pnpm test:domain-hedge
pnpm test:domain-shadow
pnpm test:domain-analytics
pnpm test:domain-portfolio
pnpm test:ops
pnpm test:ut-cli
pnpm test:qa-agent
pnpm verify:commands
tsx --test scripts/utv2-796-slate-replay.test.ts
pnpm exec tsx --test scripts/utv2-796-slate-replay.test.ts
pnpm proof:settlement-clv
pnpm test:db
```

Failures/skips:

- Initial `pnpm verify` failed because clean checkout lacked gitignored `local.env`; after scaffolding `local.env` from `.env.example`, `pnpm verify` passed.
- Direct `tsx --test scripts/utv2-796-slate-replay.test.ts` failed because `tsx` is not on PowerShell PATH; repo-local `pnpm exec tsx --test scripts/utv2-796-slate-replay.test.ts` passed.
- `pnpm proof:settlement-clv` failed because Supabase credentials were not configured; classified as live-data blocker.
- `pnpm test:db` exited 0 with one skipped test; classified as `known-environment-skip: no DB credentials`.

Known blockers excluded: UTV2-780, UTV2-433, UTV2-652, and UTV2-770 parent gate remains open.

Recommended next action: PM review PASS-with-known-blockers, then schedule credentialed/live-data validation for settlement/CLV and provider execution quality after the known blockers are resolved.
