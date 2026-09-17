# PROOF: UTV2-1923

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-17T22:40:00.000Z
Issue: UTV2-1923
Tier: T1
Lane type: runtime
Branch: claude/utv2-1923-worker-human-target-map-exemption
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1599
Head SHA: c2f35a6a5a0c73fb9832b0b92ecc8f221e449bd1
Execution SHA: c2f35a6a5a0c73fb9832b0b92ecc8f221e449bd1
Diff base: 616994604292345b9e44cfd0c91339fcbe9bcdef
result: pass

> **Increment 2.** Increment 1 (PR #1592, merge `a26894731`) built the human capper
> official-picks delivery transaction. This increment repairs a defect in it that only
> production could surface: the bounded `human-capper` mode it introduced cannot start
> its worker.

## ASSERTIONS:

Each box is an assertion a named, mutation-proven test makes. None is a restatement of intent.

- [x] A human delivery target starts the worker with NO entry in `UNIT_TALK_DISCORD_TARGET_MAP`. Asserted by `createWorkerRuntimeDependencies starts a human delivery target with no shared channel mapping` (`apps/worker/src/worker-runtime.test.ts`), which builds the production worker environment with `UNIT_TALK_DISTRIBUTION_TARGETS=discord:official-picks` and an empty map, and requires `createWorkerRuntimeDependencies` not to throw.
- [x] The exemption is scoped to human delivery targets ONLY. Asserted by `createWorkerRuntimeDependencies still refuses a non-human target with no channel mapping`, which requires `discord:best-bets` with an empty map to still throw `RuntimeConfigError` with code `RUNTIME_REQUIRED_ENV_MISSING` naming that target.
- [x] The exemption uses the canonical `isHumanDeliveryTarget` predicate (`packages/contracts/src/promotion.ts:43`), not a new literal, so a target cannot be exempt at startup and governed at delivery. This is the same correction W3 applied to `isGoverned` in increment 1.
- [x] The deploy-time shared-map refusal is UNCHANGED. `deploy.yml:612` (canary) and `:1411` (promote) still refuse a `discord:official-picks` entry, so the per-capper routing guarantee is intact from both directions.
- [x] Nothing is activated. The `official-picks` kill switch stays engaged, the registry entry stays `enabled: false`, and `UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED` stays `false`. This change only makes the bounded mode capable of STARTING.

## MUTATION CONTROLS:

A control that cannot fail proves nothing. Both were inverted against the running suite.

| Mutation applied | Expected | Observed |
|---|---|---|
| Remove the `isHumanDeliveryTarget` exemption from `assertDiscordTargetMapCoversTargets` | the human-target control fails | `not ok 17 - createWorkerRuntimeDependencies starts a human delivery target with no shared channel mapping` — 1 fail / 71 pass |
| Widen the exemption from `isHumanDeliveryTarget(governedTarget)` to `governedTarget !== null` | the non-human refusal control fails | `not ok 18 - createWorkerRuntimeDependencies still refuses a non-human target with no channel mapping` — 1 fail / 71 pass |
| None (baseline) | both pass | 72 pass / 0 fail |

The first mutation reproduces the exact production crash-loop. The second proves the exemption
cannot be widened into a hole without a control firing.

## RUNTIME EVIDENCE:

This defect was found in production, not in a test. The runtime proof is the failure, the
diagnosis and the rollback.

| Observation | Evidence |
|---|---|
| Defect reproduced in production | Deploy run `35278517112`, promote FAILED at `Confirm syndicate machine gate in production container`; worker container `Restarting (1)` with `RuntimeConfigError` / `RUNTIME_REQUIRED_ENV_MISSING` at `apps/worker/src/runtime.ts:284` |
| The two guards are mutually unsatisfiable | `deploy.yml:612` and `:1411` refuse the deploy when `UNIT_TALK_DISCORD_TARGET_MAP` contains `discord:official-picks`; `runtime.ts:284` refused its absence. No value of the secret satisfies both. |
| Parked mode starts only via the numeric escape hatch | production worker env `UNIT_TALK_DISTRIBUTION_TARGETS=discord:1296531122234327100`, which matches `^discord:\d+$`; `discord:official-picks` does not |
| Containment held throughout | `official-picks` kill switch `killed=true` on 10 consecutive readbacks; **0** `distribution_outbox` rows for `discord:official-picks`; **0** rows sent today; newest outbox row repo-wide unchanged at `2026-07-30 20:04:41`; outbox total unchanged at 5,747 |
| Production restored | Rollback run `35279450108` success end to end including post-deploy smoke, same SHA `616994604292345b9e44cfd0c91339fcbe9bcdef` with `UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED=false`; worker recovered `Restarting (1)` → `Up (healthy)` |
| Parked posture read from the running containers | `UNIT_TALK_WORKER_AUTORUN=false`, `UNIT_TALK_ENABLED_TARGETS=none`, `SYNDICATE_MACHINE_ENABLED=false`, `UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED=false`, `UNIT_TALK_INGESTOR_AUTORUN=false` |

## Verification

| Command | Exit | Result |
|---|---|---|
| `pnpm type-check` | 0 | pass — no diagnostics |
| `pnpm test` | 0 | pass — 6,027 `ok` lines, 0 `not ok` |
| `pnpm lint` | 0 | pass — no output |
| `pnpm exec tsx --test apps/worker/src/worker-runtime.test.ts` | 0 | 72 pass / 0 fail (2 new tests) |
| `pnpm verify` | 1 | **refused by containment** — see below |

`pnpm verify` produced **0 `not ok` lines across 105 suite blocks, each reporting `# fail 0`**,
with every stage through `verify:commands` clean. Exit 1 originates solely in `ci:assert-staging`:

```
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx.
```

That is deliberate staging-isolation containment, not a defect in this diff. A local `pnpm verify`
cannot exit 0 on this repository. The authoritative full-tree result is the required `verify`
check on PR #1599, which runs inside the `staging-ci` GitHub environment.

## STOP CONDITIONS ENCOUNTERED:

- `PT1 BLOCKED_BY_CONTAINMENT` at preflight — the T1 live-DB health ping cannot run because
  `SUPABASE_URL` resolves to the documented containment placeholder. Preflight verdict was
  nonetheless `PASS (41 checks)`.
- `File scope lock` is expected RED. UTV2-1923 is a reopened multi-increment lane, and
  `resolveTrustedManifests` in `scripts/ci/file-scope-guard.ts` reads the manifest from base,
  where increment 1's closed manifest still sits. It is not one of the four required contexts.
  Recorded here rather than left to look overlooked.

## Sign-off

Verifier Identity: Claude Opus 5 (1M context), acting as execution orchestrator
Date: 2026-09-17
Commit SHA(s): c2f35a6a5a0c73fb9832b0b92ecc8f221e449bd1
Related PRs: https://github.com/griff843/Unit-Talk-v2/pull/1599 (this increment), https://github.com/griff843/Unit-Talk-v2/pull/1592 (increment 1)

Merge authority for this T1 lane remains with PM: `pm-verdict/v1` APPROVED plus the
`t1-approved` label. Nothing in this bundle self-certifies Done.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1599
