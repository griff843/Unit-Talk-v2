# UTV2-1627 — Verification

**Source head:** `d46463d6cc16c63fb099f2b99b92322b31a58071`
**Tier:** T1 · **Lane type:** governance

## What this lane fixes

CI and proof fixtures could write to the production Supabase project. On
2026-07-29 this was not hypothetical: 310 test-fixture `picks` rows (plus
audit_log, submissions, outbox rows) were written to production
`zfzdnfwdarxucxtaojxm` by lane test runs.

## Findings closed

| ID | Fix |
|---|---|
| P0-1 | `ci.yml` guard ran inside `if [ -n "$SUPABASE_SERVICE_ROLE_KEY" ]` — never exported, permanently dead. Now unconditional. |
| P0-1b | Guard read `process.env` only; credentials live in `local.env`. Now resolves the same config the clients use. |
| P0-2 | Inventory gate asserted string presence. Now asserts guard reachability and ordering. |
| P0-3 | Proof cited a command referencing two test files deleted at `374580a2`; manifest locked the same dead paths. Both corrected. |
| P1-4 | Guard was invoked by 1 of 49 credentialed tests. Now enforced at `createDatabaseConnectionConfig`, which every service-role client passes through. |
| P1-5 | Production service-role key removed from `pull_request`-triggered `proof-regression.yml` and `shadow-parity-required.yml`; anon key instead, so RLS enforces read-only. |
| P1-9 | Custom-domain, proxy/tunnel, and malformed-project-ref bypasses now fail closed. |
| — | `supabase db push` (DDL) ran before any identity check. Isolation now asserted in a preceding step. |

## Verification performed

**No production-bound verification was run.** `pnpm verify` was deliberately
not executed: its `test:live-db` phase is production-bound, which is the defect
this lane removes. Containment during all work: production credentials relocated
to `~/.unit-talk-secrets/` (0700/0600), every checkout credential-free,
`SUPABASE_URL` resolving to `http://127.0.0.1:1`, **0 production writes**.

| Command | Result |
|---|---|
| `npx tsx --test scripts/ci/required-db-smoke.test.ts` | 38 pass / 0 fail (was 30) |
| `npx tsx --test packages/db/src/*.test.ts` | 244 pass / 0 fail |
| `pnpm test:ops` | 1298 pass / 0 fail |
| `pnpm test:apps-api-core` | 422 pass / 0 fail |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npx eslint <changed files>` | clean |

### Mutation suite — 6/6 killed, 0 survived

| Mutation | Outcome |
|---|---|
| M4 delete missing-URL throw | KILLED (previously survived) |
| M7 case-sensitive production detection | KILLED (previously survived) |
| Drop malformed declared-ref validation | KILLED |
| Restore "no URL ref means isolated" bypass | KILLED |
| Remove boundary assertion from `createDatabaseConnectionConfig` | KILLED |
| Make test-runner detection always false | KILLED |

## Notes

The new reachability gate immediately flagged `proof-gate.yml` and
`t1-proof-gate.yml`. Both were investigated and confirmed **false positives**:
their `pnpm ci:db-smoke` sits in a legitimate if/else whose condition is
genuinely computed, and `ci:db-smoke` is itself the guarded entrypoint. The rule
was tightened to the property that actually matters — a guard inside a
conditional fails only when a mutation can still run unconditionally — and
quoted spans and `echo` lines are stripped so an auditor argument
(`--require-executed-command "pnpm test:db"`) or a summary table is not mistaken
for execution.

Implemented directly by Claude after three Codex rounds produced no source
changes.
