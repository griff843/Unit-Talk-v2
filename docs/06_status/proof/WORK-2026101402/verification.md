# PROOF: WORK-2026101402

MERGE_SHA: pending merge

Issue: WORK-2026101402<br>
Tier: T1<br>
Lane type: runtime<br>
Execution SHA: `3ede34fb4bb94b5642bf925aaa17c76f0b6c9992`<br>
PR: https://github.com/griff843/Unit-Talk-v2/pull/1755<br>
result: local_static_pass_staging_deferred

## ASSERTIONS:

- [x] WNBA is present in the server, mirrored client, and selector team-sport sets.
- [x] A WNBA manual submission requires two distinct participants.
- [x] An in-memory governed WNBA Track Only submission persists both canonical participant IDs,
      `sport_id = 'WNBA'`, and no outbox delivery.
- [x] Metadata `WNBA`/`wnba` and `wnba-spread`/`wnba-ml`/`wnba-total` derive WNBA without changing
      NBA derivation.
- [x] The in-memory catalog returns 10 sports and exposes WNBA basketball markets/stat types.
- [x] The unchanged alert suite confirms WNBA remains inactive.
- [ ] Writable live-DB and unsupported-sport replay proof are deferred to protected staging CI.

## EVIDENCE:

Focused issue suite:

```text
pnpm exec tsx --test 'apps/smart-form/test/api-client.test.ts' 'packages/db/src/pick-foreign-keys.test.ts'
# tests 52
# pass 52
# fail 0
# skipped 0
```

Expanded in-memory/API suite:

```text
pnpm exec tsx --test apps/smart-form/test/form-schema.test.ts apps/smart-form/test/api-client.test.ts packages/db/src/pick-foreign-keys.test.ts apps/api/src/server.test.ts
tests 193; pass 193; fail 0; skipped 0
```

Alert regression suite:

```text
pnpm exec tsx --test apps/api/src/alert-agent-service.test.ts
tests 23; pass 23; fail 0; skipped 0
```

Local writable-DB refusal (no write occurred):

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub
environment with CI_SUPABASE_* credentials.
```

The packet-required disposition is: Writable live-DB proof is blocked/deferred: target identity
could not be resolved from its URL (host=unparseable). Writable DB verification requires
`xskgrzbteyqdufktjrjx`. Run it through the staging-ci GitHub environment with `CI_SUPABASE_*`
credentials. The locally measured host was `127.0.0.1` with ref `unidentified`.

## Verification

- [x] `pnpm type-check`: exit 0.
- [x] `pnpm test`: exit 0.
- [x] `pnpm verify:static`: exit 0, including lint, type-check, build, aggregate tests, Smart Form
      verify, command-manifest verification, and migration checks.
- [x] Focused issue suite: 52 pass, 0 fail.
- [x] Expanded Smart Form/API suite: 193 pass, 0 fail.
- [x] Alert regression suite: 23 pass, 0 fail; WNBA remains inactive.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS; operator-ui
      matched; QA behavior is covered by the focused Smart Form/API suites.
- [ ] `pnpm ops:scope-diff -- --issue WORK-2026101402`: reports the separately committed lane
      manifest and four packet-required proof paths outside the eight-file implementation lock;
      this is recorded as an authorized governance-artifact exception, not hidden as a clean result.
- [ ] `pnpm test:db`: exit 1 at the staging target-identity guard above; protected staging CI is
      required.
- [ ] The unchanged unsupported-sport replay test also requires the same live DB and failed locally
      only with `TypeError: fetch failed`; its protected staging result remains pending.
- [ ] `pnpm verify`: static phase passed, then the command exited 1 when `test:live-db` reached the
      same pre-write staging target-identity guard. Protected staging CI must supply the full pass.
- [ ] PM approval, governed merge, deployment, post-migration submission, and post-merge closeout
      are explicitly outside this executor result.

No production migration, deployment, provider, Discord, delivery, or kill-switch mutation was
performed.

## Merge SHA Binding

Merge SHA: pending merge<br>
PR: https://github.com/griff843/Unit-Talk-v2/pull/1755<br>
Execution SHA: `3ede34fb4bb94b5642bf925aaa17c76f0b6c9992`
