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
- [ ] Writable live-DB proof is blocked because the authorized staging DB lacks the prerequisite
      WNBA catalog migration; the unsupported-sport replay reaches `picks_sport_id_fkey`.

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

Protected staging CI subsequently resolved the approved target in run `38557281798`. Its DB smoke
passed, but the unchanged UTV2-1954 unsupported-WNBA replay failed at submission:

```text
process_submission_atomic failed: insert or update on table "picks" violates foreign key
constraint "picks_sport_id_fkey"
# tests 5
# pass 4
# fail 1
```

This is the work order's migration-order hazard: once this runtime derives `WNBA`, the target DB
must already contain the WNBA sport row from `20261010170100_wnba_participant_catalog.sql`. No
migration was applied by this lane.

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
- [x] Exact-head CI accepts the lane manifest and required proof paths. Its first file-scope run
      rejected only the local work-order source, which was then removed from the PR diff.
- [ ] `pnpm test:db`: exit 1 at the staging target-identity guard above; protected staging CI is
      required.
- [ ] Protected staging run `38557281798` passed DB smoke, then the unchanged unsupported-sport
      replay passed 4/5 and failed its WNBA case at `picks_sport_id_fkey`; the prerequisite WNBA
      catalog migration is absent from staging.
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
