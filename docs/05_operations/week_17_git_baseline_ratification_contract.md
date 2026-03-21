# Week 17 Contract: Git Baseline Ratification

## Metadata

| Field | Value |
|---|---|
| Week | 17 |
| Sprint | SPRINT-WEEK17-GIT-BASELINE-RATIFICATION |
| Type | Governance / Git baseline |
| Status | RATIFIED |
| Ratified | 2026-03-21 |

## Objective

Create the first clean Git commit for the `unit-talk-v2` repository from an audited, verified, and truthful repo state. This establishes the post-salvage baseline from which all future app-layer and runtime buildout work proceeds.

## Context

Weeks 6 through 16 built the V2 repo incrementally without Git version control. The repo now contains:
- 5 apps (api, discord-bot, operator-web, smart-form, worker)
- 3 shared packages (contracts, domain, verification)
- 7 Supabase migrations
- Full governance/status/operations documentation for Weeks 6-16
- 491 passing tests across domain, verification, API, and operator-web
- All pure-computation salvage from the legacy repo is complete

No commits exist. This week creates the first one.

## Scope

1. Audit the working tree for correctness, noise, and secrets
2. Fix `.gitignore` to exclude proof artifacts and operational noise
3. Verify all 6 gates pass (test, test:db, lint, type-check, build, verify)
4. Verify status docs reflect implemented reality
5. Stage only intended source, config, docs, and migrations
6. Create the initial baseline commit
7. Update status docs to reflect Week 17 closeout

## Non-Goals

- No new feature implementation
- No new domain module porting
- No runtime behavior changes
- No schema migrations
- No Discord routing changes
- No broad code refactoring
- No tag creation (first commit, not a release)
- No remote push (operator decision)

## Acceptance Criteria

- [ ] `.gitignore` excludes `out/`, `.week9-proof.json`, and other noise
- [ ] All 6 verification gates pass at time of commit
- [ ] Status docs accurately reflect Week 16 CLOSED and Week 17 baseline
- [ ] No secrets (`.env`, `local.env`, credentials) are staged
- [ ] No generated artifacts (`dist/`, `node_modules/`, `*.tsbuildinfo`) are staged
- [ ] No proof/operational artifacts (`out/`, `.week9-proof.json`) are staged
- [ ] The commit message accurately describes what this baseline represents
- [ ] The commit exists on `main`

## Git-Specific Verification Gates

| Gate | Command | Required |
|---|---|---|
| Tests | `pnpm test` | 491/491 |
| DB tests | `pnpm test:db` | 1/1 |
| Lint | `pnpm lint` | clean |
| Type check | `pnpm type-check` | clean |
| Build | `pnpm build` | clean |
| Verify | `pnpm verify` | 491/491 |

## What This Commit Represents

This initial commit is the audited, verified baseline of the Unit Talk V2 platform after:
- Weeks 1-5: monorepo bootstrap, CI, contracts, Supabase, submission/lifecycle/outbox/worker
- Week 6: promotion runtime
- Week 7: Best Bets live activation
- Week 8: settlement implementation
- Week 9: full lifecycle proof
- Week 10: operator command center
- Week 11: trader-insights activation
- Week 12: settlement hardening
- Week 13: operator trader-insights health
- Week 14: verification control plane salvage
- Week 15: probability/devig math salvage
- Week 16: settlement downstream truth + full pure-domain salvage (Batches 1-5)

It is the trustworthy starting point for post-salvage app-layer buildout.
