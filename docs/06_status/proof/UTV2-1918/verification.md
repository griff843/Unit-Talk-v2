# PROOF: UTV2-1918

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-16T02:15:39.638Z
Issue: UTV2-1918
Tier: T1
Lane type: runtime
Branch: claude/utv2-1918-cc-deployment-candidate
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1587
Head SHA: 4703c1c7246b614b5b36a584f2fca89554e68374
result: pass

## ASSERTIONS:

- [x] The Command Center is built and pushed by `deploy.yml` on every deploy, from `apps/command-center` on port 4300, alongside `web` and `smart-form`.
- [x] The Command Center container is default-off: `docker compose config --services` resolves 10 services without `--profile command-center` and 11 with it, so no existing deploy starts it.
- [x] Exactly one workflow step may activate the profile, and no unguarded `docker compose` invocation in `deploy.yml` carries `--profile`.
- [x] The surface is internal-only: the container publishes `127.0.0.1:4300` and `deploy/production/Caddyfile` is unchanged, so no public hostname or route reaches it.
- [x] Enabling the Command Center cannot break a deploy that does not use it: with `UNIT_TALK_COMMAND_CENTER_ENABLED` unset or `false`, the secret-inventory step exits 0 and emits `command_center.disabled`; no Command Center secret is added to the unconditional `missing[]` list.
- [x] With `UNIT_TALK_COMMAND_CENTER_ENABLED=true`, the deploy refuses to proceed unless `UNIT_TALK_CC_API_KEY` and either `COMMAND_CENTER_AUTH_TOKEN` or the complete `COMMAND_CENTER_AUTH_USERNAME`+`COMMAND_CENTER_AUTH_PASSWORD` pair are configured; a half-configured basic pair is its own refusal.
- [x] `nextjs-entrypoint.sh` refuses to start `apps/command-center` on a configuration it cannot serve — no auth material, a partial basic pair, a missing API key, a missing `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, or `UNIT_TALK_APP_ENV != production` each exit 1 before the server starts.
- [x] The container receives no credential it does not need: `.env.command-center` carries only the Command Center's own variables and is written `chmod 600`, and the canary and promote copies of every Command Center edit do not drift.
- [x] Production containment is preserved byte-for-byte: the `SYNDICATE_MACHINE_MODE` case statement is unchanged, the parked branch still emits `mode=parked`, and ingestor autorun, ingestor scheduling, worker autorun, member targets and the delivery kill switches are untouched. 0 migrations.
- [x] Each of the above is mutation-tested: 7 of 7 deliberate breakages turn the wiring suite red on the assertion that names them.

## EVIDENCE:

Measured on head `65f7e192396c794d08f0ea1d1bc420b9c8d6dc0a` (the branch after
`ops:merge-wrapper git-merge-main` brought `origin/main` in), from the lane worktree.

```
$ pnpm type-check
TYPECHECK_EXIT=0

$ pnpm lint
LINT_EXIT=0

$ pnpm test
1..2994
# tests 3119
# suites 21
# pass 3119
# fail 0
# cancelled 0
# skipped 0
# todo 0
TEST_EXIT=0

$ npx tsx --test scripts/ci/nextjs-deploy-wiring.test.ts
# tests 19
# pass 19
# fail 0

$ npx tsx --test scripts/ci/deploy-parked-mode.test.ts
# tests 25
# pass 25
# fail 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head 65f7e192396c794d08f0ea1d1bc420b9c8d6dc0a
Verdict: PASS
Changed files: 6
Rules matched: (none) — no R-level artifacts required for this diff

$ UNIT_TALK_IMAGE_TAG=t docker compose -f deploy/production/docker-compose.yml config --services | wc -l
10
$ UNIT_TALK_IMAGE_TAG=t docker compose -f deploy/production/docker-compose.yml --profile command-center config --services | wc -l
11

$ git diff --name-only origin/main...HEAD -- supabase/migrations/ | wc -l
0
```

### Resync onto current main — measured, not asserted

The lane was resynced exactly once through `pnpm ops:merge-wrapper git-merge-main`
(`main-sync` correctly refused to choose a history-rewriting verb; this branch carries a
proof bundle and a durable label, so SHAs must be preserved). The merge commit is
`4703c1c7246b614b5b36a584f2fca89554e68374`, importing `origin/main`
`eb29fa99beb66b0e618e25fc5f9f3572235118bd`.

The whole diff from the pre-resync head `2a6c603aaa3cadb406b89cc907697a88943438bf` to the
new head is `docs/06_status/readiness/readiness-score.json` alone (49 insertions, 49
deletions). Every one of the ten files UTV2-1918 introduces or changes is **blob-identical**
across the resync, verified by `git cat-file` at the merge commit — i.e. measured *before*
the proof rebind that follows it, which by design moves `evidence.json`'s
`verified_source_sha` and this file's `Execution SHA:` row and nothing else:

```
551dab728128ede1d0b1c3051d0c735f4684b489  .github/workflows/deploy.yml
f3bab35392769830131ea5f3422d545eb89e3bc8  .ops/sync/UTV2-1918.yml
86e1465fdbd9813422af470b421e2455b800e1c5  deploy/production/docker-compose.yml
b183967b9df8547767f8dd1c3271d38202746ac9  deploy/production/nextjs-entrypoint.sh
ad492c791ec6b841584d184c4d273660a9d828ad  docs/06_status/lanes/UTV2-1918.json
875b4db1b8fbefab230eab38fe3a5e2a5e6be59c  docs/06_status/proof/UTV2-1918/diff-summary.md
9073d95da3cecc434cbf20d128ed9f94aa72883d  docs/06_status/proof/UTV2-1918/verification.md
69fefd61bb3a7c721f595bc4b4460801c7bac697  docs/06_status/proof/UTV2-1918/runtime-health.json
57323c1cb5ef374e74e00439750b27b019dcd987  docs/06_status/proof/UTV2-1918/evidence.json
4252e3f93d08911822df0f4478d92c057fbd0be7  scripts/ci/nextjs-deploy-wiring.test.ts
```

So the measurements recorded above, taken at `65f7e192…`, apply unchanged at the new head:
the resync imported a readiness-ledger refresh with zero overlap against this lane's files
and could not have changed any measured behaviour. The execution anchor is rebound to
`4703c1c72…` because it is now the last non-proof commit; nothing else in this bundle moved.

`pnpm verify` is not run to completion locally: `ci:assert-staging-target` refuses a
local invocation by design, so `verify` cannot exit 0 off CI. Its constituent gates are
recorded individually above, and `verify` itself is asserted on CI against this head.

### Two real regressions this lane introduced, found and fixed before merge

The first clean full-suite run on this branch returned `3117/3119`. The two failures were
not flakes and not cross-suite contamination — they reproduced on a single isolated run,
and CI reached the same verdict independently (`verify: fail` on `b2c8a2c57`):

| test | cause |
|---|---|
| `deploy workflow has one fail-closed parked-mode contract across every gate` | renaming the registry preflight step broke the audit's name-prefix lookup, so the step vanished from its view |
| `static deploy audit detects a registry preflight that does not fail closed` | same lookup, reached through the audit's own mutation path |

`scripts/ci/deploy-parked-mode.test.ts` finds that step by the prefix
`Preflight — verify registry auth and resolve all ` and reads its service list directly —
a shape its own comment says exists precisely so that adding an image cannot silently
remove the preflight from the audit's view. That is exactly what the rename did. The audit
file is outside this lane's `file_scope_lock`, so the repair went into `deploy.yml`:
the step name is restored, and the six always-on services are back in the literal
`for svc in` line with `command-center` appended through a `$cc_service` variable that is
empty unless the surface is enabled. The step's own output names the services it actually
resolved, so the full list stays truthful even though the title carries the fixed count
the audit's mutation test requires.

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: 3119 tests, 3119 pass, 0 fail, exit 0
- [x] `pnpm verify`: constituent gates green locally (type-check 0, lint 0, test 0); the composite command cannot exit 0 off CI because `ci:assert-staging-target` refuses a local run — asserted on CI at this head
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: `Verdict: PASS`, 6 changed files, no R-level artifacts required

## Runtime Verification

This lane changes deployment wiring only — no `apps/**` or `packages/**` source file is
touched, and it adds 0 migrations. The runtime evidence is therefore behavioural proof of
the wiring itself, recorded in full in `runtime-health.json` alongside this file.

**Containment preserved.** The `SYNDICATE_MACHINE_MODE` case statement is byte-identical
to `main`; the parked branch still emits `mode=parked` when executed. Ingestor autorun,
ingestor scheduling, worker autorun, member targets and the delivery kill switches are all
unchanged. `deploy/production/Caddyfile` is unchanged, so the surface has no public route.

**Default-off, measured rather than asserted.** `docker compose config --services`
resolves 10 services without the profile and 11 with it, so no existing deploy starts the
Command Center. Exactly one workflow step may carry `--profile`, asserted in CI.

**Entrypoint refusal matrix** — `nextjs-entrypoint.sh` executed under a harness that stubs
the final server exec:

| case | exit |
|---|---|
| complete config | 0 STARTED |
| basic-auth pair instead of token | 0 STARTED |
| partial basic pair (username only) | 1 FATAL |
| partial basic pair (password only) | 1 FATAL |
| no auth material at all | 1 FATAL |
| missing `UNIT_TALK_CC_API_KEY` | 1 FATAL |
| missing `SUPABASE_SERVICE_ROLE_KEY` | 1 FATAL |
| `UNIT_TALK_APP_ENV=staging` | 1 FATAL |
| control: smart-form complete | 0 STARTED |
| control: web | 0 STARTED |

**Secret-inventory behaviour** — the `verify` job's inventory step extracted and executed:

| case | exit | output |
|---|---|---|
| `UNIT_TALK_COMMAND_CENTER_ENABLED` unset (today's every deploy) | 0 | `command_center.disabled` |
| set to `false` | 0 | `command_center.disabled` |
| `true`, both secrets present | 0 | `command_center.enabled` |
| `true`, basic pair instead of token | 0 | `command_center.enabled` |
| `true`, no secrets | 1 | missing `UNIT_TALK_CC_API_KEY`… |
| `true`, api key only | 1 | missing `COMMAND_CENTER_AUTH_TOKEN`… |
| `true`, token only | 1 | missing `UNIT_TALK_CC_API_KEY` |
| `true`, partial basic pair | 1 | "must be set together" |
| control: containment | — | `mode=parked` emitted |
| control: bad `SYNDICATE_MACHINE_ENABLED` value | 1 | "must be exactly 'true' … or 'false'" |

**Mutation battery: 7 of 7 caught.** Each deliberate breakage turned the wiring suite red
on the assertion that names it. Two of the seven were re-run after the preflight repair
above and still fail closed: making `command-center` unconditional in the preflight loop,
and removing the guarded `cc_service` assignment. Control green at 19/19 after each.

**Reserved, not taken.** No secret value was read, printed or compared. No deployment was
dispatched. This lane surfaces three operator inputs — `UNIT_TALK_CC_API_KEY`,
`COMMAND_CENTER_AUTH_TOKEN` (reserved decision 4) and the non-secret variable
`UNIT_TALK_COMMAND_CENTER_ENABLED=true` — and a later deploy dispatch (reserved decision
8). None is taken here.

**Known gap.** `deploy/rollback.sh` does not yet restore `.env.command-center`, recorded
in `runtime-health.json` rather than repaired in this lane, because the file is outside
its `file_scope_lock`.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1587
Approved PR head: pending merge
Execution SHA: 4703c1c7246b614b5b36a584f2fca89554e68374
