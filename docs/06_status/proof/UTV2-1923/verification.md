# PROOF: UTV2-1923

MERGE_SHA: cc57268a86c9b93ea2b5c2e9d2d0a937d0d889c8

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-17T23:23:11.000Z
Issue: UTV2-1923
Tier: T1
Lane type: runtime
Branch: claude/utv2-1923-worker-human-target-map-exemption
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1599
Head SHA: 5194341b7576eadf97776b04d12190559487bb2c
Execution SHA: 5194341b7576eadf97776b04d12190559487bb2c
Diff base: 616994604292345b9e44cfd0c91339fcbe9bcdef
result: pass

> **Increment 3.** Increment 1 (PR #1592, merge `a26894731`) built the human capper
> official-picks delivery transaction. Increment 2 repaired the worker defect that prevented
> the bounded `human-capper` mode from starting. Increment 3 repairs the second startup
> defect on the same activation path: Command Center could not start from the env file
> `deploy.yml` writes for it, and was only reachable at all because of a manual host patch
> that the next deploy would erase.

## ASSERTIONS:

Each box is an assertion a named, mutation-proven test makes. None is a restatement of intent.

### Worker — bounded `human-capper` mode can start

- [x] A human delivery target starts the worker with NO entry in `UNIT_TALK_DISCORD_TARGET_MAP`. Asserted by `createWorkerRuntimeDependencies starts a human delivery target with no shared channel mapping` (`apps/worker/src/worker-runtime.test.ts`), which builds the production worker environment with `UNIT_TALK_DISTRIBUTION_TARGETS=discord:official-picks` and an empty map, and requires `createWorkerRuntimeDependencies` not to throw.
- [x] The exemption is scoped to human delivery targets ONLY. Asserted by `createWorkerRuntimeDependencies still refuses a non-human target with no channel mapping`, which requires `discord:best-bets` with an empty map to still throw `RuntimeConfigError` with code `RUNTIME_REQUIRED_ENV_MISSING` naming that target.
- [x] The exemption uses the canonical `isHumanDeliveryTarget` predicate (`packages/contracts/src/promotion.ts:43`), not a new literal, so a target cannot be exempt at startup and governed at delivery.
- [x] A human capper delivery with no valid pinned destination still REFUSES. Unchanged from increment 1 and still asserted by `mutation control: without the destination guard, delivery falls back to a shared channel` (`apps/api/src/t1-proof-utv2-1923-human-capper-delivery.test.ts`, 44/44 pass).
- [x] The deploy-time shared-map refusal is UNCHANGED. `deploy.yml:612` (canary) and `:1411` (promote) still refuse a `discord:official-picks` entry, so the per-capper routing guarantee is intact from both directions.

### Command Center — starts from the canonical deploy path, no host edits

- [x] The exact key set `deploy.yml` writes into `.env.command-center` is sufficient. Asserted by `the env file deploy.yml writes is sufficient for the Command Center data client` (`packages/config/src/env.test.ts`), which **parses the key list out of the workflow** rather than restating it, loads it against an empty workspace root, and requires the service-role connection to build.
- [x] The canary and promote writers have not drifted apart. Same test: it extracts both `printf` blocks and requires identical key lists. That exact two-step divergence was the 2026-09-16 edge outage.
- [x] The runtime loader no longer demands workspace metadata no runtime service reads. Asserted by `loadEnvironment does not demand workspace metadata no runtime service reads`.
- [x] Credential validation still fails closed, per role. Asserted by `requireSupabaseEnvironment still fails closed on the credential each role uses`: a missing service-role key refuses for `service_role`, a missing anon key refuses for `anon`, a missing URL refuses for both, and **neither key is accepted as a substitute for the other**.
- [x] The anon key is NOT distributed to Command Center. Same test asserts `SUPABASE_ANON_KEY` is absent from the workflow's writer, matching `deploy/production/nextjs-entrypoint.sh:79` — "the anon key is not a substitute and is not used".
- [x] `scripts/validate-env.mjs` is unchanged, so a developer/CI checkout still requires the workspace metadata. The requirement was removed from the *runtime* loader only.

## MUTATION CONTROLS:

A control that cannot fail proves nothing. All four were inverted against the running suite at
this exact head, and the baseline restored byte-identical after each.

| Mutation applied | Expected | Observed |
|---|---|---|
| Remove the `isHumanDeliveryTarget` exemption from `assertDiscordTargetMapCoversTargets` | the human-target control fails | `not ok 17 - createWorkerRuntimeDependencies starts a human delivery target with no shared channel mapping` — 1 fail / 71 pass |
| Widen the exemption from `isHumanDeliveryTarget(governedTarget)` to `governedTarget !== null` | the non-human refusal control fails | `not ok 18 - createWorkerRuntimeDependencies still refuses a non-human target with no channel mapping` — 1 fail / 71 pass |
| Delete `SUPABASE_SERVICE_ROLE_KEY` from BOTH `.env.command-center` writers in `deploy.yml` | the deploy-contract control fails | `not ok 11 - the env file deploy.yml writes is sufficient for the Command Center data client` — 1 fail / 12 pass |
| Make `UNIT_TALK_LEGACY_WORKSPACE` required again in the runtime loader | the workspace-metadata controls fail | `not ok 11` and `not ok 12 - loadEnvironment does not demand workspace metadata no runtime service reads` — 2 fail / 11 pass |
| None (baseline) | all pass | worker 72 pass / 0 fail; config 13 pass / 0 fail |

Mutation 1 reproduces the exact production crash-loop. Mutation 2 proves the exemption cannot be
widened into a hole without a control firing. Mutation 3 proves the deploy-contract test is
genuinely coupled to the workflow and not self-consistent. Mutation 4 reproduces the exact
Command Center startup failure.

## RUNTIME EVIDENCE:

Both defects were found in production, not in a test.

### Worker (increment 2)

| Observation | Evidence |
|---|---|
| Defect reproduced in production | Deploy run `35278517112`, promote FAILED at `Confirm syndicate machine gate in production container`; worker container `Restarting (1)` with `RuntimeConfigError` / `RUNTIME_REQUIRED_ENV_MISSING` at `apps/worker/src/runtime.ts:284` |
| The two guards are mutually unsatisfiable | `deploy.yml:612` and `:1411` refuse the deploy when `UNIT_TALK_DISCORD_TARGET_MAP` contains `discord:official-picks`; `runtime.ts:284` refused its absence. No value of the secret satisfies both. |
| Parked mode starts only via the numeric escape hatch | production worker env `UNIT_TALK_DISTRIBUTION_TARGETS=discord:1296531122234327100`, which matches `^discord:\d+$`; `discord:official-picks` does not |
| Production restored | Rollback run `35279450108` success end to end, same SHA `616994604292345b9e44cfd0c91339fcbe9bcdef`; worker recovered `Restarting (1)` → `Up (healthy)`, now `running restarts=0` |

### Command Center (increment 3) — startup proof from an image built at this head

The canonical deploy is a reserved action, so the deploy itself was NOT run. The equivalent was
measured instead: the production image was built from this head with the production Dockerfile
and build args, and started with **exactly** the key set `deploy.yml` writes — synthesised by
parsing the workflow, ten keys, nothing else, no host edits.

| Observation | Evidence |
|---|---|
| Image builds from this head | `docker build -f deploy/production/Dockerfile.nextjs --build-arg APP_DIR=apps/command-center --build-arg APP_PACKAGE=@unit-talk/command-center --build-arg APP_PORT=4300` → exit 0 |
| Starts on the canonical env file alone | container `running restarts=0 exit=0`; `✓ Ready in 463ms` |
| Unauthenticated access refused | `GET /` → **401**, `command_center.auth_failed` / `COMMAND_CENTER_AUTH_REQUIRED` |
| Overview renders for an operator | `GET /` with `Authorization: Bearer <token>` → **200** |
| Pick inspection renders for an operator | `GET /picks` with the same credential → **200** |
| The old failure mode is gone | **0** occurrences of `Missing required env var` and **0** of `are required for Supabase` in the container log. The only errors are 3× `fetch failed`, from the deliberately unreachable fixture Supabase host — a request-time network error, not a configuration refusal. |
| Fail-closed control A | same image, `SUPABASE_SERVICE_ROLE_KEY` removed → refuses to start: `FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both required by the Command Center data client. Refusing to start.` exit 1 |
| Fail-closed control B | same image, all three auth values removed → refuses to start: `FATAL: Command Center auth is not configured.` exit 1 |
| Settlement action configuration intact | `UNIT_TALK_CC_API_KEY` and `UNIT_TALK_API_URL` are among the ten keys and are untouched by this diff |
| Bound to loopback only, no public route | production `unit-talk-command-center-1` publishes `{"4300/tcp":[{"HostIp":"127.0.0.1","HostPort":"4300"}]}`; `grep -c command-center /opt/unit-talk/Caddyfile` → **0**. This diff touches no compose, Caddy or workflow file. |

### Containment — unchanged throughout

| Probe | Value |
|---|---|
| `official-picks` kill switch | `killed = true` (updated `2026-09-17 21:24:35.602039+00`) |
| `distribution_outbox` rows for `official-picks` | **0** |
| `distribution_outbox` total / newest | **5,747** / `2026-07-30 20:04:41.893448+00` — both unchanged |
| Rows sent today | **0** |
| Governed picks / not `track-only` | **6** / **0** |
| `UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED` | `false` — in the repo variable AND in the running worker |
| Worker / ingestor posture | `UNIT_TALK_WORKER_AUTORUN=false`, `UNIT_TALK_ENABLED_TARGETS=none`, `SYNDICATE_MACHINE_ENABLED=false`, `UNIT_TALK_INGESTOR_AUTORUN=false` |
| Member-facing delivery | none occurred |

## Verification

EVIDENCE:

| Command | Exit | Result |
|---|---|---|
| `pnpm type-check` | 0 | pass — no diagnostics |
| `pnpm test` | 0 | pass — **5,898 `ok` lines, 0 `not ok`, 104 suite blocks each `# fail 0`** |
| `pnpm lint` | 0 | pass — no output |
| `pnpm exec tsx --test apps/worker/src/worker-runtime.test.ts` | 0 | 72 pass / 0 fail |
| `pnpm exec tsx --test packages/config/src/env.test.ts` | 0 | 13 pass / 0 fail (3 new tests) |
| `r-level-check` | — | enforced by the `R-Level Compliance Check` required context on PR #1599 |
| `pnpm verify` | 1 | **refused by containment** — see below |

```
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx.
```

`pnpm verify` exits 1 solely in `ci:assert-staging`; that is deliberate staging-isolation
containment, not a defect in this diff. A local `pnpm verify` cannot exit 0 on this repository.
The authoritative full-tree result is the required `verify` check on PR #1599, which runs inside
the `staging-ci` GitHub environment.

## STOP CONDITIONS ENCOUNTERED:

- `PT1 BLOCKED_BY_CONTAINMENT` at preflight — the T1 live-DB health ping cannot run because
  `SUPABASE_URL` resolves to the documented containment placeholder. Preflight verdict was
  nonetheless `PASS (41 checks)`.
- `File scope lock` is expected RED, for two independent reasons. First, UTV2-1923 is a reopened
  multi-increment lane, and `resolveTrustedManifests` in `scripts/ci/file-scope-guard.ts` reads
  the manifest from base, where increment 1's closed manifest still sits. Second, this increment
  touches three files outside `file_scope_lock` — `packages/config/src/env.ts`,
  `packages/config/src/env.test.ts` and `packages/db/src/client.ts` — and the lock is pinned at
  lane-start and cannot be widened on the branch. **A PM `scope-override/v1` on PR #1599 is
  required for those three paths.** No other active lane locks either file. `File scope lock` is
  not one of the four required contexts.
- The canonical deploy was NOT run. Dispatching a production deployment is reserved to Griff, and
  Human Capper activation stays OFF until this is merged and separately deployed. The startup
  proof above is an image built at this head, not a deploy.

## Finding recorded, deliberately NOT fixed here

`.dockerignore` excludes `*.tsbuildinfo`, which in Docker ignore syntax matches only the repo
root. The nested `packages/*/tsconfig.tsbuildinfo` are therefore copied into the build context,
and `tsc` treats every package as up to date and emits nothing — so a Next.js image built from a
working tree that has run `pnpm type-check` fails with `Module not found: Can't resolve
'../../../../../packages/config/dist/env.js'`. CI is unaffected, because a fresh checkout has no
`.tsbuildinfo`. Reproduced and confirmed by rebuilding after clearing the cache. Out of scope for
this PR; recorded so it is not rediscovered.

## Sign-off

Verifier Identity: Claude Opus 5 (1M context), acting as execution orchestrator
Date: 2026-09-17
Commit SHA(s): 5194341b7576eadf97776b04d12190559487bb2c
Related PRs: https://github.com/griff843/Unit-Talk-v2/pull/1599 (this increment), https://github.com/griff843/Unit-Talk-v2/pull/1592 (increment 1)

Merge authority for this T1 lane remains with PM: `pm-verdict/v1` APPROVED plus the
`t1-approved` label, and a `scope-override/v1` for the three out-of-scope paths. Nothing in this
bundle self-certifies Done.

## Merge SHA Binding

Merge SHA: `cc57268a86c9b93ea2b5c2e9d2d0a937d0d889c8`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1599
