# PROOF: UTV2-1646

MERGE_SHA: 69cc1f7b58068408c00e646096bae6668c2aecd2

That SHA is the implementation commit on this branch (an ancestor of the PR
head), per `executor-result-validator.yml`'s documented allowance. It is
rebound to the real squash-merge SHA post-merge by `post-merge-lane-close.yml`
via `ops:proof-generate --merge-sha`.

## Summary

Sub-scope of UTV2-1601 (P0 delivery restoration command), identified while
preparing a genuinely-parked production deploy of current `main`.

`SYNDICATE_MACHINE_ENABLED=false` (parsed by `packages/config/src/env.ts`'s
`parseSyndicateMachineMode`) only suppresses 6 producer schedulers *inside the
API process* (`apps/api/src/scheduler-policy.ts`). It never touched three
other things `.github/workflows/deploy.yml` wrote into `.env.production` on
every deploy, parked or not:

- `UNIT_TALK_INGESTOR_AUTORUN=true` — hardcoded literal. The ingestor
  container kept polling live SGO/Odds APIs regardless of mode.
- `UNIT_TALK_INGESTOR_SCHEDULING_ENABLED=true` and `UNIT_TALK_WORKER_AUTORUN=true`
  — hardcoded literals. The worker kept claiming/attempting delivery for any
  outbox row not separately kill-switched.
- `UNIT_TALK_ENABLED_TARGETS=${_enabled_targets:-best-bets}` — fell back to the
  literal `best-bets` (a real, live public target) whenever the
  `UNIT_TALK_ENABLED_TARGETS` secret was unset, in *either* mode.

## Fix

In both the canary and production `.env.production` writer steps
(`.github/workflows/deploy.yml`), folded all four into the existing
`SYNDICATE_MACHINE_MODE` case statement:

```
active)
  SYNDICATE_MACHINE_ENABLED=true
  _ingestor_autorun=true
  _ingestor_scheduling_enabled=true
  _worker_autorun=true
  ;;
parked)
  SYNDICATE_MACHINE_ENABLED=false
  _ingestor_autorun=false
  _ingestor_scheduling_enabled=false
  _worker_autorun=false
  ;;
```

and, after the existing distribution-target resolution logic:

```
if [ "$SYNDICATE_MACHINE_MODE" = "parked" ]; then
  _enabled_targets="none"
elif [ -z "$_enabled_targets" ]; then
  _enabled_targets="best-bets"
fi
```

so parked mode can never resolve `UNIT_TALK_ENABLED_TARGETS` to a real target
regardless of the secret's value, while active mode's fallback semantics are
byte-for-byte unchanged.

Extended the **production** stage's "Confirm syndicate machine gate in
production container" step to inspect the running `ingestor` and `worker`
containers directly via `docker compose exec -T <service> printenv <VAR>` and
hard-fail if any diverge from the requested posture — the deployed-SHA-bound
container-truth proof for the whole parked contract, not just
`SYNDICATE_MACHINE_ENABLED`. This was deliberately **not** added to canary's
confirm step: canary's "Release API canary" step only starts the `api`
service (`docker compose up -d --no-deps api`); ingestor/worker never run
during canary, so asserting against them there would prove nothing.

## Verification

- `pnpm type-check` — PASS
- `pnpm lint` — PASS
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))"` — PASS (well-formed YAML after edits)
- `npx tsx --test scripts/ci/deploy-parked-mode.test.ts` — 10/10 pass (5 pre-existing + 5 new drift-detection tests added by this lane)
- `pnpm test` (full composite suite) — 4381/4381 pass, 0 fail

## ASSERTIONS:

- [x] `UNIT_TALK_INGESTOR_AUTORUN` is written as `$_ingestor_autorun` (mode-derived), never a hardcoded literal, in both canary and production env writers.
- [x] `UNIT_TALK_INGESTOR_SCHEDULING_ENABLED` is written as `$_ingestor_scheduling_enabled` (mode-derived), never a hardcoded literal.
- [x] `UNIT_TALK_WORKER_AUTORUN` is written as `$_worker_autorun` (mode-derived), never a hardcoded literal.
- [x] `UNIT_TALK_ENABLED_TARGETS` resolves to exactly `none` in parked mode regardless of the `UNIT_TALK_ENABLED_TARGETS` secret's value; active mode's prior fallback (`best-bets` when unset) is unchanged.
- [x] The production confirmation step inspects the live `ingestor` and `worker` containers (service names cross-checked against `deploy/production/docker-compose.yml`) for all four vars and hard-fails on any divergence from the requested parked/active posture.
- [x] Canary's confirmation step is unchanged (still checks only `SYNDICATE_MACHINE_ENABLED` via the `api` container) since ingestor/worker never run during canary.
- [x] `scripts/ci/deploy-parked-mode.test.ts` extended with 5 new tests that mutate the corrected source back toward each specific piece of the old defect and assert the static audit catches it.
- [x] `pnpm type-check`, `pnpm lint`, and the full `pnpm test` composite suite are all green with zero failures.

## EVIDENCE:

```text
$ npx tsx --test scripts/ci/deploy-parked-mode.test.ts
TAP version 13
# Subtest: deploy workflow has one fail-closed parked-mode contract across every gate
ok 1 - deploy workflow has one fail-closed parked-mode contract across every gate
# Subtest: canonical deploy validator accepts parked and active modes with truthful output
ok 2 - canonical deploy validator accepts parked and active modes with truthful output
# Subtest: canonical deploy validator rejects missing, case-variant, padded, and unknown values
ok 3 - canonical deploy validator rejects missing, case-variant, padded, and unknown values
# Subtest: static deploy audit detects canary or production mode drift
ok 4 - static deploy audit detects canary or production mode drift
# Subtest: static deploy audit detects a hardcoded active-mode receipt
ok 5 - static deploy audit detects a hardcoded active-mode receipt
# Subtest: static deploy audit detects a hardcoded UNIT_TALK_INGESTOR_AUTORUN
ok 6 - static deploy audit detects a hardcoded UNIT_TALK_INGESTOR_AUTORUN
# Subtest: static deploy audit detects a hardcoded UNIT_TALK_WORKER_AUTORUN
ok 7 - static deploy audit detects a hardcoded UNIT_TALK_WORKER_AUTORUN
# Subtest: static deploy audit detects UNIT_TALK_ENABLED_TARGETS falling back to best-bets instead of forcing none in parked mode
ok 8 - static deploy audit detects UNIT_TALK_ENABLED_TARGETS falling back to best-bets instead of forcing none in parked mode
# Subtest: static deploy audit detects a missing production ingestor/worker container confirmation
ok 9 - static deploy audit detects a missing production ingestor/worker container confirmation
# Subtest: static deploy audit detects a missing parked-mode UNIT_TALK_ENABLED_TARGETS container assertion
ok 10 - static deploy audit detects a missing parked-mode UNIT_TALK_ENABLED_TARGETS container assertion
1..10
# tests 10
# pass 10
# fail 0

$ pnpm test 2>&1 | grep -E "^# (tests|pass|fail) " | awk '{sum+=$3} END {print sum}' (run three times, once per summary field)
tests: 4381
pass: 4381
fail: 0

$ grep -n "^  [a-z-]*:" deploy/production/docker-compose.yml
13:  api:
36:  worker:
60:  ingestor:
89:  discord-bot:
113:  grading-cron:
138:  loki:
156:  grafana:
181:  caddy:
```
