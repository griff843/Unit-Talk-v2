# PROOF: UTV2-1929

MERGE_SHA: 7731c80d083fd44760b042c647b31092c5ea6d9a

> Pre-merge the merge row is intentionally the placeholder value; the Execution SHA row below
> carries the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-18T07:25:00.000Z
Issue: UTV2-1929
Tier: T2
Lane type: runtime
Branch: claude/utv2-1929-human-capper-lifecycle-repairs
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1601
Head SHA: 1794657ff10f614e79c2c80bf09f7d3cd71b39ff
Execution SHA: 1794657ff10f614e79c2c80bf09f7d3cd71b39ff
Diff base: ab6837871f164553eda0fb6b7c41519b0c9e42a3
result: pass

> Two production defects found while proving the post-delivery lifecycle for the accepted Human
> Capper delivery canary. Both stand between the lifecycle being *proven once* and Human Capper
> V1 being *routine*. Neither activates anything, and neither weakens a fail-closed control.

## ASSERTIONS:

Each box is an assertion a named, mutation-proven test makes. None restates intent.

### The delivery receipt records the destination, not the request

- [x] A `discord.message` receipt records the channel the adapter actually POSTed to. Asserted by
      `UTV2-1929: the receipt records the pinned channel, not the logical target`
      (`apps/worker/src/delivery-adapters.test.ts`), which pins `deliveryDestination.channelId` to
      `100000000000000002` on an outbox row whose `target` is `discord:official-picks` and
      requires `result.channel === '100000000000000002'`.
- [x] The logical target is not lost. Same test requires `payload.target === 'discord:official-picks'`
      and `result.idempotencyKey === '<outbox.id>:discord:official-picks:receipt'`, so delivery
      identity and replay protection are byte-identical to before.
- [x] Only the two sites where a route was actually resolved changed. The catch-block receipt (no
      route) and the dry-run receipt still carry `outbox.target`, because in neither case is there
      a resolved destination to record. Asserted by the unchanged
      `discord DM creation failure` assertion, which still expects `discord:strategy-room`.

### The settlement recap can resolve a human capper's pinned channel

- [x] The recap resolves the pinned channel from an existing, production-shaped receipt payload.
      Asserted by `UTV2-1929: the settlement recap resolves the pinned channel from the receipt
      payload` (`apps/api/src/grading-service.test.ts`), which seeds
      `payload = { adapter, route: 'capper-pinned', target: 'discord:official-picks',
      channelId: '1384052464189440120', destinationSource }` — the exact shape production wrote —
      and requires the POST to reach
      `https://discord.com/api/v10/channels/1384052464189440120/messages`.
- [x] Already-written receipts are repaired without touching them. The reader consults
      `payload.channelId` first, so no backfill of `distribution_receipts` is needed. Rewriting
      delivery history to repair a reader would be the wrong fix and is not done here.
- [x] The read fails closed. Asserted by `UTV2-1929: a non-numeric payload channelId is not a
      destination`, which requires `fetch` never to be called. A non-numeric value is not a
      destination and falls through to the pre-existing
      `no_receipt_channel_or_resolvable_outbox_target` refusal.
- [x] UTV2-1923's shared-target-map exemption for human delivery targets is UNCHANGED. This fix
      does not reintroduce a shared-channel fallback; it reads the per-capper pin the server
      already wrote onto the outbox row.

### The API registers the Command Center's operator key

- [x] `.env.production` now carries `UNIT_TALK_CC_API_KEY` at both write sites (canary and
      promote), so `loadAuthConfig` (`apps/api/src/auth.ts`) registers the bearer the Command
      Center presents. Verified by reading both `printf` blocks in `.github/workflows/deploy.yml`.
- [x] The workflow still parses. Verified by `python3 -c "import yaml; yaml.safe_load(...)"` over
      the whole file.
- [x] No `#` comment was placed inside the backslash-continued `printf` argument list. A `#` there
      is an argument, not a comment, and would have written a junk line into the production env
      file. The rationale is a YAML comment on the step's `env:` mapping instead.
- [x] `.env.command-center` is unchanged — it already carried the key. Only the API's env file
      gained it.

### Nothing was activated

- [x] `SYNDICATE_MACHINE_MODE`, `UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED`, `_worker_autorun`,
      `_enabled_targets` and every `delivery_kill_switch` row are untouched by this diff.
      `git diff` contains no occurrence of any of them.

## MUTATION CONTROLS:

A control that cannot fail proves nothing. Both were inverted against the running suite at this
exact head, and the baseline restored byte-identical after each.

| Mutation applied | Expected | Observed |
|---|---|---|
| Make `readReceiptPayloadChannelId` always return `null` in `apps/api/src/grading-service.ts` | the reader control fails | `not ok 2 - UTV2-1929: the settlement recap resolves the pinned channel from the receipt payload` — 93 pass / 1 fail of 94 |
| Restore `channel: outbox.target` on the `discord.message` receipt in `apps/worker/src/delivery-adapters.ts` | the writer control fails | 3 failures of 8 including `UTV2-1929: the receipt records the pinned channel, not the logical target` — 5 pass / 3 fail |
| None (baseline) | all pass | delivery-adapters 8/8, worker-runtime 72/72, grading-service 94/94 |

The first mutation reproduces the exact production refusal
(`no_receipt_channel_or_resolvable_outbox_target`) observed when settling the canary. The second
proves the receipt assertion is coupled to the field it names rather than self-consistent.

## RUNTIME EVIDENCE:

Both defects were found in production, not in a test.

### Defect 1 — the recap leg

Settling the delivered canary `816a84c7-58b8-4585-8e7a-7ad1e036342e` through the exact payload
`apps/command-center/src/app/actions/settle.ts` sends returned:

```
"humanCapperRecap": { "posted": false, "reason": "no_receipt_channel_or_resolvable_outbox_target" }
```

The production row behind that refusal:

| outbox | target | receipt.channel | payload.channelId | external_id |
|---|---|---|---|---|
| `684ba33f-45c4-4a80-adf0-db8286c90815` | `discord:official-picks` | `discord:official-picks` | `1384052464189440120` | `1550376792987140208` |

`official-picks` is not numeric, and UTV2-1923 deliberately exempted human delivery targets from
`UNIT_TALK_DISCORD_TARGET_MAP`. Neither branch of `resolveRecapChannel` could ever resolve, for
any human capper pick.

### Defect 2 — the Command Center could never write

| Probe | Result |
|---|---|
| `UNIT_TALK_CC_API_KEY` in any `.env.production` the workflow has written | **absent, in every per-SHA snapshot** |
| Keys the running API actually registers | `UNIT_TALK_BOT_API_KEY` (submitter), `UNIT_TALK_INGESTOR_API_KEY` (settler) |
| Command Center → `api.unit-talk.com/api/picks/:id/trace`, before the host repair | **401** |
| Same probe, after appending the key to `.env.production` and recreating `api` | **200** |

No secret value was read at any point; the repair was `grep '^UNIT_TALK_CC_API_KEY=' .env.command-center >> .env.production`
with a backup at `.env.production.pre-ccapikey-repair`. That host edit is **transient** —
`deploy.yml` rewrites `.env.production` on every deploy — which is exactly what the workflow
change in this PR makes durable.

### Containment readback

| Probe | Value |
|---|---|
| `delivery_kill_switch` rows with `killed = false` | **0** (all four targets engaged) |
| `distribution_outbox` total / newest | **5,747** / `2026-07-30 20:04:41` — both unchanged |
| Rows sent during the lifecycle window | **0** |
| Governed picks (`metadata ? 'distributionMode'`) | **7** |
| Kill-switch release window | **2.4 s**, through the governed `POST /api/discord/kill-switch` route, with zero pending/claimed/retry/failed rows confirmed beforehand |
| Member-facing delivery | none occurred |

## Verification

EVIDENCE:

| Command | Exit | Result |
|---|---|---|
| `pnpm type-check` | 0 | pass — `tsc -b tsconfig.json`, no diagnostics |
| `pnpm lint` | 0 | pass — `eslint`, no output |
| `pnpm test` | 0 | pass — **5,908 `ok` lines, 0 `not ok`**, 104 suite blocks each `# fail 0` |
| `pnpm exec tsx --test apps/worker/src/delivery-adapters.test.ts` | 0 | 8 pass / 0 fail (1 new test) |
| `pnpm exec tsx --test apps/worker/src/worker-runtime.test.ts` | 0 | 72 pass / 0 fail |
| `pnpm exec tsx --test apps/api/src/grading-service.test.ts` | 0 | 94 pass / 0 fail (2 new tests) |
| `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | 0 | `Verdict: PASS`, 9 changed files, rules matched `lifecycle-fsm` |

```
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 9
Rules matched: lifecycle-fsm
Advisory missing artifacts: r4-fault-report [PM-gated]
```

`pnpm verify` cannot exit 0 on this repository from a developer checkout: it refuses in
`ci:assert-staging`, which is deliberate staging-isolation containment rather than a defect in
this diff. The authoritative full-tree result is the required `verify` check on PR #1601, which
runs inside the `staging-ci` GitHub environment.

## STOP CONDITIONS ENCOUNTERED:

- **Deploying this fix is reserved decision 8.** Dispatching a production deployment requires
  Griff. Until it is deployed, the Command Center → API repair exists only as the transient host
  edit above, and the recap for the already-delivered canary remains unposted.
- **The Milestone 1 pilot pick is an owner finding, not a code defect.** Pick
  `dfcd9486` ("Dodgers @ Brewers", 2026-09-09) references a matchup that did not occur: the
  Dodgers played Cincinnati that day and the Brewers played the Cubs. `intent.md` step 4 requires
  "a genuine current selection Griff actually intends" and names "a fabricated selection" as
  unacceptable. It was left unsettled rather than given an invented outcome.

## Sign-off

Verifier Identity: Claude Opus 5 (1M context), acting as execution orchestrator
Date: 2026-09-18
Commit SHA(s): 1794657ff10f614e79c2c80bf09f7d3cd71b39ff
Related PRs: https://github.com/griff843/Unit-Talk-v2/pull/1601

Merge authority for this T2 lane is the `EXECUTOR_RESULT` comment plus green required contexts.
Nothing in this bundle self-certifies Done.

## Merge SHA Binding

Merge SHA: `7731c80d083fd44760b042c647b31092c5ea6d9a`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1601
